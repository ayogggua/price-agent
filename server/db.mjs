import mysql from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {cfg,parse} from './config.mjs';
export const pool=mysql.createPool(cfg.db);
export const id=()=>randomUUID();
export async function query(sql,args=[],conn=pool){const [rows]=await conn.execute(sql,args);return rows;}
export async function tx(fn){const conn=await pool.getConnection();try{await conn.beginTransaction();const r=await fn(conn);await conn.commit();return r;}catch(e){await conn.rollback();throw e;}finally{conn.release();}}
const schemas=[
`CREATE TABLE IF NOT EXISTS users (
 id VARCHAR(36) PRIMARY KEY COMMENT '用户标识', username VARCHAR(80) NOT NULL UNIQUE COMMENT '登录账号', display_name VARCHAR(100) NOT NULL COMMENT '姓名', password_hash VARCHAR(255) NOT NULL COMMENT '加盐密码摘要', role VARCHAR(30) NOT NULL COMMENT 'admin 管理员; reviewer 审核人; presales 售前; sales 销售; engineer 研发', status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active 启用; disabled 停用', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间'
) COMMENT='内部用户'`,
`CREATE TABLE IF NOT EXISTS sessions (
 id VARCHAR(64) PRIMARY KEY COMMENT '会话令牌摘要', user_id VARCHAR(36) NOT NULL COMMENT '用户标识', csrf_token VARCHAR(64) NOT NULL COMMENT '请求校验令牌', expires_at DATETIME(3) NOT NULL COMMENT '过期时间', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间', INDEX idx_session_user(user_id), INDEX idx_session_expiry(expires_at)
) COMMENT='登录会话'`,
`CREATE TABLE IF NOT EXISTS projects (
 id VARCHAR(36) PRIMARY KEY COMMENT '项目标识', number VARCHAR(40) NOT NULL UNIQUE COMMENT '项目编号', input_json LONGTEXT NOT NULL COMMENT '需求输入快照', status VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT 'draft 需求草稿; analyzing 分析中; ready 已分析; quoted 已报价; won 已成交; lost 未成交', revision INT NOT NULL DEFAULT 1 COMMENT '需求版本，用于并发校验', current_run_id VARCHAR(36) NULL COMMENT '最近分析标识', owner_id VARCHAR(36) NOT NULL COMMENT '项目负责人', created_by VARCHAR(36) NOT NULL COMMENT '创建人', updated_by VARCHAR(36) NOT NULL COMMENT '更新人', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间', updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间', INDEX idx_project_updated(updated_at), INDEX idx_project_owner(owner_id)
) COMMENT='报价项目'`,
`CREATE TABLE IF NOT EXISTS attachments (
 id VARCHAR(36) PRIMARY KEY COMMENT '附件标识', project_id VARCHAR(36) NOT NULL COMMENT '所属项目', display_name VARCHAR(255) NOT NULL COMMENT '原始文件名', stored_name VARCHAR(80) NOT NULL COMMENT '服务端存储名', mime VARCHAR(100) NOT NULL COMMENT '文件类型', size_bytes BIGINT NOT NULL COMMENT '文件大小', text_content LONGTEXT NULL COMMENT '提取的文本', parse_status VARCHAR(30) NOT NULL COMMENT 'ready 已解析; image 图片; unsupported 暂不支持提取; failed 提取失败', created_by VARCHAR(36) NOT NULL COMMENT '上传人', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '上传时间', INDEX idx_attachment_project(project_id)
) COMMENT='需求附件'`,
`CREATE TABLE IF NOT EXISTS analysis_runs (
 id VARCHAR(36) PRIMARY KEY COMMENT '分析标识', project_id VARCHAR(36) NOT NULL COMMENT '所属项目', project_revision INT NOT NULL COMMENT '分析时需求版本', status VARCHAR(30) NOT NULL COMMENT 'queued 排队; running 执行中; completed 完成; failed 失败; canceled 已取消', stage VARCHAR(150) NOT NULL COMMENT '当前阶段', progress INT NOT NULL DEFAULT 0 COMMENT '完成百分比', input_json LONGTEXT NOT NULL COMMENT '不可变需求快照', result_json LONGTEXT NULL COMMENT '结构化分析结果', research_json LONGTEXT NULL COMMENT '联网结果与来源', error_message TEXT NULL COMMENT '失败原因', usage_json TEXT NULL COMMENT '模型用量', created_by VARCHAR(36) NOT NULL COMMENT '发起人', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '开始时间', completed_at DATETIME(3) NULL COMMENT '结束时间', INDEX idx_run_project(project_id,created_at)
) COMMENT='AI 分析任务'`,
`CREATE TABLE IF NOT EXISTS quotes (
 id VARCHAR(36) PRIMARY KEY COMMENT '报价标识', project_id VARCHAR(36) NOT NULL COMMENT '所属项目', run_id VARCHAR(36) NULL COMMENT '依据分析任务', number VARCHAR(40) NOT NULL UNIQUE COMMENT '报价编号', revision INT NOT NULL DEFAULT 1 COMMENT '编辑版本', status VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT 'draft 草稿; review 待审核; approved 已批准; sent 已发送; won 已成交; lost 未成交', currency VARCHAR(8) NOT NULL COMMENT 'ISO 币种字符串', content_json LONGTEXT NOT NULL COMMENT '对外报价内容', totals_json TEXT NOT NULL COMMENT '服务端计算金额', approved_by VARCHAR(36) NULL COMMENT '批准人', approved_at DATETIME(3) NULL COMMENT '批准时间', created_by VARCHAR(36) NOT NULL COMMENT '创建人', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间', updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间', INDEX idx_quote_project(project_id)
) COMMENT='对外报价'`,
`CREATE TABLE IF NOT EXISTS quote_versions (
 id VARCHAR(36) PRIMARY KEY COMMENT '快照标识', quote_id VARCHAR(36) NOT NULL COMMENT '报价标识', revision INT NOT NULL COMMENT '报价版本', status VARCHAR(30) NOT NULL COMMENT '保存时状态', content_json LONGTEXT NOT NULL COMMENT '对外内容快照', totals_json TEXT NOT NULL COMMENT '金额快照', created_by VARCHAR(36) NOT NULL COMMENT '操作人', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '时间', UNIQUE KEY uk_quote_revision(quote_id,revision)
) COMMENT='报价历史版本'`,
`CREATE TABLE IF NOT EXISTS price_references (
 id VARCHAR(36) PRIMARY KEY COMMENT '参考标识', title VARCHAR(255) NOT NULL COMMENT '项目或价格名称', service_kind VARCHAR(100) NOT NULL COMMENT '业务类别', evidence_type VARCHAR(30) NOT NULL COMMENT 'deal 已确认成交; award 公开中标; listing 公开标价; estimate 估算', amount DECIMAL(18,2) NOT NULL COMMENT '参考金额', currency VARCHAR(8) NOT NULL COMMENT '原始币种', source_url TEXT NULL COMMENT '公开来源', scope_text TEXT NOT NULL COMMENT '范围与可比条件', reference_date VARCHAR(30) NULL COMMENT '成交或公布日期', notes TEXT NULL COMMENT '内部说明', created_by VARCHAR(36) NOT NULL COMMENT '录入人', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '录入时间'
) COMMENT='历史成交与市场参考库'`,
`CREATE TABLE IF NOT EXISTS product_assets (
 id VARCHAR(36) PRIMARY KEY COMMENT '产品资产标识', name VARCHAR(200) NOT NULL COMMENT '产品名称', version VARCHAR(100) NOT NULL COMMENT '版本', service_kind VARCHAR(60) NOT NULL COMMENT 'license 授权; software 软件; model 模型; solution 方案; custom 自定义', stage VARCHAR(150) NOT NULL COMMENT '当前产品状态', progress DECIMAL(5,2) NULL COMMENT '产品完成百分比，未知为空', completed_work TEXT NOT NULL COMMENT '已完成与可复用内容', remaining_work TEXT NOT NULL COMMENT '已知待完善工作', notes TEXT NULL COMMENT '适用场景与限制', created_by VARCHAR(36) NOT NULL COMMENT '录入人', updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间'
) COMMENT='已有产品与成果库'`,
`CREATE TABLE IF NOT EXISTS app_settings (
 setting_key VARCHAR(80) PRIMARY KEY COMMENT '配置键', value_json LONGTEXT NOT NULL COMMENT '非敏感配置内容', updated_by VARCHAR(36) NULL COMMENT '修改人', updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '更新时间'
) COMMENT='系统配置'`,
`CREATE TABLE IF NOT EXISTS audit_logs (
 id VARCHAR(36) PRIMARY KEY COMMENT '记录标识', user_id VARCHAR(36) NULL COMMENT '操作人', entity_type VARCHAR(40) NOT NULL COMMENT '对象类型', entity_id VARCHAR(36) NULL COMMENT '对象标识', action VARCHAR(80) NOT NULL COMMENT '操作名称', details_json TEXT NULL COMMENT '操作摘要，不含密钥', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '时间', INDEX idx_audit_entity(entity_type,entity_id)
) COMMENT='操作审计'`
];
export async function initDb(){for(const sql of schemas)await query(sql);await query('INSERT IGNORE INTO app_settings(setting_key,value_json) VALUES(?,?)',['pricing',JSON.stringify({companyName:'',companyAddress:'',companyContact:'',defaultMargin:35,defaultRiskPercent:15,laborRates:[{role:'算法工程师',rate:2000},{role:'软件工程师',rate:1800},{role:'测试工程师',rate:1200},{role:'项目经理',rate:1600}],rateNote:'初始内部假设，请按公司实际成本校准'})]);await query("UPDATE analysis_runs SET status='failed',stage='执行中断，可重新分析',error_message='服务重启，请重新发起分析',completed_at=UTC_TIMESTAMP(3) WHERE status IN ('running','queued')");await query("UPDATE projects SET status='draft' WHERE status='analyzing'");}
export async function settings(){return parse((await query('SELECT value_json FROM app_settings WHERE setting_key=?',['pricing']))[0]?.value_json);}
export async function audit(user,entity,type,action,details={},conn=pool){await query('INSERT INTO audit_logs(id,user_id,entity_type,entity_id,action,details_json) VALUES(?,?,?,?,?,?)',[id(),user?.id||null,entity,type||null,action,JSON.stringify(details)],conn);}
export function projectRow(r){return r&&{id:r.id,number:r.number,input:parse(r.input_json),status:r.status,revision:r.revision,currentRunId:r.current_run_id,ownerId:r.owner_id,createdAt:r.created_at,updatedAt:r.updated_at};}
export function runRow(r){return r&&{id:r.id,projectId:r.project_id,projectRevision:r.project_revision,status:r.status,stage:r.stage,progress:r.progress,result:parse(r.result_json,null),research:parse(r.research_json,null),error:r.error_message,usage:parse(r.usage_json,null),createdAt:r.created_at,completedAt:r.completed_at};}
export function quoteRow(r){return r&&{id:r.id,projectId:r.project_id,runId:r.run_id,number:r.number,revision:r.revision,status:r.status,currency:r.currency,content:parse(r.content_json),totals:parse(r.totals_json),approvedBy:r.approved_by,approvedAt:r.approved_at,createdAt:r.created_at,updatedAt:r.updated_at};}
