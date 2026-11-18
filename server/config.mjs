import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

export const root = process.cwd();

export const THINKING_LEVELS = ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'NONE'];

export function normalizeThinkingLevel(value, fallback = 'AUTO') {
  const up = String(value || '').trim().toUpperCase();
  return THINKING_LEVELS.includes(up) ? up : fallback;
}

function parsePort(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

function parseBoolEnv(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function isLocalAiEndpoint(rawUrl) {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'].includes(h) ||
      h.endsWith('.local') ||
      h.endsWith('.internal')
    ) {
      return true;
    }
    const parts = h.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      if (parts[0] === 10 || parts[0] === 127) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const explicitAiUrl = (
  process.env.AI_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  process.env.VERTEX_BASE_URL ||
  ''
).trim().replace(/\/+$/, '');

const resolvedAiKey = (
  process.env.AI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.VERTEX_API_KEY ||
  ''
).trim();

const resolvedAiUrl = explicitAiUrl || (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1' : '');

const resolvedModel = (
  process.env.AI_MODEL ||
  process.env.OPENAI_MODEL ||
  process.env.VERTEX_MODEL ||
  ''
).trim() || 'gemini-3.8-flash';

export const cfg = {
  basePath: (process.env.APP_BASE_PATH || '').trim().replace(/\/+$/, ''),
  host: (process.env.HOST || '').trim() || '127.0.0.1',
  port: parsePort(process.env.PORT, 4312),
  brandName: (process.env.APP_BRAND_NAME || '').trim() || '报价工作台',
  defaultCompanyName: (process.env.DEFAULT_COMPANY_NAME || '').trim(),
  cookieSecure: (process.env.COOKIE_SECURE || 'auto').trim().toLowerCase(),
  searchProvider: (process.env.SEARCH_PROVIDER || '').trim().toLowerCase(),
  db: {
    host: (process.env.DB_HOST || '').trim() || '127.0.0.1',
    port: parsePort(process.env.DB_PORT, 3397),
    user: (process.env.DB_USER || '').trim() || 'price_agent',
    password: process.env.DB_PASSWORD ?? '',
    database: (process.env.DB_NAME || '').trim() || 'price_agent',
    charset: 'utf8mb4',
    connectionLimit: 10,
    decimalNumbers: true,
    timezone: 'Z'
  },
  vertexUrl: resolvedAiUrl,
  vertexKey: resolvedAiKey,
  aiBaseUrl: resolvedAiUrl,
  aiApiKey: resolvedAiKey,
  model: resolvedModel,
  thinkingLevel: normalizeThinkingLevel(process.env.VERTEX_THINKING_LEVEL || process.env.AI_THINKING_LEVEL, 'AUTO'),
  enableSearch: parseBoolEnv(process.env.VERTEX_ENABLE_SEARCH ?? process.env.AI_ENABLE_SEARCH, true),
  enableUrlContext: parseBoolEnv(process.env.VERTEX_ENABLE_URL_CONTEXT ?? process.env.AI_ENABLE_URL_CONTEXT, true),
  baseUrlConfigured: Boolean(resolvedAiUrl),
  aiConfigured: Boolean(resolvedAiUrl && (resolvedAiKey || isLocalAiEndpoint(resolvedAiUrl))),
  pdfFontPath: (process.env.PDF_FONT_PATH || '').trim() || path.join(root, 'server/assets/NotoSansCJKsc-Regular.otf'),
  uploads: path.join(root, '.local/uploads')
};

fs.mkdirSync(cfg.uploads, { recursive: true });

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const parse = (v, fallback = {}) => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : v ?? fallback;
  } catch {
    return fallback;
  }
};

export const cleanError = e =>
  String(e?.message || e)
    .replace(/(?:sk-|tvly-|AIza|Bearer\s+)[A-Za-z0-9._-]+/g, '[redacted]')
    .slice(0, 500);

if (cfg.basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(cfg.basePath)) {
  throw new Error('APP_BASE_PATH 格式不正确');
}
