import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { cfg, parse, cleanError, normalizeThinkingLevel } from './config.mjs';

export const pool = mysql.createPool(cfg.db);
export const id = () => randomUUID();

export async function query(sql, args = [], conn = pool) {
  const [rows] = await conn.execute(sql, args);
  return rows;
}

export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

const CURRENCY_COMMENT = 'CNY 人民币; USD 美元; EUR 欧元; GBP 英镑; HKD 港元; JPY 日元; SGD 新加坡元';
const QUOTE_STATUS_COMMENT = 'draft 草稿; review 待审核; approved 已批准; sent 已发送; won 已成交; lost 未成交';
const ENTITY_TYPE_COMMENT = '对象类型: user 用户; project 项目; analysis 分析任务; quote 报价单; reference 价格参考; asset 产品资产; settings 系统配置';
const AUDIT_ACTION_COMMENT = '操作名称: login 登录; create 创建; save 保存; delete 删除; upload 上传附件; delete-file 删除附件; start 发起分析; cancel 取消分析; complete 完成分析; adjust 调整测算; edit 编辑报价; status 状态流转; export 导出报价';

const schemas = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY COMMENT '用户标识',
    username VARCHAR(80) NOT NULL UNIQUE COMMENT '登录账号',
    display_name VARCHAR(100) NOT NULL COMMENT '姓名',
    password_hash VARCHAR(255) NOT NULL COMMENT '加盐密码摘要',
    role VARCHAR(30) NOT NULL COMMENT '角色类型: admin 管理员; reviewer 审核人; presales 售前; sales 销售; engineer 研发',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '账号状态: active 启用; disabled 停用',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间'
  ) COMMENT='内部用户'`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY COMMENT '会话令牌摘要',
    user_id VARCHAR(36) NOT NULL COMMENT '用户标识',
    csrf_token VARCHAR(64) NOT NULL COMMENT '请求校验令牌',
    expires_at DATETIME(3) NOT NULL COMMENT '过期时间',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    INDEX idx_session_user(user_id),
    INDEX idx_session_expiry(expires_at)
  ) COMMENT='登录会话'`,
  `CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(36) PRIMARY KEY COMMENT '项目标识',
    number VARCHAR(40) NOT NULL UNIQUE COMMENT '项目编号',
    input_json LONGTEXT NOT NULL COMMENT '需求输入快照',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT '项目状态: draft 需求草稿; analyzing 分析中; ready 已分析; quoted 已报价; won 已成交; lost 未成交',
    revision INT NOT NULL DEFAULT 1 COMMENT '需求版本，用于并发校验',
    current_run_id VARCHAR(36) NULL COMMENT '最近分析标识',
    owner_id VARCHAR(36) NOT NULL COMMENT '项目负责人',
    created_by VARCHAR(36) NOT NULL COMMENT '创建人',
    updated_by VARCHAR(36) NOT NULL COMMENT '更新人',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    INDEX idx_project_updated(updated_at),
    INDEX idx_project_owner(owner_id)
  ) COMMENT='报价项目'`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id VARCHAR(36) PRIMARY KEY COMMENT '附件标识',
    project_id VARCHAR(36) NOT NULL COMMENT '所属项目',
    display_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
    stored_name VARCHAR(80) NOT NULL COMMENT '服务端存储名',
    mime VARCHAR(100) NOT NULL COMMENT '文件类型',
    size_bytes BIGINT NOT NULL COMMENT '文件大小',
    text_content LONGTEXT NULL COMMENT '提取的文本',
    parse_status VARCHAR(30) NOT NULL COMMENT '解析状态: ready 已解析; image 图片; unsupported 暂不支持提取; failed 提取失败',
    created_by VARCHAR(36) NOT NULL COMMENT '上传人',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '上传时间',
    INDEX idx_attachment_project(project_id)
  ) COMMENT='需求附件'`,
  `CREATE TABLE IF NOT EXISTS analysis_runs (
    id VARCHAR(36) PRIMARY KEY COMMENT '分析标识',
    project_id VARCHAR(36) NOT NULL COMMENT '所属项目',
    project_revision INT NOT NULL COMMENT '分析时需求版本',
    status VARCHAR(30) NOT NULL COMMENT '任务状态: queued 排队; running 执行中; completed 完成; failed 失败; canceled 已取消',
    stage VARCHAR(150) NOT NULL COMMENT '当前阶段',
    progress INT NOT NULL DEFAULT 0 COMMENT '完成百分比',
    input_json LONGTEXT NOT NULL COMMENT '不可变需求快照',
    result_json LONGTEXT NULL COMMENT '结构化分析结果',
    research_json LONGTEXT NULL COMMENT '联网结果与来源',
    error_message TEXT NULL COMMENT '失败原因',
    usage_json TEXT NULL COMMENT '模型用量',
    model VARCHAR(160) NULL COMMENT '调用模型与思考档位',
    created_by VARCHAR(36) NOT NULL COMMENT '发起人',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '开始时间',
    completed_at DATETIME(3) NULL COMMENT '结束时间',
    INDEX idx_run_project(project_id, created_at)
  ) COMMENT='AI 分析任务'`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id VARCHAR(36) PRIMARY KEY COMMENT '报价标识',
    project_id VARCHAR(36) NOT NULL COMMENT '所属项目',
    run_id VARCHAR(36) NULL COMMENT '依据分析任务',
    number VARCHAR(40) NOT NULL UNIQUE COMMENT '报价编号',
    revision INT NOT NULL DEFAULT 1 COMMENT '编辑版本',
    status VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT '报价状态: ${QUOTE_STATUS_COMMENT}',
    currency VARCHAR(8) NOT NULL COMMENT '报价币种: ${CURRENCY_COMMENT}',
    content_json LONGTEXT NOT NULL COMMENT '对外报价内容',
    totals_json TEXT NOT NULL COMMENT '服务端计算金额',
    approved_by VARCHAR(36) NULL COMMENT '批准人',
    approved_at DATETIME(3) NULL COMMENT '批准时间',
    created_by VARCHAR(36) NOT NULL COMMENT '创建人',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间',
    INDEX idx_quote_project(project_id)
  ) COMMENT='对外报价'`,
  `CREATE TABLE IF NOT EXISTS quote_versions (
    id VARCHAR(36) PRIMARY KEY COMMENT '快照标识',
    quote_id VARCHAR(36) NOT NULL COMMENT '报价标识',
    revision INT NOT NULL COMMENT '报价版本',
    status VARCHAR(30) NOT NULL COMMENT '保存时状态: ${QUOTE_STATUS_COMMENT}',
    content_json LONGTEXT NOT NULL COMMENT '对外内容快照',
    totals_json TEXT NOT NULL COMMENT '金额快照',
    created_by VARCHAR(36) NOT NULL COMMENT '操作人',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '时间',
    UNIQUE KEY uk_quote_revision(quote_id, revision)
  ) COMMENT='报价历史版本'`,
  `CREATE TABLE IF NOT EXISTS price_references (
    id VARCHAR(36) PRIMARY KEY COMMENT '参考标识',
    title VARCHAR(255) NOT NULL COMMENT '项目或价格名称',
    service_kind VARCHAR(100) NOT NULL COMMENT '业务类别',
    evidence_type VARCHAR(30) NOT NULL COMMENT '证据类型: deal 已确认成交; award 公开中标; listing 公开标价; estimate 估算',
    amount DECIMAL(18,2) NOT NULL COMMENT '参考金额',
    currency VARCHAR(8) NOT NULL COMMENT '原始币种: ${CURRENCY_COMMENT}',
    source_url TEXT NULL COMMENT '公开来源',
    scope_text TEXT NOT NULL COMMENT '范围与可比条件',
    reference_date VARCHAR(30) NULL COMMENT '成交或公布日期',
    notes TEXT NULL COMMENT '内部说明',
    created_by VARCHAR(36) NOT NULL COMMENT '录入人',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '录入时间'
  ) COMMENT='历史成交与市场参考库'`,
  `CREATE TABLE IF NOT EXISTS product_assets (
    id VARCHAR(36) PRIMARY KEY COMMENT '产品资产标识',
    name VARCHAR(200) NOT NULL COMMENT '产品名称',
    version VARCHAR(100) NOT NULL COMMENT '版本',
    service_kind VARCHAR(60) NOT NULL COMMENT '业务类别: license 授权; software 软件; model 模型; solution 方案; custom 自定义',
    stage VARCHAR(150) NOT NULL COMMENT '当前产品状态',
    progress DECIMAL(5,2) NULL COMMENT '产品完成百分比，未知为空',
    completed_work TEXT NOT NULL COMMENT '已完成与可复用内容',
    remaining_work TEXT NOT NULL COMMENT '已知待完善工作',
    notes TEXT NULL COMMENT '适用场景与限制',
    created_by VARCHAR(36) NOT NULL COMMENT '录入人',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间'
  ) COMMENT='已有产品与成果库'`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(80) PRIMARY KEY COMMENT '配置键: pricing 定价与报价主体配置',
    value_json LONGTEXT NOT NULL COMMENT '非敏感配置内容',
    updated_by VARCHAR(36) NULL COMMENT '修改人',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间'
  ) COMMENT='系统配置'`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY COMMENT '记录标识',
    user_id VARCHAR(36) NULL COMMENT '操作人',
    entity_type VARCHAR(40) NOT NULL COMMENT '${ENTITY_TYPE_COMMENT}',
    entity_id VARCHAR(36) NULL COMMENT '对象标识',
    action VARCHAR(80) NOT NULL COMMENT '${AUDIT_ACTION_COMMENT}',
    details_json TEXT NULL COMMENT '操作摘要，不含密钥',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '时间',
    INDEX idx_audit_entity(entity_type, entity_id)
  ) COMMENT='操作审计'`
];

