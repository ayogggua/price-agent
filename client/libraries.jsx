const {
  api, money, shortDate, statuses, evidenceNames, roleNames,
  thinkingLevelLabels, getSupportedLevelsForModel, coerceThinkingLevel, useAiModels,
  canWriteBusiness,
  ErrorBox, SuccessBox, ReadOnlyBanner, Loading, Empty, Field, PasswordField, Confirm, PageTitle
} = window.PriceUI;

const businessLabels = {
  license: '算法 License',
  software: '软件开发',
  model: '模型开发',
  solution: '算法方案',
  custom: '其他服务'
};

const auditEntityLabels = {
  user: '成员账号',
  project: '报价项目',
  analysis: '成本分析',
  quote: '报价单',
  reference: '价格参考',
  asset: '产品成果',
  settings: '系统配置'
};

const auditActionLabels = {
  login: '登录工作台',
  create: '创建记录',
  save: '保存更新',
  delete: '删除记录',
  upload: '上传附件',
  'delete-file': '移除附件',
  start: '发起分析',
  cancel: '取消分析',
  complete: '完成分析',
  adjust: '校准测算',
  edit: '编辑报价',
  status: '变更状态',
  export: '导出单据'
};

function formatAuditDetails(raw) {
  if (!raw) return '—';
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return '—'; }
  }
  if (!obj || typeof obj !== 'object') return '—';
  const parts = [];
  if (obj.from && obj.to) parts.push(`${statuses[obj.from] || obj.from} -> ${statuses[obj.to] || obj.to}`);
  if (obj.format) parts.push(`导出 ${String(obj.format).toUpperCase()}`);
  if (obj.files) parts.push(`${obj.files} 个文件`);
  if (obj.name) parts.push(String(obj.name));
  if (obj.role) parts.push(`角色：${roleNames[obj.role] || obj.role}`);
  if (obj.revision) parts.push(`版本 v${obj.revision}`);
  if (obj.model) parts.push(`模型 ${obj.model}`);
  if (obj.thinkingLevel) parts.push(`档位 ${obj.thinkingLevel}`);
  if (obj.after?.suggestedCNY !== undefined) parts.push(`建议价调整为 ${money(obj.after.suggestedCNY)}`);
  return parts.length ? parts.join(' · ') : '常规操作';
}

