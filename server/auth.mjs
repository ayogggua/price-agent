import { randomBytes, scrypt as sc, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { pool, query, id, audit, settings, effectiveAiSettings, cleanExpiredSessions } from './db.mjs';
import { AppError, cfg } from './config.mjs';

const scrypt = promisify(sc);
const hash = t => createHash('sha256').update(t).digest('hex');

export const roles = ['admin', 'reviewer', 'presales', 'sales', 'engineer'];

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}

async function passwordMatches(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  const expected = Buffer.from(h, 'hex');
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export const publicUser = u => ({
  id: u.id,
  username: u.username,
  name: u.display_name,
  role: u.role,
  status: u.status
});

export function validatePassword(raw) {
  const password = String(raw || '');
  if (password.length < 10 || password.length > 200) {
    throw new AppError('密码长度需为 10 至 200 位');
  }
  return password;
}

export function credentials(body) {
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username) || password.length < 10 || password.length > 200) {
    throw new AppError('账号需使用 3 至 80 位字母、数字或 . _ @ -，密码至少 10 位');
  }
  return { username, password };
}

export function shouldSecureCookie(req) {
  if (cfg.cookieSecure === 'true' || cfg.cookieSecure === '1') return true;
  if (cfg.cookieSecure === 'false' || cfg.cookieSecure === '0') return false;
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return Boolean(req?.secure || proto === 'https');
}

export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldSecureCookie(req),
    path: cfg.basePath || '/'
  };
}

export async function sessionFor(user, res, req = res.req) {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(24).toString('hex');
  cleanExpiredSessions().catch(() => {});
  await query(
    'INSERT INTO sessions(id, user_id, csrf_token, expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))',
    [hash(token), user.id, csrfToken]
  );
  res.cookie('price_session', token, {
    ...sessionCookieOptions(req),
    maxAge: 7 * 86400000
  });
  const s = await settings().catch(() => ({}));
  const defs = effectiveAiSettings(s);
  return {
    user: publicUser(user),
    csrf: csrfToken,
    brandName: cfg.brandName,
    companyName: s?.companyName || cfg.defaultCompanyName || '',
    aiConfigured: cfg.aiConfigured,
    model: defs.model,
    ai: {
      configured: cfg.aiConfigured,
      model: defs.model,
      thinkingLevel: defs.thinkingLevel,
      enableSearch: defs.enableSearch,
      enableUrlContext: defs.enableUrlContext,
      baseUrlConfigured: cfg.baseUrlConfigured
    }
  };
}

export async function attachUser(req, _res, next) {
  const cookie = req.headers.cookie
    ?.split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('price_session='))
    ?.slice(14);
  if (cookie) {
    const rows = await query(
      "SELECT u.*, s.csrf_token, s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='active'",
      [hash(cookie)]
    );
    if (rows[0]) {
      req.user = rows[0];
      req.csrf = rows[0].csrf_token;
      req.sessionId = rows[0].session_id;
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) throw new AppError('请先登录', 401);
  next();
}

export const allow = (...allowed) => (req, _res, next) => {
  if (!req.user || !allowed.includes(req.user.role)) {
    throw new AppError('当前账号没有此操作权限', 403);
  }
  next();
};

export function csrf(req, _res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        throw new AppError('请求来源不匹配', 403);
      }
      const forwardedHost = String(req.headers['x-forwarded-host'] || '')
        .split(',')[0]
        .trim();
      const allowedHosts = new Set([req.headers.host, forwardedHost].filter(Boolean));
      if (!allowedHosts.has(originHost)) {
        throw new AppError('请求来源不匹配', 403);
      }
    }
    if (req.user && req.headers['x-csrf-token'] !== req.csrf) {
      throw new AppError('会话校验失败，请刷新页面', 403);
    }
  }
  next();
}

export async function setup(req, res) {
  const { username, password } = credentials(req.body);
  const pw = await passwordHash(password);
  const conn = await pool.getConnection();
  let user;
  try {
    const lock = await query("SELECT GET_LOCK('price_agent_setup', 10) AS locked", [], conn);
    if (!lock[0]?.locked) throw new AppError('正在初始化，请稍后重试', 409);
    await conn.beginTransaction();
    if ((await query('SELECT COUNT(*) AS n FROM users', [], conn))[0].n) {
      throw new AppError('管理员已创建，请直接登录', 409);
    }
    user = {
      id: id(),
      username,
      display_name: String(req.body.name || '').trim().slice(0, 100) || '管理员',
      password_hash: pw,
      role: 'admin',
      status: 'active'
    };
    await query(
      'INSERT INTO users(id, username, display_name, password_hash, role) VALUES(?,?,?,?,?)',
      [user.id, user.username, user.display_name, pw, user.role],
      conn
    );
    await audit(user, 'user', user.id, 'create', { role: 'admin', setup: true }, conn);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await query("SELECT RELEASE_LOCK('price_agent_setup')", [], conn).catch(() => {});
    conn.release();
  }
  res.json(await sessionFor(user, res, req));
}

export async function login(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || password.length > 200) throw new AppError('账号或密码不正确', 401);
  const user = (await query("SELECT * FROM users WHERE username=? AND status='active'", [username]))[0];
  if (!user || !(await passwordMatches(password, user.password_hash))) {
    throw new AppError('账号或密码不正确', 401);
  }
  await audit(user, 'user', user.id, 'login');
  res.json(await sessionFor(user, res, req));
}