const columnCommentUpdates = [
  ['quotes', 'currency', 'VARCHAR(8) NOT NULL', `报价币种: ${CURRENCY_COMMENT}`],
  ['quote_versions', 'status', 'VARCHAR(30) NOT NULL', `保存时状态: ${QUOTE_STATUS_COMMENT}`],
  ['price_references', 'currency', 'VARCHAR(8) NOT NULL', `原始币种: ${CURRENCY_COMMENT}`],
  ['app_settings', 'setting_key', 'VARCHAR(80) NOT NULL', '配置键: pricing 定价与报价主体配置'],
  ['audit_logs', 'entity_type', 'VARCHAR(40) NOT NULL', ENTITY_TYPE_COMMENT],
  ['audit_logs', 'action', 'VARCHAR(80) NOT NULL', AUDIT_ACTION_COMMENT]
];

export function defaultSettings() {
  return {
    companyName: cfg.defaultCompanyName || '',
    companyAddress: '',
    companyContact: '',
    defaultMargin: 35,
    defaultRiskPercent: 15,
    laborRates: [
      { role: '算法工程师', rate: 2000 },
      { role: '软件工程师', rate: 1800 },
      { role: '测试工程师', rate: 1200 },
      { role: '项目经理', rate: 1600 }
    ],
    rateNote: '初始内部假设，请按公司实际成本校准',
    aiModel: cfg.model,
    thinkingLevel: cfg.thinkingLevel,
    enableSearch: cfg.enableSearch,
    enableUrlContext: cfg.enableUrlContext
  };
}

