import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { z } from 'zod';
import { cfg, root, AppError, parse, cleanError, THINKING_LEVELS, normalizeThinkingLevel } from './config.mjs';
import { pool, query, id, tx, initDb, settings, effectiveAiSettings, audit, projectRow, runRow, quoteRow } from './db.mjs';
import {
  attachUser,
  requireUser,
  allow,
  csrf,
  setup,
  login,
  publicUser,
  credentials,
  validatePassword,
  passwordHash,
  roles,
  sessionCookieOptions
} from './auth.mjs';
import { startAnalysis, cancelAnalysis, calculateEstimate, resultSchema } from './analysis.mjs';
import { createQuote, saveQuote, transitionQuote, deleteQuote, normalizeTaxMode } from './quotes.mjs';
import { upload, persistFiles, listFiles, removeFile } from './files.mjs';
import { pdfBuffer, xlsxBuffer } from './export.mjs';
import * as aiMod from './ai.mjs';

function isImageGenerationModel(modelId) {
  return /(?:^|[-_/.])image(?:[-_/.]|$)/i.test(String(modelId || ''));
}

function fallbackSupportedThinkingLevels(modelId) {
  const m = String(modelId || '')
    .trim()
    .toLowerCase()
    .replace(/-(?:minimal|low|medium|high|xhigh)$/, '');
  if (!m) return THINKING_LEVELS;
  if (isImageGenerationModel(m)) return ['NONE'];
  if (m.startsWith('gemini-4-')) return ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH'];
  if (m.startsWith('gemini-3.8-') || m.startsWith('gemini-3.7-') || m.startsWith('gemini-3.1-pro')) {
    return ['AUTO', 'LOW', 'MEDIUM', 'HIGH'];
  }
  if (m.startsWith('gemini-3.5-') || m.startsWith('gemini-3.6-') || m.startsWith('gemini-3.1-flash-lite')) {
    return ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
  }
  if (m.startsWith('gemini-2.5-')) {
    return ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'NONE'];
  }
  return THINKING_LEVELS;
}

function supportedThinkingFor(modelId) {
  if (typeof aiMod.getSupportedThinkingLevels === 'function') {
    const levels = aiMod.getSupportedThinkingLevels(modelId);
    if (Array.isArray(levels) && levels.length) return levels;
  }
  return fallbackSupportedThinkingLevels(modelId);
}

function clampThinkingForModel(modelId, rawLevel, fallback = 'AUTO') {
  const allowed = supportedThinkingFor(modelId);
  const candidate = normalizeThinkingLevel(rawLevel, fallback);
  if (allowed.includes(candidate)) return candidate;
  return allowed.includes('AUTO') ? 'AUTO' : allowed[0] || 'AUTO';
}

let cachedForm = null;
let cachedFormKey = '';

async function getQuoteForm() {
  const candidates = [
    path.join(root, 'client/data.js'),
    path.join(root, 'designs/quote-input/data.js')
  ];
  for (const file of candidates) {
    try {
      const st = await fs.stat(file);
      const key = `${file}:${st.mtimeMs}`;
      if (cachedForm && cachedFormKey === key) return cachedForm;
      const sandbox = { window: {} };
      vm.runInNewContext(await fs.readFile(file, 'utf8'), sandbox);
      if (sandbox.window?.QuoteData) {
        cachedForm = sandbox.window.QuoteData;
        cachedFormKey = key;
        return cachedForm;
      }
    } catch {}
  }
  throw new AppError('未找到表单配置字典文件', 500);
}

let cachedHtml = '';
let cachedHtmlMtime = 0;

async function renderClientHtml() {
  const htmlPath = path.join(root, 'client/index.html');
  const st = await fs.stat(htmlPath);
  if (!cachedHtml || st.mtimeMs !== cachedHtmlMtime) {
    const raw = await fs.readFile(htmlPath, 'utf8');
    cachedHtml = raw
      .replaceAll('__APP_BASE_JSON__', JSON.stringify(cfg.basePath))
      .replaceAll('__APP_BASE__', cfg.basePath);
    cachedHtmlMtime = st.mtimeMs;
  }
  return cachedHtml;
}

async function ensureClientBuild() {
  const entry = path.join(root, 'client/build/platform.js');
  let needBuild = false;
  try {
    const buildStat = await fs.stat(entry);
    const sources = [
      'client/components.jsx',
      'client/form.jsx',
      'client/shared.jsx',
      'client/project.jsx',
      'client/quote.jsx',
      'client/libraries.jsx',
      'client/platform.jsx'
    ];
    for (const rel of sources) {
      try {
        const st = await fs.stat(path.join(root, rel));
        if (st.mtimeMs > buildStat.mtimeMs) {
          needBuild = true;
          break;
        }
      } catch {}
    }
  } catch {
    needBuild = true;
  }
  if (needBuild) {
    try {
      const { buildClient } = await import('./build.mjs');
      await buildClient();
    } catch {
      try {
        await fs.access(entry);
      } catch {
        console.warn('提示：未检测到前端编译产物 client/build/platform.js，开发环境请执行 npm run build');
      }
    }
  }
}

