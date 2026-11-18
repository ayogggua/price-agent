window.PriceUI = (() => {
  let csrf = '';
  let dirtyGuard = null;

  const setDirtyGuard = fn => { dirtyGuard = fn; };
  const canLeave = () => !dirtyGuard || !dirtyGuard() || window.confirm('当前页面有尚未保存的修改，离开将丢失修改，是否继续？');

  const qs = params => {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    });
    const s = sp.toString();
    return s ? '?' + s : '';
  };

  const cleanServerMessage = (raw, status) => {
    const msg = String(raw || '').trim();
    if (!msg) {
      const map = {
        401: '登录已过期，请重新登录',
        403: '当前账号无此操作权限，或会话校验已过期',
        404: '请求的记录不存在',
        409: '数据已被更新，请刷新后重试',
        413: '上传文件大小超出限制（单个文件不超过 20 MB）',
        429: '请求过于频繁，请稍后再试',
        502: '上游服务返回结果异常，请稍后重试',
        503: '服务或数据库暂未就绪，请检查服务配置',
        504: '服务响应超时，请稍后重试'
      };
      return map[status] || '请求未能完成，请稍后重试';
    }
    if (/Too small|Too big|Invalid enum|Expected number|Expected string|invalid_type/i.test(msg)) {
      return '部分必填信息或数值格式不正确，请核对表单标红项后重试';
    }
    return msg;
  };

  const api = async (url, body, method) => {
    const verb = method || (body !== undefined ? 'POST' : 'GET');
    const options = { method: verb, headers: {}, credentials: 'same-origin' };
    if (!['GET', 'HEAD'].includes(verb) && csrf) {
      options.headers['X-CSRF-Token'] = csrf;
    }
    if (body !== undefined) {
      if (body instanceof FormData) {
        options.body = body;
      } else {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    }
    const r = await fetch(window.appPath('/api' + url), options);
    const ct = r.headers.get('content-type') || '';
    let j = {};
    if (ct.includes('application/json')) {
      try { j = await r.json(); } catch { j = {}; }
    } else if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (t && t.length < 200 && !t.trim().startsWith('<')) j = { error: t.trim() };
    }
    if (j && j.csrf) csrf = j.csrf;
    if (!r.ok) {
      if (r.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/setup')) {
        window.dispatchEvent(new CustomEvent('price-auth-expired'));
      }
      throw new Error(cleanServerMessage(j?.error, r.status));
    }
    return j;
  };

  const downloadFile = async (url, fallbackName) => {
    const r = await fetch(window.appPath('/api' + url), { credentials: 'same-origin' });
    if (!r.ok) {
      if (r.status === 401) window.dispatchEvent(new CustomEvent('price-auth-expired'));
      const ct = r.headers.get('content-type') || '';
      let errText = '';
      if (ct.includes('application/json')) {
        const j = await r.json().catch(() => ({}));
        errText = j?.error || '';
      }
      throw new Error(cleanServerMessage(errText, r.status));
    }
    const cd = r.headers.get('content-disposition') || '';
    let filename = fallbackName;
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plainMatch = cd.match(/filename="?([^";]+)"?/i);
    if (utf8Match?.[1]) {
      try { filename = decodeURIComponent(utf8Match[1]); } catch {}
    } else if (plainMatch?.[1]) {
      filename = plainMatch[1];
    }
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  };

  const go = (view, id, opts = {}) => {
    if (!opts.force && !canLeave()) return false;
    if (opts.force) dirtyGuard = null;
    const nextHash = view + (id ? qs({ id }) : '');
    if (location.hash === '#' + nextHash) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      location.hash = nextHash;
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    return true;
  };

  const gcd = (a, b) => {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) { const t = x % y; x = y; y = t; }
    return x || 1n;
  };

  const normFrac = (n, d) => {
    if (d === 0n) return { n: 0n, d: 1n };
    const sign = d < 0n ? -1n : 1n;
    const nn = n * sign;
    const dd = d * sign;
    const g = gcd(nn, dd);
    return { n: nn / g, d: dd / g };
  };

  const toFrac = val => {
    if (val && typeof val === 'object' && typeof val.n === 'bigint') return val;
    const raw = String(val ?? '').trim();
    if (!raw) return { n: 0n, d: 1n };
    const num = Number(raw);
    if (!Number.isFinite(num)) return { n: 0n, d: 1n };
    const plain = /^[+-]?\d+(\.\d+)?$/.test(raw) ? raw : num.toFixed(8);
    const neg = plain.startsWith('-');
    const clean = plain.replace(/^[+-]/, '');
    const [intPart, decPart = ''] = clean.split('.');
    const d = 10n ** BigInt(decPart.length);
    const n = BigInt((intPart || '0') + decPart) * (neg ? -1n : 1n);
    return normFrac(n, d);
  };

  const addFrac = (a, b) => {
    const x = toFrac(a), y = toFrac(b);
    return normFrac(x.n * y.d + y.n * x.d, x.d * y.d);
  };
  const subFrac = (a, b) => {
    const x = toFrac(a), y = toFrac(b);
    return normFrac(x.n * y.d - y.n * x.d, x.d * y.d);
  };
  const mulFrac = (a, b) => {
    const x = toFrac(a), y = toFrac(b);
    return normFrac(x.n * y.n, x.d * y.d);
  };
  const divFrac = (a, b) => {
    const x = toFrac(a), y = toFrac(b);
    if (y.n === 0n) return { n: 0n, d: 1n };
    return normFrac(x.n * y.d, x.d * y.n);
  };

  const round2 = val => {
    const { n, d } = toFrac(val);
    const sign = n < 0n ? -1n : 1n;
    const absN = n < 0n ? -n : n;
    const cents = (absN * 200n + d) / (2n * d);
    return { frac: { n: sign * cents, d: 100n }, num: Number(sign * cents) / 100 };
  };

  const calcQuoteTotals = c => {
    const items = Array.isArray(c?.items) ? c.items : [];
    let subtotalF = { n: 0n, d: 1n };
    const lines = items.map(item => {
      const amt = round2(mulFrac(item.quantity, item.unitPrice));
      subtotalF = addFrac(subtotalF, amt.frac);
      return { ...item, amount: amt.num };
    });
    const subtotal = round2(subtotalF).num;
    const disc = round2(divFrac(mulFrac(subtotalF, c?.discountPercent || 0), 100n));
    const netF = subFrac(subtotalF, disc.frac);
    let taxF = { n: 0n, d: 1n };
    let totalF = netF;
    let exTaxF = netF;
    const rateF = toFrac(c?.taxRate || 0);
    if (c?.taxMode === '税费另计') {
      taxF = round2(divFrac(mulFrac(netF, rateF), 100n)).frac;
      totalF = addFrac(netF, taxF);
    } else if (c?.taxMode === '含税报价') {
      const divisor = addFrac(1, divFrac(rateF, 100n));
      exTaxF = divisor.n > 0n ? round2(divFrac(netF, divisor)).frac : netF;
      taxF = subFrac(netF, exTaxF);
    }
    return {
      subtotal,
      discount: disc.num,
      exTax: round2(exTaxF).num,
      tax: round2(taxF).num,
      total: round2(totalF).num,
      lines
    };
  };

  const calcEstimatePreview = draft => {
    let lowF = { n: 0n, d: 1n }, baseF = { n: 0n, d: 1n }, highF = { n: 0n, d: 1n };
    const costLines = (draft?.costLines || []).map(l => {
      const low = round2(mulFrac(l.quantityLow, l.unitCostCNY));
      const base = round2(mulFrac(l.quantityBase, l.unitCostCNY));
      const high = round2(mulFrac(l.quantityHigh, l.unitCostCNY));
      lowF = addFrac(lowF, low.frac);
      baseF = addFrac(baseF, base.frac);
      highF = addFrac(highF, high.frac);
      return { ...l, low: low.num, base: base.num, high: high.num };
    });
    let licF = { n: 0n, d: 1n };
    const licenseLines = (draft?.licenseLines || []).map(l => {
      const tot = round2(mulFrac(l.quantity, l.unitPriceCNY));
      licF = addFrac(licF, tot.frac);
      return { ...l, totalCNY: tot.num };
    });
    const risk = round2(draft?.riskReserve || 0);
    const marginNum = Number(draft?.margin);
    const validMargin = Number.isFinite(marginNum) && marginNum >= 0 && marginNum < 100 ? draft.margin : 0;
    const denom = subFrac(1, divFrac(validMargin, 100n));
    const service = denom.n > 0n ? round2(divFrac(addFrac(baseF, risk.frac), denom)) : round2(addFrac(baseF, risk.frac));
    const suggested = round2(addFrac(service.frac, licF));
    return {
      costLow: round2(lowF).num,
      costBase: round2(baseF).num,
      costHigh: round2(highF).num,
      riskReserve: risk.num,
      licenseTotal: round2(licF).num,
      serviceSuggested: service.num,
      suggestedCNY: suggested.num,
      costLines,
      licenseLines
    };
  };

  const money = (value, currency = 'CNY') => {
    const safeCur = ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD'].includes(currency) ? currency : 'CNY';
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: safeCur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  };

  const date = value => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const shortDate = value => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const statuses = {
    draft: '草稿',
    analyzing: '分析中',
    ready: '已分析',
    quoted: '已报价',
    review: '待审核',
    approved: '已批准',
    sent: '已发送',
    won: '已成交',
    lost: '未成交',
    queued: '排队中',
    running: '分析中',
    completed: '分析完成',
    failed: '分析失败',
    canceled: '已取消'
  };

  const evidenceNames = {
    deal: '已确认成交',
    award: '公开中标',
    listing: '公开标价',
    estimate: '内部估算'
  };

  const roleNames = {
    admin: '管理员',
    reviewer: '审核人',
    presales: '售前',
    sales: '销售',
    engineer: '研发'
  };

  const thinkingLevelLabels = {
    AUTO: '自动默认 (AUTO)',
    MINIMAL: '极简思考 (MINIMAL)',
    LOW: '低强度 (LOW)',
    MEDIUM: '中等强度 (MEDIUM)',
    HIGH: '高强度深度推理 (HIGH)',
    XHIGH: '超高强度推理 (XHIGH)',
    NONE: '关闭思考 (NONE)'
  };

  const inferThinkingLevels = modelId => {
    const id = String(modelId || '').trim().toLowerCase();
    if (!id) return ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'NONE'];
    if (id.includes('-image')) return ['NONE'];
    if (id.startsWith('gemini-4-')) return ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH'];
    if (/^gemini-(3\.8-|3\.7-|3\.1-pro)/.test(id)) return ['AUTO', 'LOW', 'MEDIUM', 'HIGH'];
    if (/^gemini-(3\.5-|3\.6-|3\.1-flash-lite)/.test(id)) return ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
    if (id.startsWith('gemini-2.5-')) return ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'NONE'];
    return ['AUTO', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'NONE'];
  };

  const getSupportedLevelsForModel = (modelId, models = []) => {
    const found = (models || []).find(m => m.id === modelId);
    if (Array.isArray(found?.supportedThinkingLevels) && found.supportedThinkingLevels.length) {
      return found.supportedThinkingLevels;
    }
    return inferThinkingLevels(modelId);
  };

  const coerceThinkingLevel = (modelId, level, models = []) => {
    const supported = getSupportedLevelsForModel(modelId, models);
    const upper = String(level || 'AUTO').toUpperCase();
    if (supported.includes(upper)) return upper;
    return supported.includes('AUTO') ? 'AUTO' : (supported[0] || 'AUTO');
  };

  const useAiModels = () => {
    const [state, setState] = React.useState({
      loaded: false,
      configured: true,
      models: [],
      defaults: { model: '', thinkingLevel: 'AUTO', enableSearch: true, enableUrlContext: true },
      error: ''
    });
    const [refreshing, setRefreshing] = React.useState(false);

    const load = React.useCallback(async (forceRefresh = false) => {
      if (forceRefresh) setRefreshing(true);
      try {
        const res = await api('/ai/models' + (forceRefresh ? qs({ refresh: 'true' }) : ''));
        const textModels = (res.models || []).filter(m => m && m.id && !m.isImageModel && !String(m.id).toLowerCase().includes('-image'));
        setState({
          loaded: true,
          configured: !!res.configured,
          models: textModels,
          defaults: {
            model: res.defaults?.model || textModels[0]?.id || '',
            thinkingLevel: String(res.defaults?.thinkingLevel || 'AUTO').toUpperCase(),
            enableSearch: res.defaults?.enableSearch ?? true,
            enableUrlContext: res.defaults?.enableUrlContext ?? true
          },
          error: res.error || ''
        });
        return res;
      } catch (e) {
        setState(old => ({ ...old, loaded: true, error: e.message }));
      } finally {
        if (forceRefresh) setRefreshing(false);
      }
    }, []);

    React.useEffect(() => { load(false); }, [load]);

    return { ...state, refreshing, refresh: () => load(true) };
  };

  const AiRunParamsBar = ({ value, onChange, modelsStore, disabled = false, compact = false, action = null }) => {
    const [customMode, setCustomMode] = React.useState(false);
    const models = modelsStore?.models || [];
    const currentModel = value?.model ?? '';
    const supportedLevels = getSupportedLevelsForModel(currentModel, models);
    const currentThinking = coerceThinkingLevel(currentModel, value?.thinkingLevel, models);

    const modelOptions = React.useMemo(() => {
      const ids = models.map(m => m.id);
      if (currentModel && !ids.includes(currentModel)) return [currentModel, ...ids];
      return ids;
    }, [models, currentModel]);

    const handleModelChange = nextModel => {
      const nextThinking = coerceThinkingLevel(nextModel, value?.thinkingLevel, models);
      onChange({ ...value, model: nextModel, thinkingLevel: nextThinking });
    };

    return (
      <div className={'ai-run-bar' + (compact ? ' compact-bar' : '')}>
        <div className="ai-run-field">
          <div className="ai-run-label-row">
            <label>推理模型</label>
            {models.length > 0 && (
              <button type="button" className="text-button tiny-link" disabled={disabled} onClick={() => setCustomMode(v => !v)}>
                {customMode ? '选择列表' : '自定义'}
              </button>
            )}
          </div>
          <div className="ai-model-control">
            {modelOptions.length > 0 && !customMode ? (
              <select
                aria-label="选择推理模型"
                disabled={disabled}
                value={currentModel}
                onChange={e => handleModelChange(e.target.value)}
              >
                {modelOptions.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            ) : (
              <input
                aria-label="填写推理模型名称"
                disabled={disabled}
                value={currentModel}
                placeholder="输入模型名称"
                onChange={e => handleModelChange(e.target.value)}
              />
            )}
            {modelsStore?.refresh && (
              <button
                type="button"
                className="icon-button small-icon"
                title="刷新可用模型列表"
                aria-label="刷新模型列表"
                disabled={disabled || modelsStore.refreshing}
                onClick={() => modelsStore.refresh()}
              >
                <QuoteIcon name="refresh" size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="ai-run-field">
          <label>思考强度</label>
          <select
            aria-label="选择思考强度"
            disabled={disabled || supportedLevels.length <= 1}
            value={currentThinking}
            onChange={e => onChange({ ...value, thinkingLevel: e.target.value })}
          >
            {supportedLevels.map(lv => (
              <option key={lv} value={lv}>{thinkingLevelLabels[lv] || lv}</option>
            ))}
          </select>
        </div>

        <div className="ai-run-toggles">
          <label className="inline-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={value?.enableSearch !== false}
              onChange={e => onChange({ ...value, enableSearch: e.target.checked })}
            />
            <span>实时联网检索</span>
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={value?.enableUrlContext !== false}
              onChange={e => onChange({ ...value, enableUrlContext: e.target.checked })}
            />
            <span>链接内容读取</span>
          </label>
        </div>

        {action && <div className="ai-run-action">{action}</div>}
      </div>
    );
  };

  const canWriteBusiness = user => user && user.role !== 'engineer';

  const formatSourceSummary = s => {
    const raw = String(s?.text || '').trim();
    if (!raw) return '暂无正文摘要';
    if (s?.access === 'internal' || (raw.startsWith('{') && raw.endsWith('}'))) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          const parts = [];
          if (obj.evidenceType) parts.push(evidenceNames[obj.evidenceType] || obj.evidenceType);
          if (obj.amount !== undefined && obj.amount !== null && obj.amount !== '') {
            parts.push('参考金额 ' + money(obj.amount, obj.currency || 'CNY'));
          }
          if (obj.date) parts.push('日期 ' + obj.date);
          if (obj.stage) parts.push('阶段 ' + obj.stage);
          if (obj.progress !== undefined && obj.progress !== null && obj.progress !== '') parts.push('完成度 ' + obj.progress + '%');
          const detail = [obj.scope, obj.completedWork || obj.completed_work, obj.notes].filter(Boolean).join('；');
          const head = parts.length ? parts.join(' · ') : '内部历史记录';
          const text = detail ? head + ' — ' + detail : head;
          return text.length > 280 ? text.slice(0, 280) + '…' : text;
        }
      } catch {}
    }
    return raw.length > 280 ? raw.slice(0, 280) + '…' : raw;
  };

  const Status = ({ value }) => <span className={'status-badge status-' + value}>{statuses[value] || value}</span>;
  const ErrorBox = ({ error }) => error ? <div className="app-error" role="alert"><QuoteIcon name="alert" size={16} /><span>{error}</span></div> : null;
  const NoticeBox = ({ children, action }) => <div className="app-notice"><div className="notice-body"><QuoteIcon name="info" size={16} /><div>{children}</div></div>{action && <div className="notice-action">{action}</div>}</div>;
  const SuccessBox = ({ message }) => message ? <div className="app-success" role="status"><QuoteIcon name="check" size={16} /><span>{message}</span></div> : null;

  const ReadOnlyBanner = ({ user, message }) => user?.role === 'engineer' ? (
    <div className="readonly-banner" role="note">
      <QuoteIcon name="shield" size={15} />
      <span>{message || '当前账号为研发只读视角：可查阅项目需求、测算明细与报价记录，并可维护“产品与成果库”。'}</span>
    </div>
  ) : null;

  const Empty = ({ icon = 'file', title, description, action }) => (
    <div className="empty-state">
      <span className="empty-icon"><QuoteIcon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );

  const Loading = ({ text = '正在读取数据…' }) => <div className="page-loading">{text}</div>;

  const Field = ({ label, children, wide, required, error, hint, labelAction }) => (
    <div className={'simple-field' + (wide ? ' full' : '') + (error ? ' has-error' : '')}>
      <div className="simple-field-head">
        <span>{label}{required && <b className="required" aria-label="必填">*</b>}</span>
        {labelAction}
      </div>
      {children}
      {hint && !error && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );

  const PasswordField = ({ label, value, onChange, placeholder, autoComplete, minLength, required, error, hint, wide, id }) => (
    <Field label={label} wide={wide} required={required} error={error} hint={hint}>
      <QuotePasswordInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
      />
    </Field>
  );

  const Confirm = ({ title, children, onClose, onConfirm, confirmText = '确认', danger = false, busy = false }) => (
    <QuoteOverlay
      compact
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className={'button ' + (danger ? 'danger' : 'primary')} disabled={busy} onClick={onConfirm}>
            {busy ? '处理中…' : confirmText}
          </button>
        </>
      }
    >
      {children}
    </QuoteOverlay>
  );

  const useLoad = url => {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const reload = React.useCallback(async () => {
      setLoading(true);
      try {
        const d = await api(url);
        setData(d);
        setError('');
        return d;
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, [url]);
    React.useEffect(() => {
      setData(null);
      reload();
    }, [reload]);
    return { data, error, loading, reload, setData, setError };
  };

  const PageTitle = ({ title, badge, description, children }) => (
    <div className="app-page-heading">
      <div className="heading-copy">
        <div className="heading-row">
          <h1>{title}</h1>
          {badge}
        </div>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );

  return {
    uid: window.QuoteData.uid,
    qs,
    api,
    downloadFile,
    go,
    setDirtyGuard,
    canLeave,
    calcQuoteTotals,
    calcEstimatePreview,
    money,
    date,
    shortDate,
    statuses,
    evidenceNames,
    roleNames,
    thinkingLevelLabels,
    inferThinkingLevels,
    getSupportedLevelsForModel,
    coerceThinkingLevel,
    useAiModels,
    AiRunParamsBar,
    canWriteBusiness,
    formatSourceSummary,
    Status,
    ErrorBox,
    NoticeBox,
    SuccessBox,
    ReadOnlyBanner,
    Empty,
    Loading,
    Field,
    PasswordField,
    Confirm,
    useLoad,
    PageTitle
  };
})();