export function effectiveAiSettings(s) {
  return {
    model: String(s?.aiModel || '').trim() || cfg.model,
    thinkingLevel: normalizeThinkingLevel(s?.thinkingLevel, cfg.thinkingLevel),
    enableSearch: typeof s?.enableSearch === 'boolean' ? s.enableSearch : cfg.enableSearch,
    enableUrlContext: typeof s?.enableUrlContext === 'boolean' ? s.enableUrlContext : cfg.enableUrlContext
  };
}

export async function cleanExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
}

async function waitForDatabase(maxAttempts = 6) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await query('SELECT 1');
      return;
    } catch (err) {
      lastErr = err;
      const fatalAuth = ['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err?.code);
      if (fatalAuth || attempt === maxAttempts) break;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  console.error(
    `数据库连接失败 (${cfg.db.host}:${cfg.db.port}/${cfg.db.database}): ${cleanError(lastErr)}。` +
    '请检查 .env 中的 DB_HOST、DB_PORT、DB_USER、DB_PASSWORD 配置，或执行 npm run db:start 启动本地 MySQL 服务。'
  );
  throw lastErr;
}

async function syncColumnComments() {
  const existing = await query(
    'SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_COMMENT AS cmt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?',
    [cfg.db.database]
  );
  const map = new Map(existing.map(r => [`${r.tbl}.${r.col}`, r.cmt || '']));
  if (map.has('analysis_runs.id') && !map.has('analysis_runs.model')) {
    await query("ALTER TABLE `analysis_runs` ADD COLUMN `model` VARCHAR(160) NULL COMMENT '调用模型与思考档位' AFTER `usage_json`");
  }
  for (const [tbl, col, definition, comment] of columnCommentUpdates) {
    if (map.has(`${tbl}.${col}`) && map.get(`${tbl}.${col}`) !== comment) {
      const escaped = comment.replaceAll("'", "''");
      await query(`ALTER TABLE \`${tbl}\` MODIFY COLUMN \`${col}\` ${definition} COMMENT '${escaped}'`);
    }
  }
}

export async function initDb() {
  await waitForDatabase();
  for (const sql of schemas) await query(sql);
  await syncColumnComments();
  await query('INSERT IGNORE INTO app_settings(setting_key, value_json) VALUES(?, ?)', [
    'pricing',
    JSON.stringify(defaultSettings())
  ]);
  await cleanExpiredSessions();
  await query(
    "UPDATE analysis_runs SET status='failed', stage='执行中断，可重新分析', error_message='服务重启，请重新发起分析', completed_at=UTC_TIMESTAMP(3) WHERE status IN ('running','queued')"
  );
  await query("UPDATE projects SET status='draft' WHERE status='analyzing'");
}

export async function settings() {
  const raw = (await query('SELECT value_json FROM app_settings WHERE setting_key=?', ['pricing']))[0]?.value_json;
  const parsed = parse(raw, null);
  const base = defaultSettings();
  if (!parsed || typeof parsed !== 'object') return base;
  const ai = effectiveAiSettings(parsed);
  return {
    ...base,
    ...parsed,
    aiModel: ai.model,
    thinkingLevel: ai.thinkingLevel,
    enableSearch: ai.enableSearch,
    enableUrlContext: ai.enableUrlContext
  };
}

export async function audit(user, entityType, entityId, action, details = {}, conn = pool) {
  await query(
    'INSERT INTO audit_logs(id, user_id, entity_type, entity_id, action, details_json) VALUES(?,?,?,?,?,?)',
    [id(), user?.id || null, entityType, entityId || null, action, JSON.stringify(details)],
    conn
  );
}

export async function syncProjectStatus(projectId, conn = pool) {
  const p = (await query('SELECT id, status, revision FROM projects WHERE id=? FOR UPDATE', [projectId], conn))[0];
  if (!p || p.status === 'analyzing') return p?.status || null;
  const quotes = await query('SELECT status FROM quotes WHERE project_id=?', [projectId], conn);
  let nextStatus = 'draft';
  if (quotes.some(q => q.status === 'won')) {
    nextStatus = 'won';
  } else if (quotes.some(q => ['draft', 'review', 'approved', 'sent'].includes(q.status))) {
    nextStatus = 'quoted';
  } else if (quotes.length > 0 && quotes.every(q => q.status === 'lost')) {
    nextStatus = 'lost';
  } else {
    const completedRuns = await query(
      "SELECT id FROM analysis_runs WHERE project_id=? AND project_revision=? AND status='completed' LIMIT 1",
      [projectId, p.revision],
      conn
    );
    nextStatus = completedRuns.length ? 'ready' : 'draft';
  }
  if (nextStatus !== p.status) {
    await query('UPDATE projects SET status=?, updated_at=UTC_TIMESTAMP(3) WHERE id=?', [nextStatus, projectId], conn);
  }
  return nextStatus;
}

export function projectRow(r) {
  return (
    r && {
      id: r.id,
      number: r.number,
      input: parse(r.input_json),
      status: r.status,
      revision: r.revision,
      currentRunId: r.current_run_id,
      ownerId: r.owner_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  );
}

export function runRow(r) {
  if (!r) return r;
  const result = parse(r.result_json, null);
  const usage = parse(r.usage_json, null);
  const aiMeta = result?.aiMeta || usage?.aiMeta || null;
  return {
    id: r.id,
    projectId: r.project_id,
    projectRevision: r.project_revision,
    status: r.status,
    stage: r.stage,
    progress: r.progress,
    model: r.model || aiMeta?.model || usage?.model || null,
    aiMeta,
    result,
    research: parse(r.research_json, null),
    error: r.error_message,
    usage,
    createdAt: r.created_at,
    completedAt: r.completed_at
  };
}

export function quoteRow(r) {
  return (
    r && {
      id: r.id,
      projectId: r.project_id,
      runId: r.run_id,
      number: r.number,
      revision: r.revision,
      status: r.status,
      currency: r.currency,
      content: parse(r.content_json),
      totals: parse(r.totals_json),
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  );
}