async function inputData(raw, { required = false } = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.types)) {
    throw new AppError('需求数据格式不正确');
  }
  if (raw.types.length > 20 || !Array.isArray(raw.customTypes || []) || (raw.customTypes || []).length > 16) {
    throw new AppError('业务类型过多');
  }
  const form = await getQuoteForm();
  const d = form.normalizeDraft({
    ...raw,
    taxMode: raw.taxMode ? normalizeTaxMode(raw.taxMode) : raw.taxMode
  });
  d.taxMode = normalizeTaxMode(d.taxMode);

  if (
    !['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD'].includes(d.currency) ||
    !['中文', 'English', '中英双语'].includes(d.language)
  ) {
    throw new AppError('请选择有效币种与语言');
  }
  if (!Array.isArray(d.roles) || d.roles.length > 40) {
    throw new AppError('人员投入格式不正确');
  }
  for (const r of d.roles) {
    for (const key of ['days', 'rate']) {
      if (r[key] !== '' && r[key] !== undefined && (!Number.isFinite(Number(r[key])) || Number(r[key]) < 0)) {
        throw new AppError('人员投入和单价不能为负数');
      }
    }
  }
  for (const type of d.types) {
    const key = type + '-productProgress';
    if (d[key] !== undefined && d[key] !== '' && (!(Number(d[key]) >= 0) || Number(d[key]) > 100)) {
      throw new AppError('产品完成进度应在 0% 到 100% 之间');
    }
  }
  for (const key of ['otherCost', 'riskReserve', 'budgetMin', 'budgetMax', 'taxRate']) {
    if (d[key] !== '' && d[key] !== undefined && (!Number.isFinite(Number(d[key])) || Number(d[key]) < 0)) {
      throw new AppError('金额与税率应为非负数字');
    }
  }
  if (d.margin !== '' && d.margin !== undefined && (!(Number(d.margin) >= 0) || Number(d.margin) >= 100)) {
    throw new AppError('毛利率应在 0% 到 100% 之间（不含 100%）');
  }
  if (
    d.budgetStatus === '已有预算' &&
    !d.budgetMinUnknown &&
    !d.budgetMaxUnknown &&
    d.budgetMin !== '' &&
    d.budgetMax !== '' &&
    Number(d.budgetMin) > Number(d.budgetMax)
  ) {
    throw new AppError('预算上限不能小于预算下限');
  }
  if (required) {
    const missing = form.requirements(d).filter(r => !r.done);
    if (missing.length) {
      throw new AppError('请先补充必填项：' + missing.map(r => r.label).join('、'));
    }
  }
  return d;
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '尝试次数较多，请稍后再试' }
});

const analysisLimiter = rateLimit({
  windowMs: 60000,
  limit: 6,
  legacyHeaders: false,
  standardHeaders: true,
  message: { error: '分析发起过于频繁，请稍后再试' }
});

const quoteWrite = allow('admin', 'reviewer', 'presales', 'sales');

const referenceSchema = z.object({
  title: z.string().trim().min(1).max(255),
  service_kind: z.string().trim().min(1).max(100),
  evidence_type: z.enum(['deal', 'award', 'listing', 'estimate']),
  amount: z.coerce.number().positive().max(1e12),
  currency: z.enum(['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD']),
  source_url: z.string().trim().max(2000).default(''),
  scope_text: z.string().trim().min(1).max(20000),
  reference_date: z.string().trim().max(30).default(''),
  notes: z.string().max(5000).default('')
});

const assetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().max(100).default(''),
  service_kind: z.enum(['license', 'software', 'model', 'solution', 'custom']),
  stage: z.string().trim().min(1).max(150),
  progress: z.coerce.number().min(0).max(100).nullable(),
  completed_work: z.string().max(15000).default(''),
  remaining_work: z.string().max(15000).default(''),
  notes: z.string().max(5000).default('')
});

const settingSchema = z.object({
  companyName: z.string().trim().max(300),
  companyAddress: z.string().trim().max(1000),
  companyContact: z.string().trim().max(300),
  defaultMargin: z.coerce.number().min(0).max(99),
  defaultRiskPercent: z.coerce.number().min(0).max(100),
  rateNote: z.string().max(1000),
  laborRates: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(100),
        rate: z.coerce.number().min(0).max(1e7)
      })
    )
    .min(1)
    .max(30),
  aiModel: z.string().trim().max(120).optional(),
  thinkingLevel: z.enum(['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'NONE']).optional(),
  enableSearch: z.boolean().optional(),
  enableUrlContext: z.boolean().optional()
});

const api = express.Router();
api.use(attachUser, csrf);

api.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    const s = await settings().catch(() => ({}));
    const defs = effectiveAiSettings(s);
    res.json({
      ok: true,
      dbConfigured: true,
      aiConfigured: cfg.aiConfigured,
      model: defs.model,
      thinkingLevel: defs.thinkingLevel,
      brandName: cfg.brandName
    });
  } catch {
    res.status(503).json({
      ok: false,
      dbConfigured: false,
      aiConfigured: cfg.aiConfigured,
      model: cfg.model,
      thinkingLevel: cfg.thinkingLevel,
      brandName: cfg.brandName,
      error: '数据库连接不可用'
    });
  }
});

api.get('/auth/me', async (req, res) => {
  const [hasUserRows, s] = await Promise.all([
    query('SELECT id FROM users LIMIT 1'),
    settings().catch(() => ({}))
  ]);
  const defs = effectiveAiSettings(s);
  res.json({
    user: req.user ? publicUser(req.user) : null,
    csrf: req.csrf || null,
    setupRequired: !hasUserRows.length,
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
  });
});

api.post('/auth/setup', authLimiter, setup);
api.post('/auth/login', authLimiter, login);

api.use(requireUser);

api.post('/auth/logout', async (req, res) => {
  await query('DELETE FROM sessions WHERE id=?', [req.sessionId]);
  const opts = sessionCookieOptions(req);
  res.clearCookie('price_session', opts);
  if (cfg.basePath) {
    res.clearCookie('price_session', { ...opts, path: cfg.basePath + '/' });
  }
  res.json({ ok: true });
});

api.post('/auth/password', async (req, res) => {
  const password = validatePassword(req.body?.password);
  await query('UPDATE users SET password_hash=? WHERE id=?', [await passwordHash(password), req.user.id]);
  await query('DELETE FROM sessions WHERE user_id=? AND id<>?', [req.user.id, req.sessionId]);
  await audit(req.user, 'user', req.user.id, 'save', { selfPassword: true });
  res.json({ ok: true });
});