function LibraryPage({ kind, user }) {
  const isAssets = kind === 'assets';
  const url = isAssets ? '/assets/list' : '/references/list';
  const store = window.PriceUI.useLoad(url);
  const [search, setSearch] = React.useState('');
  const [cat, setCat] = React.useState('all');
  const [edit, setEdit] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState({});
  const [deleting, setDeleting] = React.useState(null);

  const canWrite = isAssets ? true : canWriteBusiness(user);
  const rows = store.data?.[isAssets ? 'assets' : 'references'] || [];

  const filtered = React.useMemo(() => {
    return rows.filter(r => {
      if (cat !== 'all') {
        if (isAssets && r.service_kind !== cat) return false;
        if (!isAssets && r.evidence_type !== cat) return false;
      }
      if (!search.trim()) return true;
      const kw = search.trim().toLowerCase();
      const text = isAssets
        ? `${r.name} ${r.version} ${r.stage} ${r.completed_work} ${r.remaining_work} ${r.notes}`
        : `${r.title} ${r.service_kind} ${r.scope_text} ${r.notes}`;
      return text.toLowerCase().includes(kw);
    });
  }, [rows, cat, search, isAssets]);

  const initial = isAssets
    ? { name: '', version: '', service_kind: 'software', stage: '产品开发中', progress: '', completed_work: '', remaining_work: '', notes: '' }
    : { title: '', service_kind: '软件开发', evidence_type: 'deal', amount: '', currency: 'CNY', source_url: '', scope_text: '', reference_date: '', notes: '' };

  const change = (k, v) => {
    setEdit(o => ({ ...o, [k]: v }));
    setFieldErrors(old => {
      if (!old[k]) return old;
      const next = { ...old };
      delete next[k];
      return next;
    });
  };

  const validateModal = () => {
    const errs = {};
    if (isAssets) {
      if (!String(edit.name || '').trim()) errs.name = '请填写产品或成果名称';
      if (!String(edit.stage || '').trim()) errs.stage = '请选择或填写当前产品状态';
      if (edit.progress !== '' && edit.progress !== null && edit.progress !== undefined) {
        const p = Number(edit.progress);
        if (!Number.isFinite(p) || p < 0 || p > 100) errs.progress = '完成进度应在 0 到 100 之间';
      }
    } else {
      if (!String(edit.title || '').trim()) errs.title = '请填写项目或价格参考名称';
      if (!String(edit.service_kind || '').trim()) errs.service_kind = '请填写所属业务类别';
      const amt = Number(edit.amount);
      if (!(Number.isFinite(amt) && amt > 0 && amt <= 1e12)) errs.amount = '请输入大于 0 的有效金额';
      if (!String(edit.scope_text || '').trim()) errs.scope_text = '请填写项目范围与可比条件';
      if (String(edit.source_url || '').trim() && !/^https?:\/\//i.test(String(edit.source_url).trim())) {
        errs.source_url = '公开来源链接需以 http:// 或 https:// 开头';
      }
    }
    return errs;
  };

  const save = async () => {
    const errs = validateModal();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('请修正标红的必填或格式错误项');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await api(isAssets ? '/assets/save' : '/references/save', edit);
      setEdit(null);
      await store.reload();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        title={isAssets ? '产品与成果库' : '价格参考库'}
        description={isAssets ? '管理可复用的 SDK、软件底座与模型资产，在需求评估与报价明细中直接带入。' : '沉淀内部签约成交、公开中标公告与外部供应商标价，建立报价对标基线。'}
      >
        {canWrite && (
          <button
            type="button"
            className="button primary"
            onClick={() => { setEdit(initial); setFormError(''); setFieldErrors({}); }}
          >
            <QuoteIcon name="plus" size={15} />{isAssets ? '添加产品成果' : '添加价格参考'}
          </button>
        )}
      </PageTitle>

      {!isAssets && (
        <ReadOnlyBanner user={user} message="当前账号为研发角色：价格参考库为只读查阅模式；你可前往“产品与成果库”维护技术成果。" />
      )}

      <ErrorBox error={store.error} />

      <div className="panel toolbar-panel">
        <div className="panel-toolbar wrap-toolbar no-border">
          <div className="filter-pills" role="tablist">
            <button type="button" className={'filter-pill' + (cat === 'all' ? ' active' : '')} onClick={() => setCat('all')}>全部 ({rows.length})</button>
            {isAssets
              ? Object.entries(businessLabels).map(([k, v]) => (
                  <button type="button" key={k} className={'filter-pill' + (cat === k ? ' active' : '')} onClick={() => setCat(k)}>{v}</button>
                ))
              : Object.entries(evidenceNames).map(([k, v]) => (
                  <button type="button" key={k} className={'filter-pill' + (cat === k ? ' active' : '')} onClick={() => setCat(k)}>{v}</button>
                ))}
          </div>
          <div className="search-wrap">
            <QuoteIcon name="search" size={15} />
            <input
              className="search-input"
              placeholder={isAssets ? '搜索产品名称、版本或成果内容…' : '搜索参考项目、类别或交付范围…'}
              aria-label="搜索记录"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="icon-button small-icon" aria-label="清空搜索" onClick={() => setSearch('')}>
                <QuoteIcon name="close" size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!store.data && store.loading ? (
        <Loading />
      ) : !filtered.length ? (
        <div className="panel">
          <Empty
            icon={isAssets ? 'layers' : 'coins'}
            title={rows.length ? '没有匹配筛选条件的记录' : (isAssets ? '暂无产品与成果记录' : '暂无历史价格参考记录')}
            description={
              rows.length
                ? '可清空搜索词或切换上方类别标签。'
                : (isAssets ? '将团队已有的标准产品、基础模块与研发进度录入此处，减少重复估算。' : '手动录入公开中标与标价，或在报价单标记成交后自动沉淀至此。')
            }
            action={
              rows.length ? (
                <button type="button" className="button" onClick={() => { setSearch(''); setCat('all'); }}>重置筛选</button>
              ) : canWrite ? (
                <button type="button" className="button primary" onClick={() => { setEdit(initial); setFormError(''); setFieldErrors({}); }}>
                  <QuoteIcon name="plus" size={15} />{isAssets ? '添加首条产品成果' : '添加首条价格参考'}
                </button>
              ) : null
            }
          />
        </div>
      ) : isAssets ? (
        <div className="asset-grid">
          {filtered.map(a => (
            <div className="panel asset-card" key={a.id}>
              <div className="asset-card-top">
                <span className="quiet-badge">{businessLabels[a.service_kind] || a.service_kind}</span>
                <div className="row-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => { setEdit({ ...a, progress: a.progress ?? '' }); setFormError(''); setFieldErrors({}); }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="icon-button small-icon danger"
                    aria-label={'删除产品成果 ' + a.name}
                    title="删除"
                    onClick={() => setDeleting(a)}
                  >
                    <QuoteIcon name="trash" size={14} />
                  </button>
                </div>
              </div>
              <h2>{a.name}</h2>
              <p>{a.version || '未标注版本'}</p>
              <div className="asset-stage">
                <span>{a.stage}</span>
                <strong>{a.progress === null || a.progress === '' ? '进度未填' : a.progress + '%'}</strong>
              </div>
              {a.progress !== null && a.progress !== '' && (
                <div className="progress-track"><div style={{ width: a.progress + '%' }} /></div>
              )}
              <h3>已完成 / 可直接复用</h3>
              <p className="asset-description">{a.completed_work || '待补充'}</p>
              <h3>已知待完善边界</h3>
              <p className="asset-description">{a.remaining_work || '待补充'}</p>
              {a.notes && (
                <>
                  <h3>适用场景与限制</h3>
                  <p className="asset-description">{a.notes}</p>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel">
          <div className="table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>参考项目 / 来源</th>
                  <th>证据类别</th>
                  <th className="num">参考金额</th>
                  <th>交付范围与可比条件</th>
                  {canWrite && <th className="num">操作</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <small>{r.service_kind}{r.reference_date ? ' · ' + r.reference_date : ''}</small>
                      {r.source_url && (
                        <a className="source-link" href={r.source_url} target="_blank" rel="noopener noreferrer">
                          查看公开来源<QuoteIcon name="external" size={12} />
                        </a>
                      )}
                    </td>
                    <td><span className="status-badge">{evidenceNames[r.evidence_type] || r.evidence_type}</span></td>
                    <td className="num"><strong>{money(r.amount, r.currency)}</strong></td>
                    <td>
                      <p className="table-prose">{r.scope_text}</p>
                      {r.notes && <small>{r.notes}</small>}
                    </td>
                    {canWrite && (
                      <td className="num">
                        <div className="row-actions">
                          <button type="button" className="text-button" onClick={() => { setEdit(r); setFormError(''); setFieldErrors({}); }}>
                            编辑
                          </button>
                          <button
                            type="button"
                            className="icon-button small-icon danger"
                            aria-label={'删除价格参考 ' + r.title}
                            title="删除"
                            onClick={() => setDeleting(r)}
                          >
                            <QuoteIcon name="trash" size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && (
        <QuoteOverlay
          title={isAssets ? (edit.id ? '编辑产品成果' : '添加产品成果') : (edit.id ? '编辑价格参考' : '添加价格参考')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button type="button" className="button" disabled={busy} onClick={() => setEdit(null)}>取消</button>
              <button type="button" className="button primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
            </>
          }
        >
          <ErrorBox error={formError} />
          <div className="simple-grid">
            {isAssets ? (
              <>
                <Field label="产品 / 成果名称" wide required error={fieldErrors.name}>
                  <input value={edit.name} onChange={e => change('name', e.target.value)} placeholder="例如：通用视频行为识别 SDK" />
                </Field>
                <Field label="版本号">
                  <input value={edit.version} onChange={e => change('version', e.target.value)} placeholder="例如：v2.0" />
                </Field>
                <Field label="所属业务类别" required>
                  <select value={edit.service_kind} onChange={e => change('service_kind', e.target.value)}>
                    {Object.entries(businessLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <QuoteField
                  id="asset-stage"
                  label="当前研发状态"
                  type="select"
                  required
                  error={fieldErrors.stage}
                  allowCustom
                  options={window.QuoteData.readinessFields('asset')[0].options}
                  value={edit.stage}
                  onChange={v => change('stage', v)}
                />
                <Field label="完成度百分比（%）" error={fieldErrors.progress}>
                  <input type="number" min="0" max="100" value={edit.progress} placeholder="未知可留空" onChange={e => change('progress', e.target.value)} />
                </Field>
                <Field label="已完成 / 可直接复用内容" wide>
                  <textarea rows={3} value={edit.completed_work} onChange={e => change('completed_work', e.target.value)} placeholder="说明已具备的核心功能、接口、模型指标与验证情况" />
                </Field>
                <Field label="已知待完善工作" wide>
                  <textarea rows={3} value={edit.remaining_work} onChange={e => change('remaining_work', e.target.value)} placeholder="说明商业化交付通常还需补充的适配或开发工作" />
                </Field>
                <Field label="适用场景与限制说明" wide>
                  <textarea rows={2} value={edit.notes || ''} onChange={e => change('notes', e.target.value)} placeholder="硬件环境要求、授权前置条件等" />
                </Field>
              </>
            ) : (
              <>
                <Field label="参考项目 / 标价名称" wide required error={fieldErrors.title}>
                  <input value={edit.title} onChange={e => change('title', e.target.value)} placeholder="例如：某制造企业视觉质检平台采购项目" />
                </Field>
                <Field label="业务类别" required error={fieldErrors.service_kind}>
                  <input value={edit.service_kind} onChange={e => change('service_kind', e.target.value)} placeholder="例如：软件开发、算法授权、综合项目" />
                </Field>
                <Field label="证据等级" required>
                  <select value={edit.evidence_type} onChange={e => change('evidence_type', e.target.value)}>
                    {Object.entries(evidenceNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="参考金额" required error={fieldErrors.amount}>
                  <input type="number" min="0.01" step="any" value={edit.amount} onChange={e => change('amount', e.target.value)} placeholder="填写数值" />
                </Field>
                <Field label="币种" required>
                  <select value={edit.currency} onChange={e => change('currency', e.target.value)}>
                    {['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD'].map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="成交 / 公布日期">
                  <input type="date" value={edit.reference_date || ''} onChange={e => change('reference_date', e.target.value)} />
                </Field>
                <Field label="公开来源链接" error={fieldErrors.source_url}>
                  <input type="url" value={edit.source_url || ''} placeholder="https://" onChange={e => change('source_url', e.target.value)} />
                </Field>
                <Field label="交付范围与可比条件" wide required error={fieldErrors.scope_text}>
                  <textarea rows={4} value={edit.scope_text} onChange={e => change('scope_text', e.target.value)} placeholder="记录点位数、功能模块、驻场周期、维保年限等关键计价维度" />
                </Field>
                <Field label="内部备注" wide>
                  <textarea rows={2} value={edit.notes || ''} onChange={e => change('notes', e.target.value)} placeholder="补充折扣背景或商务特殊说明" />
                </Field>
              </>
            )}
          </div>
        </QuoteOverlay>
      )}

      {deleting && (
        <Confirm
          danger
          confirmText="确认删除"
          title={isAssets ? '删除产品成果记录' : '删除历史价格参考'}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api(isAssets ? '/assets/delete' : '/references/delete', { id: deleting.id });
              setDeleting(null);
              await store.reload();
            } catch (e) {
              store.setError(e.message);
              setDeleting(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>确认删除记录 <strong>{isAssets ? deleting.name : deleting.title}</strong>？删除后无法恢复。</p>
        </Confirm>
      )}
    </>
  );
}

function AuditLogsPanel() {
  const store = window.PriceUI.useLoad('/audit/list');
  const [entityFilter, setEntityFilter] = React.useState('all');

  const logs = store.data?.logs || [];
  const filtered = logs.filter(l => {
    if (entityFilter === 'all') return true;
    if (entityFilter === 'system') return ['user', 'settings'].includes(l.entity_type);
    return l.entity_type === entityFilter;
  });

  return (
    <div className="panel">
      <div className="panel-toolbar wrap-toolbar">
        <div>
          <h2>操作审计记录</h2>
          <p className="muted" style={{ marginTop: 3 }}>展示近期关键业务与配置变更留痕（仅管理员与审核人可见）。</p>
        </div>
        <div className="filter-pills">
          {[
            ['all', '全部'],
            ['project', '报价项目'],
            ['quote', '报价单'],
            ['analysis', '成本分析'],
            ['system', '系统与成员']
          ].map(([k, label]) => (
            <button type="button" key={k} className={'filter-pill' + (entityFilter === k ? ' active' : '')} onClick={() => setEntityFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={store.error} />
      {store.loading ? (
        <Loading text="正在读取审计记录…" />
      ) : !filtered.length ? (
        <div className="inline-empty">暂无匹配的审计操作记录。</div>
      ) : (
        <div className="table-scroll audit-scroll">
          <table className="app-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>模块</th>
                <th>动作</th>
                <th>变更摘要</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id}>
                  <td>{shortDate(l.created_at || l.createdAt)}</td>
                  <td>{l.user_name || '系统'}</td>
                  <td><span className="quiet-badge">{auditEntityLabels[l.entity_type] || l.entity_type}</span></td>
                  <td><strong>{auditActionLabels[l.action] || l.action}</strong></td>
                  <td className="muted">{formatAuditDetails(l.details_json)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsPage({ user, onSessionSync }) {
  const store = window.PriceUI.useLoad('/settings/get');
  const modelsStore = useAiModels();
  const [config, setConfig] = React.useState(null);
  const [customModelMode, setCustomModelMode] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [member, setMember] = React.useState(null);
  const [memberError, setMemberError] = React.useState('');
  const [password, setPassword] = React.useState('');

  React.useEffect(() => {
    if (store.data) {
      const s = store.data.settings || {};
      const ai = store.data.ai || {};
      const initModel = s.aiModel || ai.model || '';
      setConfig({
        ...s,
        aiModel: initModel,
        thinkingLevel: String(s.thinkingLevel || ai.thinkingLevel || 'AUTO').toUpperCase(),
        enableSearch: s.enableSearch ?? ai.enableSearch ?? true,
        enableUrlContext: s.enableUrlContext ?? ai.enableUrlContext ?? true
      });
    }
  }, [store.data]);

  const change = (k, v) => setConfig(o => ({ ...o, [k]: v }));

  const act = async fn => {
    setBusy(true);
    setNotice('');
    store.setError('');
    try {
      await fn();
    } catch (e) {
      store.setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <><ErrorBox error={store.error} /><Loading /></>;

  const aiConfigured = !!(store.data.ai?.configured || modelsStore.configured);
  const effectiveModel = config.aiModel || modelsStore.defaults?.model || store.data.ai?.model || '';
  const supportedThinking = getSupportedLevelsForModel(effectiveModel, modelsStore.models);
  const effectiveThinking = coerceThinkingLevel(effectiveModel, config.thinkingLevel, modelsStore.models);
  const modelIdOptions = (() => {
    const ids = modelsStore.models.map(m => m.id);
    if (effectiveModel && !ids.includes(effectiveModel)) return [effectiveModel, ...ids];
    return ids;
  })();

  const isAdmin = user.role === 'admin';
  const canViewAudit = ['admin', 'reviewer'].includes(user.role);

  const handleAiModelSelect = nextModel => {
    const nextThinking = coerceThinkingLevel(nextModel, config.thinkingLevel, modelsStore.models);
    setConfig(old => ({ ...old, aiModel: nextModel, thinkingLevel: nextThinking }));
  };

  const saveSettings = () => act(async () => {
    const margin = Number(config.defaultMargin), risk = Number(config.defaultRiskPercent);
    if (!Number.isFinite(margin) || margin < 0 || margin > 99) throw new Error('默认目标毛利率应在 0% 到 99% 之间');
    if (!Number.isFinite(risk) || risk < 0 || risk > 100) throw new Error('默认风险预留比例应在 0% 到 100% 之间');
    if (!config.laborRates.length || config.laborRates.some(r => !String(r.role || '').trim() || !(Number(r.rate) >= 0))) {
      throw new Error('请完整填写每个内部角色的名称及非负人日成本');
    }
    const payload = {
      ...config,
      aiModel: String(effectiveModel || '').trim(),
      thinkingLevel: effectiveThinking,
      enableSearch: config.enableSearch !== false,
      enableUrlContext: config.enableUrlContext !== false
    };
    const res = await api('/settings/save', payload);
    onSessionSync?.({
      companyName: res.settings?.companyName ?? payload.companyName,
      model: payload.aiModel
    });
    setNotice('系统设置与默认推理参数已保存');
  });

  const saveMember = async () => {
    const uname = String(member.username || '').trim();
    const dname = String(member.name || '').trim();
    const pw = String(member.password || '');
    if (!member.id && !/^[a-zA-Z0-9_.@-]{3,80}$/.test(uname)) {
      setMemberError('登录账号需使用 3–80 位字母、数字或 . _ @ -');
      return;
    }
    if (!dname) {
      setMemberError('请填写成员姓名');
      return;
    }
    if ((!member.id && pw.length < 10) || (member.id && pw.length > 0 && pw.length < 10)) {
      setMemberError('登录密码长度至少需要 10 位');
      return;
    }
    setBusy(true);
    setMemberError('');
    try {
      await api('/users/save', { ...member, username: uname, name: dname });
      setMember(null);
      await store.reload();
      setNotice('成员权限已更新');
    } catch (e) {
      setMemberError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="系统设置" description="管理报价方主体信息、内部核算口径、成员角色权限与操作审计。" />

      {!isAdmin && (
        <div className="readonly-banner" role="note">
          <QuoteIcon name="shield" size={15} />
          <span>报价主体与内部成本参数由管理员统一维护；你可在下方修改个人登录密码{canViewAudit ? '及查阅操作审计记录' : ''}。</span>
        </div>
      )}

      <ErrorBox error={store.error} />
      <SuccessBox message={notice} />

      <div className="panel content-panel">
        <div className="panel-toolbar inline wrap-toolbar">
          <div className="heading-row">
            <h2>模型推理与联网服务</h2>
            <span className={'status-badge ' + (aiConfigured ? 'status-ready' : 'status-warn')}>
              {aiConfigured ? '已配置' : '待配置'}
            </span>
            {modelsStore.models.length > 0 && (
              <span className="muted">可用文本推理模型 {modelsStore.models.length} 个</span>
            )}
          </div>
          <div className="inline-actions">
            <button
              type="button"
              className="button small"
              disabled={busy || modelsStore.refreshing}
              onClick={async () => {
                const res = await modelsStore.refresh();
                if (res?.models?.length) setNotice(`已刷新模型列表（共 ${res.models.filter(m => !m.isImageModel).length} 个可用模型）`);
              }}
            >
              <QuoteIcon name="refresh" size={14} />{modelsStore.refreshing ? '刷新中…' : '刷新模型列表'}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="button small primary"
                disabled={busy}
                onClick={() => act(async () => {
                  const t0 = Date.now();
                  const r = await api('/settings/ai-check', {
                    model: effectiveModel,
                    thinkingLevel: effectiveThinking,
                    enableSearch: config.enableSearch !== false,
                    enableUrlContext: config.enableUrlContext !== false
                  });
                  const elapsed = r?.latencyMs ?? (Date.now() - t0);
                  const lvText = thinkingLevelLabels[r?.thinkingLevel || effectiveThinking] || effectiveThinking;
                  setNotice(`服务连接正常 · 模型 ${r?.model || effectiveModel} · 档位 ${lvText} · 耗时 ${elapsed} ms`);
                })}
              >
                测试服务连接
              </button>
            )}
          </div>
        </div>

        <p className="muted" style={{ marginBottom: 18 }}>
          {aiConfigured
            ? '设置全局默认的推理模型、思考深度与实时联网能力；在单个项目发起分析时也可按需临时切换。'
            : '当前未检测到有效模型服务连接参数，未连接期间仍可正常创建、审核并导出报价单。'}
        </p>

        <fieldset className="quote-edit-fields" disabled={!isAdmin || busy}>
          <div className="simple-grid">
            <Field
              label="默认推理模型"
              hint="切换模型后，思考强度将自动匹配该模型支持的档位"
              labelAction={
                isAdmin && modelIdOptions.length > 0 ? (
                  <button type="button" className="text-button small-link" onClick={() => setCustomModelMode(v => !v)}>
                    {customModelMode ? '从列表选择' : '手动填写模型名'}
                  </button>
                ) : null
              }
            >
              {modelIdOptions.length > 0 && !customModelMode ? (
                <select value={effectiveModel} onChange={e => handleAiModelSelect(e.target.value)}>
                  {modelIdOptions.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              ) : (
                <input
                  value={effectiveModel}
                  placeholder="填写模型名称，例如 gemini-3.8-flash"
                  onChange={e => handleAiModelSelect(e.target.value)}
                />
              )}
            </Field>

            <Field label="默认思考强度" hint="复杂多模块与招标书拆解建议选择中等或高强度推理">
              <select
                value={effectiveThinking}
                disabled={!isAdmin || busy || supportedThinking.length <= 1}
                onChange={e => change('thinkingLevel', e.target.value)}
              >
                {supportedThinking.map(lv => (
                  <option key={lv} value={lv}>{thinkingLevelLabels[lv] || lv}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="ai-settings-switches">
            <label className="setting-check-card">
              <input
                type="checkbox"
                checked={config.enableSearch !== false}
                onChange={e => change('enableSearch', e.target.checked)}
              />
              <div>
                <strong>启用实时联网检索 (Google Search)</strong>
                <p>在需求分析时自动联网检索同类项目公开成交价、云算力标价与客户公开业务背景。</p>
              </div>
            </label>

            <label className="setting-check-card">
              <input
                type="checkbox"
                checked={config.enableUrlContext !== false}
                onChange={e => change('enableUrlContext', e.target.checked)}
              />
              <div>
                <strong>启用链接内容读取 (URL Context)</strong>
                <p>自动抓取并解析项目需求中填写的客户官网、招标公告及指定参考网页正文。</p>
              </div>
            </label>
          </div>
        </fieldset>
      </div>

      <fieldset className="quote-edit-fields" disabled={!isAdmin || busy}>
        <div className="panel content-panel">
          <h2>默认报价方主体信息</h2>
          <p className="muted" style={{ marginBottom: 16 }}>新建对外报价单时自动带入以下公司抬头、联系方式与页脚地址。</p>
          <div className="simple-grid">
            {[
              ['companyName', '公司全称', '例如：某某科技有限公司'],
              ['companyContact', '商务联系方式', '例如：商务部 / contact@example.com'],
              ['companyAddress', '公司办公地址', '展示于正式报价单底部']
            ].map(([k, label, ph]) => (
              <Field key={k} label={label} wide={k === 'companyAddress'}>
                <input value={config[k]} placeholder={ph} onChange={e => change(k, e.target.value)} />
              </Field>
            ))}
          </div>
        </div>

        <div className="panel content-panel">
          <h2>内部成本基准与默认定价</h2>
          <div className="simple-grid">
            <Field label="默认目标毛利率（%）">
              <input type="number" min="0" max="99" value={config.defaultMargin} onChange={e => change('defaultMargin', e.target.value)} />
            </Field>
            <Field label="默认风险预留比例（%）">
              <input type="number" min="0" max="100" value={config.defaultRiskPercent} onChange={e => change('defaultRiskPercent', e.target.value)} />
            </Field>
          </div>

          <h3 style={{ marginTop: 22 }}>内部岗位人日成本基准（CNY / 人日）</h3>
          <div className="rate-list">
            {config.laborRates.map((r, i) => (
              <div className="rate-row" key={i}>
                <input
                  aria-label={'角色名称 ' + (i + 1)}
                  placeholder="岗位名称"
                  value={r.role}
                  onChange={e => change('laborRates', config.laborRates.map((x, j) => i === j ? { ...x, role: e.target.value } : x))}
                />
                <input
                  aria-label={'人日成本 ' + (i + 1)}
                  type="number"
                  min="0"
                  className="num-input"
                  value={r.rate}
                  onChange={e => change('laborRates', config.laborRates.map((x, j) => i === j ? { ...x, rate: e.target.value } : x))}
                />
                <span>CNY / 人日</span>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={'删除角色 ' + (i + 1)}
                  disabled={config.laborRates.length === 1}
                  onClick={() => change('laborRates', config.laborRates.filter((_, j) => j !== i))}
                >
                  <QuoteIcon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
          {isAdmin && (
            <button type="button" className="text-button" onClick={() => change('laborRates', [...config.laborRates, { role: '', rate: 1500 }])} style={{ marginBottom: 18 }}>
              <QuoteIcon name="plus" size={14} />添加岗位成本标准
            </button>
          )}
          <Field label="内部成本口径说明" wide>
            <input value={config.rateNote} onChange={e => change('rateNote', e.target.value)} placeholder="说明人日成本包含范围（如含社保公积金与管理分摊）" />
          </Field>
        </div>

        {isAdmin && (
          <div className="settings-save">
            <button type="button" className="button primary" disabled={busy} onClick={saveSettings}>
              <QuoteIcon name="save" size={15} />保存系统设置
            </button>
          </div>
        )}
      </fieldset>

      {isAdmin && Array.isArray(store.data.users) && (
        <div className="panel">
          <div className="panel-toolbar">
            <div>
              <h2>团队成员与角色权限</h2>
              <p className="muted" style={{ marginTop: 3 }}>管理员与审核人可批准报价；售前与销售可编辑报价；研发角色维护产品库并只读查阅项目。</p>
            </div>
            <button
              type="button"
              className="button"
              onClick={() => { setMember({ username: '', name: '', password: '', role: 'sales', status: 'active' }); setMemberError(''); }}
            >
              <QuoteIcon name="plus" size={15} />添加成员
            </button>
          </div>
          <div className="table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>登录账号</th>
                  <th>角色权限</th>
                  <th>账号状态</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {store.data.users.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.username}</td>
                    <td>{roleNames[u.role] || u.role}</td>
                    <td>
                      <span className={'status-badge ' + (u.status === 'active' ? 'status-ready' : 'status-failed')}>
                        {u.status === 'active' ? '启用' : '已停用'}
                      </span>
                    </td>
                    <td className="num">
                      <button type="button" className="text-button" onClick={() => { setMember({ ...u, password: '' }); setMemberError(''); }}>
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel content-panel">
        <h2>修改个人登录密码</h2>
        <div className="password-row">
          <QuotePasswordInput
            autoComplete="new-password"
            placeholder="输入新密码（至少 10 位）"
            ariaLabel="新密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={busy || password.length < 10}
            onClick={() => act(async () => {
              await api('/auth/password', { password });
              setPassword('');
              setNotice('个人登录密码已更新');
            })}
          >
            更新密码
          </button>
        </div>
      </div>

      {canViewAudit && <AuditLogsPanel />}

      {member && (
        <QuoteOverlay
          compact
          title={member.id ? '编辑团队成员' : '添加团队成员'}
          onClose={() => setMember(null)}
          footer={
            <>
              <button type="button" className="button" disabled={busy} onClick={() => setMember(null)}>取消</button>
              <button type="button" className="button primary" disabled={busy} onClick={saveMember}>
                {busy ? '保存中…' : '保存成员'}
              </button>
            </>
          }
        >
          <ErrorBox error={memberError} />
          <div className="simple-grid">
            <Field label="登录账号" wide required={!member.id}>
              <input
                disabled={!!member.id}
                value={member.username}
                placeholder="3–80 位字母、数字或 . _ @ -"
                onChange={e => setMember({ ...member, username: e.target.value })}
              />
            </Field>
            <Field label="成员姓名" wide required>
              <input value={member.name} placeholder="真实姓名或称呼" onChange={e => setMember({ ...member, name: e.target.value })} />
            </Field>
            <PasswordField
              label={member.id ? '重置登录密码（不修改请留空）' : '初始登录密码'}
              wide
              required={!member.id}
              value={member.password}
              placeholder="至少 10 位字符"
              autoComplete="new-password"
              onChange={e => setMember({ ...member, password: e.target.value })}
            />
            <Field label="系统角色">
              <select value={member.role} onChange={e => setMember({ ...member, role: e.target.value })}>
                {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="账号状态">
              <select value={member.status} onChange={e => setMember({ ...member, status: e.target.value })}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </Field>
          </div>
        </QuoteOverlay>
      )}
    </>
  );
}

Object.assign(window, { LibraryPage, SettingsPage });