api.get('/projects/list', async (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 200);
  const statusFilter = String(req.query.status || '').trim();

  const [projectStatRows, reviewQuoteStatRows] = await Promise.all([
    query(
      "SELECT COUNT(*) AS total, COALESCE(SUM(status='analyzing'), 0) AS analyzing, COALESCE(SUM(status='won'), 0) AS won FROM projects"
    ),
    query("SELECT COUNT(*) AS reviewQuotes FROM quotes WHERE status='review'")
  ]);

  const where = [];
  const params = [];
  if (search) {
    const like = `%${search}%`;
    where.push('(p.number LIKE ? OR p.input_json LIKE ? OR u.display_name LIKE ?)');
    params.push(like, like, like);
  }
  if (statusFilter && statusFilter !== 'all') {
    if (['draft', 'analyzing', 'ready', 'quoted', 'won', 'lost'].includes(statusFilter)) {
      where.push('p.status = ?');
      params.push(statusFilter);
    } else if (['review', 'approved', 'sent'].includes(statusFilter)) {
      where.push('EXISTS (SELECT 1 FROM quotes qf WHERE qf.project_id = p.id AND qf.status = ?)');
      params.push(statusFilter);
    }
  }

  const sql =
    'SELECT p.*, u.display_name AS owner_name FROM projects p LEFT JOIN users u ON u.id=p.owner_id' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY p.updated_at DESC LIMIT 200';

  const rows = await query(sql, params);
  let mappedProjects = rows.map(r => ({ ...projectRow(r), ownerName: r.owner_name }));

  if (search) {
    const kw = search.toLowerCase();
    mappedProjects = mappedProjects.filter(p => {
      const hay = [
        p.number,
        p.input?.projectName,
        p.input?.customerName,
        p.input?.projectBrief,
        p.ownerName
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }

  const quoteRows = await query(
    'SELECT id, project_id, number, revision, status, currency, totals_json, updated_at FROM quotes ORDER BY updated_at DESC LIMIT 500'
  );
  const quotes = quoteRows.map(q => ({
    id: q.id,
    projectId: q.project_id,
    number: q.number,
    revision: q.revision,
    status: q.status,
    currency: q.currency,
    total: parse(q.totals_json).total || 0,
    updatedAt: q.updated_at
  }));

  const latestQuoteByProject = new Map();
  for (const q of quotes) {
    if (!latestQuoteByProject.has(q.projectId)) {
      latestQuoteByProject.set(q.projectId, q);
    }
  }
  mappedProjects = mappedProjects.map(p => ({
    ...p,
    latestQuote: latestQuoteByProject.get(p.id) || null
  }));

  res.json({
    projects: mappedProjects,
    quotes,
    stats: {
      total: Number(projectStatRows[0]?.total || 0),
      analyzing: Number(projectStatRows[0]?.analyzing || 0),
      reviewQuotes: Number(reviewQuoteStatRows[0]?.reviewQuotes || 0),
      won: Number(projectStatRows[0]?.won || 0)
    }
  });
});

api.get('/projects/get', async (req, res) => {
  const p = (await query('SELECT * FROM projects WHERE id=?', [String(req.query.id || '')]))[0];
  if (!p) throw new AppError('项目不存在', 404);
  const [files, runs, quotes] = await Promise.all([
    listFiles(p.id),
    query('SELECT * FROM analysis_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 20', [p.id]),
    query('SELECT * FROM quotes WHERE project_id=? ORDER BY updated_at DESC', [p.id])
  ]);
  res.json({
    project: projectRow(p),
    files,
    runs: runs.map(runRow),
    quotes: quotes.map(quoteRow)
  });
});

api.post('/projects/save', quoteWrite, async (req, res) => {
  const d = await inputData(req.body?.input);
  let projectId = req.body?.id ? String(req.body.id) : '';
  if (projectId) {
    await tx(async conn => {
      const p = (await query('SELECT * FROM projects WHERE id=? FOR UPDATE', [projectId], conn))[0];
      if (!p) throw new AppError('项目不存在', 404);
      if (p.revision !== Number(req.body?.revision)) {
        throw new AppError('需求已被其他成员更新，请刷新后编辑', 409);
      }
      await query(
        "UPDATE projects SET input_json=?, revision=revision+1, status=CASE WHEN status='analyzing' THEN status ELSE 'draft' END, updated_by=?, updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(d), req.user.id, projectId],
        conn
      );
      await audit(req.user, 'project', projectId, 'save', { revision: p.revision + 1 }, conn);
    });
  } else {
    projectId = id();
    const number =
      'P-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + projectId.slice(0, 6).toUpperCase();
    await query(
      'INSERT INTO projects(id, number, input_json, owner_id, created_by, updated_by) VALUES(?,?,?,?,?,?)',
      [projectId, number, JSON.stringify(d), req.user.id, req.user.id, req.user.id]
    );
    await audit(req.user, 'project', projectId, 'create');
  }
  res.json({ project: projectRow((await query('SELECT * FROM projects WHERE id=?', [projectId]))[0]) });
});

api.post('/projects/delete', quoteWrite, async (req, res) => {
  const projectId = String(req.body?.id || '');
  if (!projectId) throw new AppError('缺少项目标识');

  const existing = (await query('SELECT * FROM projects WHERE id=?', [projectId]))[0];
  if (!existing) throw new AppError('项目不存在', 404);
  if (existing.owner_id !== req.user.id && !['admin', 'reviewer'].includes(req.user.role)) {
    throw new AppError('仅项目负责人、审核人或管理员可删除该项目', 403);
  }

  const activeRuns = await query(
    "SELECT id FROM analysis_runs WHERE project_id=? AND status IN ('queued','running')",
    [projectId]
  );
  for (const ar of activeRuns) {
    await cancelAnalysis(ar.id, req.user).catch(() => {});
  }

  let storedFiles = [];
  await tx(async conn => {
    const p = (await query('SELECT * FROM projects WHERE id=? FOR UPDATE', [projectId], conn))[0];
    if (!p) throw new AppError('项目不存在', 404);
    if (p.owner_id !== req.user.id && !['admin', 'reviewer'].includes(req.user.role)) {
      throw new AppError('仅项目负责人、审核人或管理员可删除该项目', 403);
    }
    const attRows = await query('SELECT stored_name FROM attachments WHERE project_id=?', [projectId], conn);
    storedFiles = attRows.map(a => a.stored_name).filter(Boolean);
    const quoteIds = (await query('SELECT id FROM quotes WHERE project_id=?', [projectId], conn)).map(q => q.id);
    for (const qid of quoteIds) {
      await query('DELETE FROM quote_versions WHERE quote_id=?', [qid], conn);
    }
    await query('DELETE FROM quotes WHERE project_id=?', [projectId], conn);
    await query('DELETE FROM analysis_runs WHERE project_id=?', [projectId], conn);
    await query('DELETE FROM attachments WHERE project_id=?', [projectId], conn);
    await query('DELETE FROM projects WHERE id=?', [projectId], conn);
    await audit(
      req.user,
      'project',
      projectId,
      'delete',
      { number: p.number, projectName: parse(p.input_json).projectName || '' },
      conn
    );
  });

  await Promise.all(storedFiles.map(name => fs.unlink(path.join(cfg.uploads, name)).catch(() => {})));
  res.json({ ok: true });
});

api.post('/files/upload', quoteWrite, upload, async (req, res) => res.json(await persistFiles(req)));

api.post('/files/delete', quoteWrite, async (req, res) => {
  res.json(await removeFile(req.body?.id, req.user, req.body?.revision));
});

api.get('/files/download', async (req, res) => {
  const f = (await query('SELECT * FROM attachments WHERE id=?', [String(req.query.id || '')]))[0];
  if (!f) throw new AppError('附件不存在', 404);
  const filePath = path.join(cfg.uploads, path.basename(f.stored_name));
  try {
    await fs.access(filePath);
  } catch {
    throw new AppError('附件文件不存在或已被移除', 404);
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(filePath, f.display_name);
});

api.get('/ai/models', async (req, res) => {
  const s = await settings();
  const defs = effectiveAiSettings(s);
  const defaults = {
    model: defs.model,
    thinkingLevel: clampThinkingForModel(defs.model, defs.thinkingLevel, cfg.thinkingLevel),
    enableSearch: defs.enableSearch,
    enableUrlContext: defs.enableUrlContext
  };
  const thinkingLevels = Array.isArray(aiMod.THINKING_LEVELS) ? aiMod.THINKING_LEVELS : THINKING_LEVELS;

  if (!cfg.aiConfigured) {
    res.json({
      configured: false,
      models: [],
      defaults,
      thinkingLevels,
      error: '尚未配置 AI 服务连接'
    });
    return;
  }

  const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
  const filterId = req.query.id ? String(req.query.id).trim() : null;

  try {
    if (typeof aiMod.listModels !== 'function') {
      throw new AppError('模型列表接口尚未就绪');
    }
    const rawResult = await aiMod.listModels({ refresh, id: filterId });
    const rawList = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.models) ? rawResult.models : [];
    const models = rawList
      .filter(m => m && typeof m.id === 'string' && m.id.trim())
      .map(m => {
        const mid = m.id.trim();
        const isImg = typeof m.isImageModel === 'boolean' ? m.isImageModel : isImageGenerationModel(mid);
        const supported =
          Array.isArray(m.supportedThinkingLevels) && m.supportedThinkingLevels.length
            ? m.supportedThinkingLevels
            : supportedThinkingFor(mid);
        return {
          id: mid,
          ownedBy: String(m.ownedBy || m.owned_by || ''),
          created: m.created ?? null,
          supportedThinkingLevels: supported,
          isImageModel: isImg
        };
      });
    res.json({
      configured: true,
      models,
      defaults,
      thinkingLevels
    });
  } catch (err) {
    const fallbackModel = filterId || defaults.model;
    const fallbackList = fallbackModel
      ? [
          {
            id: fallbackModel,
            ownedBy: 'default',
            created: null,
            supportedThinkingLevels: supportedThinkingFor(fallbackModel),
            isImageModel: isImageGenerationModel(fallbackModel)
          }
        ]
      : [];
    res.json({
      configured: true,
      models: fallbackList,
      defaults,
      thinkingLevels,
      error: cleanError(err)
    });
  }
});

api.post('/analysis/start', quoteWrite, analysisLimiter, async (req, res) => {
  const p = projectRow((await query('SELECT * FROM projects WHERE id=?', [String(req.body?.projectId || '')]))[0]);
  if (!p) throw new AppError('项目不存在', 404);
  await inputData(p.input, { required: true });

  const [attachments, s] = await Promise.all([
    query('SELECT * FROM attachments WHERE project_id=? ORDER BY created_at', [p.id]),
    settings()
  ]);
  const defs = effectiveAiSettings(s);
  const selectedModel = String(req.body?.model || '').trim() || defs.model;
  if (isImageGenerationModel(selectedModel)) {
    throw new AppError('所选模型为图像生成模型，不支持文本报价分析，请选择文本或多模态推理模型');
  }
  const rawThinking = req.body?.thinkingLevel !== undefined ? req.body.thinkingLevel : defs.thinkingLevel;
  const aiOptions = {
    model: selectedModel,
    thinkingLevel: clampThinkingForModel(selectedModel, rawThinking, defs.thinkingLevel),
    enableSearch: typeof req.body?.enableSearch === 'boolean' ? req.body.enableSearch : defs.enableSearch,
    enableUrlContext: typeof req.body?.enableUrlContext === 'boolean' ? req.body.enableUrlContext : defs.enableUrlContext
  };

  const runId = await startAnalysis(p, attachments, req.user, aiOptions);

  const latestAudit = (
    await query(
      "SELECT id, details_json FROM audit_logs WHERE entity_type='analysis' AND entity_id=? AND action='start' ORDER BY created_at DESC LIMIT 1",
      [runId]
    )
  )[0];
  if (latestAudit) {
    const merged = { ...parse(latestAudit.details_json), ...aiOptions };
    await query('UPDATE audit_logs SET details_json=? WHERE id=?', [JSON.stringify(merged), latestAudit.id]);
  } else {
    await audit(req.user, 'analysis', runId, 'start', {
      projectId: p.id,
      revision: p.revision,
      ...aiOptions
    });
  }

  res.json({ runId, aiOptions });
});

api.get('/analysis/get', async (req, res) => {
  const r = (await query('SELECT * FROM analysis_runs WHERE id=?', [String(req.query.id || '')]))[0];
  if (!r) throw new AppError('分析记录不存在', 404);
  res.json({ run: runRow(r) });
});

api.post('/analysis/cancel', quoteWrite, async (req, res) => {
  await cancelAnalysis(String(req.body?.id || ''), req.user);
  res.json({ ok: true });
});

api.post('/analysis/adjust', quoteWrite, async (req, res) => {
  const runId = String(req.body?.id || '');
  if (!runId) throw new AppError('缺少分析记录标识');
  const pricingSettings = await settings();

  const updatedRun = await tx(async conn => {
    const existing = (
      await query("SELECT * FROM analysis_runs WHERE id=? AND status='completed' FOR UPDATE", [runId], conn)
    )[0];
    if (!existing) throw new AppError('分析结果不存在', 404);
    const old = parse(existing.result_json);
    const input = parse(existing.input_json);
    const research = parse(existing.research_json, null) || { sources: [], warnings: [] };

    let nextResult;
    if (req.body?.reset === true && old.originalEstimate) {
      const orig = old.originalEstimate;
      const candidate = resultSchema.parse({
        ...old,
        costLines: orig.costLines,
        licenseLines: orig.licenseLines || []
      });
      const origMargin = Number(orig.totals?.margin ?? pricingSettings.defaultMargin ?? 35);
      const origRisk = Number(orig.totals?.riskReserve ?? 0);
      nextResult = calculateEstimate(
        candidate,
        { ...input, roles: [], otherCost: '', margin: origMargin, riskReserve: origRisk },
        { ...pricingSettings, laborRates: [] },
        research
      );
      delete nextResult.originalEstimate;
      delete nextResult.adjustedAt;
      delete nextResult.adjustedBy;
    } else {
      const rawCostLines = Array.isArray(req.body?.costLines) ? req.body.costLines : [];
      for (let i = 0; i < rawCostLines.length; i++) {
        const cl = rawCostLines[i];
        const low = Number(cl?.quantityLow);
        const base = Number(cl?.quantityBase);
        const high = Number(cl?.quantityHigh);
        const unitCost = Number(cl?.unitCostCNY);
        if (![low, base, high, unitCost].every(v => Number.isFinite(v) && v >= 0)) {
          throw new AppError(`第 ${i + 1} 项成本测算的数量与单价必须为非负数字`);
        }
        if (low > base || base > high) {
          throw new AppError(`第 ${i + 1} 项成本测算需满足：数量下限 <= 基准数量 <= 数量上限`);
        }
      }
      const candidate = resultSchema.parse({
        ...old,
        costLines: rawCostLines,
        licenseLines: Array.isArray(req.body?.licenseLines) ? req.body.licenseLines : old.licenseLines || []
      });
      const margin = Number(req.body?.margin);
      const risk = Number(req.body?.riskReserve);
      if (!(margin >= 0 && margin < 100) || !Number.isFinite(risk) || risk < 0) {
        throw new AppError('请检查目标毛利率（0% 至 99%）与风险预留金额（非负数字）');
      }
      nextResult = calculateEstimate(
        candidate,
        { ...input, roles: [], otherCost: '', margin, riskReserve: risk },
        { ...pricingSettings, laborRates: [] },
        research
      );
      nextResult.costLines = nextResult.costLines.map(l => ({ ...l, basis: '人工调整', confidence: 'high' }));
      nextResult.licenseLines = nextResult.licenseLines.map(l => ({
        ...l,
        basis: '人工确认定价',
        priceStatus: 'confirmed'
      }));
      nextResult.originalEstimate = old.originalEstimate || {
        costLines: old.costLines,
        licenseLines: old.licenseLines,
        totals: old.totals
      };
      nextResult.adjustedAt = new Date().toISOString();
      nextResult.adjustedBy = req.user.display_name;
    }

    await query('UPDATE analysis_runs SET result_json=? WHERE id=?', [JSON.stringify(nextResult), existing.id], conn);
    await audit(req.user, 'analysis', existing.id, 'adjust', { before: old.totals, after: nextResult.totals }, conn);
    return runRow((await query('SELECT * FROM analysis_runs WHERE id=?', [existing.id], conn))[0]);
  });

  res.json({ run: updatedRun });
});

api.post('/quotes/create', quoteWrite, async (req, res) => {
  const runId = String(req.body?.runId || '').trim();
  const projectId = String(req.body?.projectId || '').trim();

  if (runId) {
    const run = (await query("SELECT * FROM analysis_runs WHERE id=? AND status='completed'", [runId]))[0];
    if (!run) throw new AppError('请先完成分析后再生成报价，或直接手动创建报价草稿');
    const pRow = (await query('SELECT * FROM projects WHERE id=?', [run.project_id]))[0];
    if (!pRow) throw new AppError('项目不存在', 404);
    const p = projectRow(pRow);
    if (p.revision !== run.project_revision) {
      throw new AppError('需求已变更，请重新分析后生成报价，或直接手动创建报价草稿', 409);
    }
    res.json({ quote: await createQuote(p, run, req.user, req.body) });
    return;
  }

  if (projectId) {
    const pRow = (await query('SELECT * FROM projects WHERE id=?', [projectId]))[0];
    if (!pRow) throw new AppError('项目不存在', 404);
    res.json({ quote: await createQuote(projectRow(pRow), null, req.user, req.body) });
    return;
  }

  throw new AppError('缺少项目标识或分析任务标识');
});

api.get('/quotes/get', async (req, res) => {
  const q = (await query('SELECT * FROM quotes WHERE id=?', [String(req.query.id || '')]))[0];
  if (!q) throw new AppError('报价不存在', 404);
  const versions = await query(
    'SELECT id, revision, status, created_at FROM quote_versions WHERE quote_id=? ORDER BY revision DESC',
    [q.id]
  );
  res.json({
    quote: quoteRow(q),
    versions: versions.map(v => ({
      id: v.id,
      revision: v.revision,
      status: v.status,
      createdAt: v.created_at
    }))
  });
});

api.post('/quotes/save', quoteWrite, async (req, res) => res.json({ quote: await saveQuote(req.body, req.user) }));

api.post('/quotes/status', quoteWrite, async (req, res) =>
  res.json({ quote: await transitionQuote(req.body, req.user) })
);

api.post('/quotes/delete', quoteWrite, async (req, res) => {
  res.json(await deleteQuote(req.body?.id, req.user));
});

api.get('/quotes/version', async (req, res) => {
  const v = (await query('SELECT * FROM quote_versions WHERE id=?', [String(req.query.id || '')]))[0];
  if (!v) throw new AppError('报价历史版本不存在', 404);
  res.json({ version: { ...v, content: parse(v.content_json), totals: parse(v.totals_json) } });
});

api.get('/quotes/export', async (req, res) => {
  const q = quoteRow((await query('SELECT * FROM quotes WHERE id=?', [String(req.query.id || '')]))[0]);
  if (!q) throw new AppError('报价不存在', 404);
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'pdf';
  const buffer = format === 'xlsx' ? await xlsxBuffer(q) : await pdfBuffer(q);
  const isDraft = !['approved', 'sent', 'won'].includes(q.status);
  const filename = `${q.number}${isDraft ? '-draft' : ''}.${format}`;
  res
    .type(
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf'
    )
    .attachment(filename)
    .send(buffer);
  await audit(req.user, 'quote', q.id, 'export', { format, status: q.status });
});

api.get('/references/list', async (_req, res) =>
  res.json({ references: await query('SELECT * FROM price_references ORDER BY created_at DESC LIMIT 300') })
);

api.post('/references/save', quoteWrite, async (req, res) => {
  const v = referenceSchema.parse(req.body);
  if (v.source_url && !/^https?:\/\//.test(v.source_url)) {
    throw new AppError('公开来源链接需以 http:// 或 https:// 开头');
  }
  const existingId = req.body?.id ? String(req.body.id) : '';
  const refId = existingId || id();
  if (existingId) {
    const r = await query(
      'UPDATE price_references SET title=?, service_kind=?, evidence_type=?, amount=?, currency=?, source_url=?, scope_text=?, reference_date=?, notes=? WHERE id=?',
      [v.title, v.service_kind, v.evidence_type, v.amount, v.currency, v.source_url, v.scope_text, v.reference_date, v.notes, refId]
    );
    if (!r.affectedRows) throw new AppError('价格参考记录不存在', 404);
  } else {
    await query(
      'INSERT INTO price_references(id, title, service_kind, evidence_type, amount, currency, source_url, scope_text, reference_date, notes, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [refId, v.title, v.service_kind, v.evidence_type, v.amount, v.currency, v.source_url, v.scope_text, v.reference_date, v.notes, req.user.id]
    );
  }
  await audit(req.user, 'reference', refId, existingId ? 'save' : 'create');
  res.json({ id: refId });
});

api.post('/references/delete', quoteWrite, async (req, res) => {
  const refId = String(req.body?.id || '');
  if (!refId) throw new AppError('缺少价格参考记录标识');
  const r = await query('DELETE FROM price_references WHERE id=?', [refId]);
  if (!r.affectedRows) throw new AppError('价格参考记录不存在', 404);
  await audit(req.user, 'reference', refId, 'delete');
  res.json({ ok: true });
});

api.get('/assets/list', async (_req, res) =>
  res.json({ assets: await query('SELECT * FROM product_assets ORDER BY updated_at DESC LIMIT 300') })
);

api.post('/assets/save', async (req, res) => {
  const v = assetSchema.parse({
    ...req.body,
    progress: req.body?.progress === '' || req.body?.progress === undefined ? null : req.body.progress
  });
  const existingId = req.body?.id ? String(req.body.id) : '';
  const assetId = existingId || id();
  if (existingId) {
    const r = await query(
      'UPDATE product_assets SET name=?, version=?, service_kind=?, stage=?, progress=?, completed_work=?, remaining_work=?, notes=?, updated_at=UTC_TIMESTAMP(3) WHERE id=?',
      [v.name, v.version, v.service_kind, v.stage, v.progress, v.completed_work, v.remaining_work, v.notes, assetId]
    );
    if (!r.affectedRows) throw new AppError('产品成果记录不存在', 404);
  } else {
    await query(
      'INSERT INTO product_assets(id, name, version, service_kind, stage, progress, completed_work, remaining_work, notes, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [assetId, v.name, v.version, v.service_kind, v.stage, v.progress, v.completed_work, v.remaining_work, v.notes, req.user.id]
    );
  }
  await audit(req.user, 'asset', assetId, existingId ? 'save' : 'create');
  res.json({ id: assetId });
});

api.post('/assets/delete', async (req, res) => {
  const assetId = String(req.body?.id || '');
  if (!assetId) throw new AppError('缺少产品成果记录标识');
  const r = await query('DELETE FROM product_assets WHERE id=?', [assetId]);
  if (!r.affectedRows) throw new AppError('产品成果记录不存在', 404);
  await audit(req.user, 'asset', assetId, 'delete');
  res.json({ ok: true });
});

api.get('/settings/get', async (req, res) => {
  const s = await settings();
  const defs = effectiveAiSettings(s);
  res.json({
    settings: s,
    ai: {
      configured: cfg.aiConfigured,
      model: defs.model,
      thinkingLevel: defs.thinkingLevel,
      enableSearch: defs.enableSearch,
      enableUrlContext: defs.enableUrlContext,
      baseUrlConfigured: cfg.baseUrlConfigured
    },
    brandName: cfg.brandName,
    users:
      req.user.role === 'admin'
        ? (await query('SELECT * FROM users ORDER BY created_at')).map(publicUser)
        : undefined
  });
});

api.post('/settings/save', allow('admin'), async (req, res) => {
  const v = settingSchema.parse(req.body);
  const current = await settings();
  const nextModel =
    v.aiModel !== undefined ? String(v.aiModel || '').trim() || cfg.model : current.aiModel || cfg.model;
  if (isImageGenerationModel(nextModel)) {
    throw new AppError('默认推理模型不能设为纯图像生成模型，请选择文本或多模态推理模型');
  }
  const rawThinking = v.thinkingLevel !== undefined ? v.thinkingLevel : current.thinkingLevel;
  const merged = {
    ...current,
    ...v,
    aiModel: nextModel,
    thinkingLevel: clampThinkingForModel(nextModel, rawThinking, cfg.thinkingLevel),
    enableSearch: typeof v.enableSearch === 'boolean' ? v.enableSearch : current.enableSearch,
    enableUrlContext: typeof v.enableUrlContext === 'boolean' ? v.enableUrlContext : current.enableUrlContext
  };
  await query(
    "UPDATE app_settings SET value_json=?, updated_by=?, updated_at=UTC_TIMESTAMP(3) WHERE setting_key='pricing'",
    [JSON.stringify(merged), req.user.id]
  );
  await audit(req.user, 'settings', null, 'save', {
    aiModel: merged.aiModel,
    thinkingLevel: merged.thinkingLevel,
    enableSearch: merged.enableSearch,
    enableUrlContext: merged.enableUrlContext
  });
  res.json({ settings: merged });
});

api.post('/settings/ai-check', allow('admin'), async (req, res) => {
  const s = await settings();
  const defs = effectiveAiSettings(s);
  const targetModel = String(req.body?.model || '').trim() || defs.model;
  if (isImageGenerationModel(targetModel)) {
    throw new AppError('所选模型为图像生成模型，不支持文本推理测试');
  }
  const rawThinking = req.body?.thinkingLevel !== undefined ? req.body.thinkingLevel : defs.thinkingLevel;
  const targetThinking = clampThinkingForModel(targetModel, rawThinking, defs.thinkingLevel);
  const targetSearch = typeof req.body?.enableSearch === 'boolean' ? req.body.enableSearch : defs.enableSearch;
  const targetUrlContext =
    typeof req.body?.enableUrlContext === 'boolean' ? req.body.enableUrlContext : defs.enableUrlContext;

  const t0 = Date.now();
  const r = await aiMod.chat([{ role: 'user', content: '连通性测试，请仅回复 OK' }], {
    model: targetModel,
    thinkingLevel: targetThinking,
    enableSearch: targetSearch,
    enableUrlContext: targetUrlContext,
    maxTokens: 4096
  });
  const latencyMs = Date.now() - t0;
  const reply = String(typeof r === 'string' ? r : r?.text || '').trim().slice(0, 200);
  res.json({
    ok: Boolean(reply),
    model: (typeof r === 'object' && r?.model) || targetModel,
    thinkingLevel: targetThinking,
    latencyMs,
    reply
  });
});

api.post('/users/save', allow('admin'), async (req, res) => {
  const role = String(req.body?.role || '');
  if (!roles.includes(role)) throw new AppError('请选择有效的成员角色');
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) throw new AppError('请填写成员姓名（100 字以内）');

  const targetId = req.body?.id ? String(req.body.id) : '';
  if (targetId) {
    const existing = (await query('SELECT * FROM users WHERE id=?', [targetId]))[0];
    if (!existing) throw new AppError('成员不存在', 404);
    const nextStatus = req.body?.status === 'disabled' ? 'disabled' : 'active';
    if (targetId === req.user.id && (role !== 'admin' || nextStatus === 'disabled')) {
      throw new AppError('不能停用或降级当前登录的管理员账号');
    }
    await query('UPDATE users SET display_name=?, role=?, status=? WHERE id=?', [
      name,
      role,
      nextStatus,
      targetId
    ]);
    if (req.body?.password) {
      const pw = validatePassword(req.body.password);
      await query('UPDATE users SET password_hash=? WHERE id=?', [await passwordHash(pw), targetId]);
    }
    if (nextStatus === 'disabled') {
      await query('DELETE FROM sessions WHERE user_id=?', [targetId]);
    } else if (req.body?.password || existing.role !== role) {
      await query('DELETE FROM sessions WHERE user_id=? AND id<>?', [targetId, req.sessionId]);
    }
    await audit(req.user, 'user', targetId, 'save', { role, status: nextStatus });
  } else {
    const c = credentials(req.body);
    const newId = id();
    try {
      await query('INSERT INTO users(id, username, display_name, password_hash, role) VALUES(?,?,?,?,?)', [
        newId,
        c.username,
        name,
        await passwordHash(c.password),
        role
      ]);
    } catch (e) {
      if (e?.code === 'ER_DUP_ENTRY') throw new AppError('该登录账号已存在，请更换账号名称', 409);
      throw e;
    }
    await audit(req.user, 'user', newId, 'create', { role });
  }
  res.json({ ok: true });
});

api.get('/audit/list', allow('admin', 'reviewer'), async (_req, res) =>
  res.json({
    logs: await query(
      'SELECT a.*, u.display_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100'
    )
  })
);

api.use((_req, res) => res.status(404).json({ error: '接口不存在' }));

const web = express.Router();
web.use('/api', api);

web.get('/client/config.js', (_req, res) =>
  res
    .type('application/javascript')
    .set('Cache-Control', 'no-store')
    .send(
      'window.APP_BASE=' +
        JSON.stringify(cfg.basePath) +
        ';window.APP_BRAND_NAME=' +
        JSON.stringify(cfg.brandName) +
        ';window.appPath=path=>(window.APP_BASE||"")+path;window.QUOTE_PLATFORM=true;window.quoteErrors=[];window.addEventListener("error",e=>window.quoteErrors.push(e.message));window.addEventListener("unhandledrejection",e=>window.quoteErrors.push(String(e.reason)));'
    )
);

web.get(['/', '/quote-input/'], async (_req, res) => {
  res.type('html').send(await renderClientHtml());
});

web.use('/client', express.static(path.join(root, 'client')));
web.use('/quote-input', express.static(path.join(root, 'designs/quote-input'), { index: false }));

if (cfg.basePath) {
  app.use(cfg.basePath, web);
}
app.use('/', web);

const FIELD_LABELS = {
  title: '名称',
  customer: '客户公司',
  seller: '报价方公司',
  sellerAddress: '报价方地址',
  sellerContact: '报价方联系方式',
  language: '报价语言',
  currency: '币种',
  fxRate: '参考汇率',
  fxSource: '汇率来源',
  fxDate: '汇率日期',
  validity: '报价有效期',
  taxMode: '税费口径',
  taxRate: '税率',
  discountPercent: '折扣比例',
  paymentTerms: '付款条款',
  deliveryTerms: '交付与验收条款',
  notes: '备注说明',
  items: '报价明细',
  name: '名称',
  description: '范围说明',
  quantity: '数量',
  unit: '单位',
  unitPrice: '单价',
  service_kind: '业务类别',
  evidence_type: '证据类别',
  amount: '金额',
  source_url: '公开来源链接',
  scope_text: '范围与可比条件',
  reference_date: '参考日期',
  version: '版本',
  stage: '当前状态',
  progress: '完成进度',
  completed_work: '已完成内容',
  remaining_work: '待完善工作',
  companyName: '公司名称',
  companyAddress: '公司地址',
  companyContact: '联系方式',
  defaultMargin: '默认目标毛利率',
  defaultRiskPercent: '默认风险预留比例',
  rateNote: '成本单价说明',
  laborRates: '岗位人日成本',
  aiModel: '默认推理模型',
  thinkingLevel: '默认思考强度',
  enableSearch: '实时联网检索配置',
  enableUrlContext: '链接内容读取配置',
  role: '岗位名称',
  rate: '人日成本单价',
  quantityLow: '数量下限',
  quantityBase: '基准数量',
  quantityHigh: '数量上限',
  unitCostCNY: '成本单价',
  unitPriceCNY: '授权单价'
};

function describeZodPath(pathArr) {
  if (!Array.isArray(pathArr) || !pathArr.length) return '输入内容';
  if (pathArr[0] === 'items' && typeof pathArr[1] === 'number') {
    const sub = FIELD_LABELS[pathArr[2]] || '字段';
    return `第 ${pathArr[1] + 1} 项报价明细的${sub}`;
  }
  if (pathArr[0] === 'laborRates' && typeof pathArr[1] === 'number') {
    const sub = FIELD_LABELS[pathArr[2]] || '字段';
    return `第 ${pathArr[1] + 1} 个岗位的${sub}`;
  }
  if (pathArr[0] === 'costLines' && typeof pathArr[1] === 'number') {
    const sub = FIELD_LABELS[pathArr[2]] || '字段';
    return `第 ${pathArr[1] + 1} 项成本测算的${sub}`;
  }
  if (pathArr[0] === 'licenseLines' && typeof pathArr[1] === 'number') {
    const sub = FIELD_LABELS[pathArr[2]] || '字段';
    return `第 ${pathArr[1] + 1} 项授权测算的${sub}`;
  }
  const last = [...pathArr].reverse().find(k => typeof k === 'string');
  return FIELD_LABELS[last] || '填写内容';
}

function formatZodIssue(issue) {
  const label = describeZodPath(issue.path);
  const origin = issue.origin || issue.type;
  if (issue.code === 'too_small') {
    if (origin === 'string') {
      return Number(issue.minimum) <= 1 ? `请填写${label}` : `${label}至少需要 ${issue.minimum} 个字符`;
    }
    if (origin === 'array') return `${label}至少需要保留 ${issue.minimum} 项`;
    if (typeof issue.minimum === 'number') {
      return issue.inclusive === false ? `${label}需大于 ${issue.minimum}` : `${label}不能小于 ${issue.minimum}`;
    }
    return `请完善${label}`;
  }
  if (issue.code === 'too_big') {
    if (origin === 'string') return `${label}长度不能超过 ${issue.maximum} 个字符`;
    if (origin === 'array') return `${label}数量不能超过 ${issue.maximum} 项`;
    if (typeof issue.maximum === 'number') return `${label}不能超过 ${issue.maximum}`;
    return `${label}超出允许上限`;
  }
  if (issue.code === 'invalid_value' || issue.code === 'invalid_enum_value') {
    return `请选择有效的${label}`;
  }
  if (issue.code === 'invalid_type') {
    return `${label}格式不正确`;
  }
  return `${label}填写不正确`;
}

function formatZodError(err) {
  const messages = [];
  for (const issue of (err.issues || []).slice(0, 3)) {
    const msg = formatZodIssue(issue);
    if (!messages.includes(msg)) messages.push(msg);
  }
  return messages.length ? '请检查输入：' + messages.join('；') : '输入格式不正确，请检查填写内容';
}

app.use((err, req, res, _next) => {
  if (res.headersSent) return;
  const status =
    err instanceof z.ZodError
      ? 400
      : err.code === 'ER_DUP_ENTRY'
      ? 409
      : err.code === 'LIMIT_FILE_SIZE'
      ? 413
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
      ? 400
      : err.status || 500;
  const message =
    err instanceof z.ZodError
      ? formatZodError(err)
      : err.code === 'ER_DUP_ENTRY'
      ? '记录已存在，请勿重复提交'
      : err.code === 'LIMIT_FILE_SIZE'
      ? '单个文件不能超过 20 MB'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
      ? '单次最多上传 10 个文件'
      : status === 500
      ? '服务暂时无法完成请求，请稍后重试'
      : cleanError(err);
  if (status >= 500) console.error(new Date().toISOString(), req.path, cleanError(err));
  res.status(status).json({ error: message });
});

await ensureClientBuild();
await initDb();
const server = app.listen(cfg.port, cfg.host, () =>
  console.log(`${cfg.brandName}运行于 http://${cfg.host}:${cfg.port}${cfg.basePath || ''}`)
);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
