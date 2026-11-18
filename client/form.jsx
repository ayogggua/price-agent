const { useState, useEffect, useRef } = React;
const { uid, taxModes, sections, schemas, readinessFields, fresh, example } = window.QuoteData;
const Brand = window.QuoteBrandMark;
const I = window.QuoteIcon;
const F = window.QuoteField;
const S = window.QuoteSection;
const Switch = window.QuoteSwitch;
const Overlay = window.QuoteOverlay;

const STORAGE_KEY = 'price-agent.quote-input.v1';
const fmtNum = n => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyLabels = {
  CNY: '人民币 CNY',
  USD: '美元 USD',
  EUR: '欧元 EUR',
  GBP: '英镑 GBP',
  HKD: '港币 HKD',
  JPY: '日元 JPY',
  SGD: '新加坡元 SGD'
};

const loadStandaloneDraft = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw?.version === 1 && raw.data && Array.isArray(raw.data.types)) {
      return { data: window.QuoteData.normalizeDraft(raw.data), savedAt: raw.savedAt };
    }
  } catch {}
  return { data: fresh(), savedAt: null };
};

const hasReadinessContent = (d, typeId) => readinessFields(typeId).some(f => {
  const val = String(d[f.id] ?? '').trim();
  return val && val !== '待确认';
});

function QuoteApp({
  project = null,
  defaults = null,
  embedded = false,
  aiConfigured = true,
  aiModelsStore = null,
  readOnly = false,
  onBack,
  onSave,
  onAnalyze,
  onDirectQuote,
  attachments = [],
  onRemoveAttachment,
  assets = []
}) {
  const [aiRunOpts, setAiRunOpts] = useState(null);
  useEffect(() => {
    if (aiModelsStore?.loaded && !aiRunOpts) {
      setAiRunOpts({
        model: aiModelsStore.defaults.model || '',
        thinkingLevel: aiModelsStore.defaults.thinkingLevel || 'AUTO',
        enableSearch: aiModelsStore.defaults.enableSearch ?? true,
        enableUrlContext: aiModelsStore.defaults.enableUrlContext ?? true
      });
    }
  }, [aiModelsStore?.loaded, aiModelsStore?.defaults, aiRunOpts]);
  const activeAiOpts = aiRunOpts || aiModelsStore?.defaults || { model: '', thinkingLevel: 'AUTO', enableSearch: true, enableUrlContext: true };
  const [initial] = useState(() => {
    if (project) return { data: window.QuoteData.normalizeDraft(project.input), savedAt: project.updatedAt };
    if (onSave) return { data: fresh(defaults), savedAt: null };
    return loadStandaloneDraft();
  });

  const [pending, setPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState('');
  const [d, setD] = useState(initial.data);
  const [savedAt, setSavedAt] = useState(initial.savedAt);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState('project');
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [pendingBudgetCurrency, setPendingBudgetCurrency] = useState(null);
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [openReadiness, setOpenReadiness] = useState(() => {
    const map = {};
    (initial.data.types || []).forEach(t => {
      if (hasReadinessContent(initial.data, t)) map[t] = true;
    });
    return map;
  });
  const fileRef = useRef(null);

  const hasUnsaved = dirty || files.length > 0;

  useEffect(() => {
    if (window.PriceUI?.setDirtyGuard) {
      window.PriceUI.setDirtyGuard(() => hasUnsaved);
      return () => window.PriceUI.setDirtyGuard(null);
    }
  }, [hasUnsaved]);

  useEffect(() => {
    const handler = e => {
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  const change = (key, value) => {
    setD(old => ({ ...old, [key]: value }));
    setDirty(true);
    setErrors(old => {
      if (!old[key]) return old;
      const next = { ...old };
      delete next[key];
      return next;
    });
  };

  const notify = (message, type = 'ok') => setToast({ message, type, key: Date.now() });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const handler = () => {
      let current = 'project';
      sections.forEach(s => {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 160) current = s.id;
      });
      setActive(current);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const allTypes = window.QuoteData.allTypes(d);
  const critical = window.QuoteData.requirements(d);
  const requiredKeys = new Set(critical.map(r => r.key));
  const businessRequired = critical.slice(6);
  const checklist = [
    ...critical.slice(0, 6),
    ...(businessRequired.length ? [{
      key: 'business-details',
      label: `业务必填信息（${businessRequired.filter(r => r.done).length}/${businessRequired.length}）`,
      done: businessRequired.every(r => r.done)
    }] : [])
  ];
  const done = critical.filter(x => x.done).length;

  const boundKnown = key => !d[key + 'Unknown'] && d[key] !== '';
  const boundText = key => boundKnown(key) ? fmtNum(d[key]) + ' ' + d.budgetCurrency : '未知';
  const knownLabor = d.roles.reduce((sum, row) => (
    sum + (Number(row.days) > 0 && Number(row.rate) >= 0 && row.rate !== '' ? Number(row.days) * Number(row.rate) : 0)
  ), 0);
  const researchCount = [d.researchCompany, d.researchCost, d.researchMarket, d.researchFX && d.currency !== 'CNY'].filter(Boolean).length;

  const validate = () => {
    const e = {};
    critical.filter(r => !r.done).forEach(r => {
      e[r.key] = r.key === 'types' ? '请至少选择一类报价业务' : '请填写' + r.label;
    });
    const nonnegative = ['otherCost', 'riskReserve', 'supportPeriod', ...(d.budgetStatus === '已有预算' ? ['budgetMin', 'budgetMax'].filter(boundKnown) : [])];
    nonnegative.forEach(k => {
      if (d[k] !== '' && (!Number.isFinite(Number(d[k])) || Number(d[k]) < 0)) e[k] = '请输入大于或等于 0 的数字';
    });
    if (d.budgetStatus === '已有预算' && boundKnown('budgetMin') && boundKnown('budgetMax') && Number(d.budgetMin) > Number(d.budgetMax)) {
      e.budgetMax = '预算上限应大于或等于下限';
    }
    if (d.margin !== '' && (!Number.isFinite(Number(d.margin)) || Number(d.margin) < 0 || Number(d.margin) >= 100)) {
      e.margin = '目标毛利率应在 0% 到 100% 之间（不含 100%）';
    }
    if (['含税报价', '税费另计'].includes(d.taxMode) && d.taxRate !== '' && (!Number.isFinite(Number(d.taxRate)) || Number(d.taxRate) < 0 || Number(d.taxRate) > 100)) {
      e.taxRate = '税率应在 0% 到 100% 之间';
    }
    if (d.validity !== '' && (!Number.isInteger(Number(d.validity)) || Number(d.validity) <= 0)) {
      e.validity = '有效期应为大于 0 的整数天数';
    }
    if (d.startDate && d.deliveryDate && d.deliveryDate < d.startDate) {
      e.deliveryDate = '交付日期不能早于启动日期';
    }
    for (const type of d.types) {
      for (const def of schemas[type] || []) {
        if (def.type === 'number' && d[def.id] !== undefined && d[def.id] !== '' && (!Number.isFinite(Number(d[def.id])) || Number(d[def.id]) < (def.min || 0))) {
          e[def.id] = '请输入有效的正数';
        }
      }
      const key = type + '-productProgress';
      const value = d[key];
      if (value !== undefined && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
        e[key] = '当前产品完成进度应在 0% 到 100% 之间';
      }
    }
    for (const row of d.roles) {
      if ([row.days, row.rate].some(v => v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0))) {
        e.roles = '内部工时与单价不能为负数';
      }
    }
    return e;
  };

  const scrollToFirstError = found => {
    const firstKey = Object.keys(found)[0];
    if (!firstKey) return;
    if (firstKey === 'types') {
      document.getElementById('scope')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (firstKey === 'roles') {
      const costDetails = document.getElementById('internal-cost');
      if (costDetails) costDetails.open = true;
      costDetails?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const target = document.querySelector(`[data-field="${firstKey}"]`) || document.getElementById(firstKey);
    if (target) {
      const parentDetails = target.closest('details');
      if (parentDetails && !parentDetails.open) parentDetails.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.querySelector('input,textarea,select,button')?.focus?.();
    }
  };

  const showPreview = () => {
    setErrors(validate());
    setPreview(true);
  };

  const save = async ({ fromDrawer = false } = {}) => {
    if (readOnly) return;
    if (onSave) {
      setPending(true);
      setPendingLabel(files.length ? '正在保存并解析附件…' : '正在保存…');
      try {
        await onSave(d, files);
        setFiles([]);
        setSavedAt(new Date().toISOString());
        setDirty(false);
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        if (fromDrawer) setPreview(false);
        notify('需求已保存');
      } catch (e) {
        if (e.projectSaved) {
          setSavedAt(new Date().toISOString());
          setDirty(false);
        }
        notify(e.message, 'warn');
      } finally {
        setPending(false);
        setPendingLabel('');
      }
      return;
    }
    try {
      const at = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data: d, savedAt: at }));
      setSavedAt(at);
      setDirty(false);
      if (fromDrawer) setPreview(false);
      notify(files.length ? '输入已保存，所选文件刷新后需重新选择' : '草稿已保存到当前浏览器');
    } catch {
      notify('当前浏览器无法保存草稿，请保留此页面', 'warn');
    }
  };

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!pending && !readOnly) save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const analyze = async () => {
    if (readOnly) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setPreview(false);
      scrollToFirstError(found);
      notify('请先完善标红的必填或格式有误项', 'warn');
      return;
    }
    setPending(true);
    setPendingLabel(files.length ? '正在上传附件并启动分析…' : '正在启动 AI 分析…');
    try {
      const payloadOpts = window.PriceUI?.coerceThinkingLevel
        ? {
            ...(activeAiOpts.model ? { model: String(activeAiOpts.model).trim() } : {}),
            thinkingLevel: window.PriceUI.coerceThinkingLevel(activeAiOpts.model, activeAiOpts.thinkingLevel, aiModelsStore?.models),
            enableSearch: activeAiOpts.enableSearch !== false,
            enableUrlContext: activeAiOpts.enableUrlContext !== false
          }
        : undefined;
      await onAnalyze(d, files, payloadOpts);
      setFiles([]);
      setDirty(false);
      setPreview(false);
    } catch (e) {
      if (e.projectSaved) setDirty(false);
      notify(e.message, 'warn');
    } finally {
      setPending(false);
      setPendingLabel('');
    }
  };

  const directQuote = async () => {
    if (readOnly || !onDirectQuote) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setPreview(false);
      scrollToFirstError(found);
      notify('请先完善标红的必填信息后再创建报价单', 'warn');
      return;
    }
    setPending(true);
    setPendingLabel('正在保存需求并创建报价草稿…');
    try {
      await onDirectQuote(d, files);
      setFiles([]);
      setDirty(false);
      setPreview(false);
    } catch (e) {
      if (e.projectSaved) setDirty(false);
      notify(e.message, 'warn');
    } finally {
      setPending(false);
      setPendingLabel('');
    }
  };

  const jump = id => {
    setPreview(false);
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(id);
    }, 30);
  };

  const loadExample = () => {
    const ex = example(defaults);
    setD(ex);
    setFiles([]);
    setErrors({});
    setDirty(true);
    setOpenReadiness({ license: true, software: true, model: true });
    setConfirm(null);
    jump('project');
    notify('已填入示例需求，可按实际项目修改');
  };

  const reset = () => {
    setD(fresh(defaults));
    setFiles([]);
    setErrors({});
    setOpenReadiness({});
    setDirty(true);
    setConfirm(null);
    jump('project');
    notify('已清空当前输入');
  };

  const requestExample = () => {
    if (d.projectName || d.customerName || d.projectBrief || dirty) setConfirm('example');
    else loadExample();
  };

  const changeBudgetCurrency = value => {
    const next = Object.keys(currencyLabels).find(k => currencyLabels[k] === value);
    if (boundKnown('budgetMin') || boundKnown('budgetMax')) {
      setPendingBudgetCurrency(next);
      setConfirm('budget-currency');
    } else {
      change('budgetCurrency', next);
    }
  };

  const applyBudgetCurrency = () => {
    setD(old => ({ ...old, budgetCurrency: pendingBudgetCurrency, budgetMin: '', budgetMax: '', budgetMinUnknown: true, budgetMaxUnknown: true }));
    setDirty(true);
    setConfirm(null);
    setErrors(old => {
      const next = { ...old };
      delete next.budgetMin;
      delete next.budgetMax;
      return next;
    });
    notify('预算币种已切换，预算金额暂设为未知');
  };

  const setUnknown = (key, unknown) => {
    setD(old => ({ ...old, [key + 'Unknown']: unknown, ...(unknown ? { [key]: '' } : {}) }));
    setDirty(true);
    setErrors(old => {
      const next = { ...old };
      delete next.budgetMin;
      delete next.budgetMax;
      return next;
    });
  };

  const addCustomOption = (id, text) => {
    setD(old => {
      const builtins = Object.values(schemas).flat().find(f => f.id === id)?.options || [];
      return {
        ...old,
        customOptions: {
          ...old.customOptions,
          [id]: [...new Set([...(old.customOptions[id] || []), ...(builtins.includes(text) ? [] : [text])])]
        },
        [id]: [...new Set([...(old[id] || []), text])]
      };
    });
    setDirty(true);
  };

  const removeCustomOption = (id, text) => {
    setD(old => ({
      ...old,
      customOptions: { ...old.customOptions, [id]: (old.customOptions[id] || []).filter(x => x !== text) },
      [id]: (old[id] || []).filter(x => x !== text)
    }));
    setDirty(true);
  };

  const field = (id, label, props = {}) => (
    <F
      key={id}
      id={id}
      label={label}
      value={d[id]}
      onChange={v => change(id, v)}
      error={errors[id]}
      required={requiredKeys.has(id)}
      disabled={readOnly || props.disabled}
      customOptions={d.customOptions[id] || []}
      onCustomAdd={v => addCustomOption(id, v)}
      onCustomRemove={v => removeCustomOption(id, v)}
      {...props}
    />
  );

  const schemaField = def => {
    const { id, label, advanced, ...props } = def;
    return field(id, label, props);
  };

  const budgetField = (key, label) => field(key, label, {
    type: 'number',
    placeholder: d[key + 'Unknown'] ? '未知' : '填写已知金额，可留空',
    disabled: d[key + 'Unknown'],
    min: 0,
    suffix: d.budgetCurrency,
    labelAction: (
      <label className="unknown-control">
        <input
          type="checkbox"
          id={key + 'Unknown'}
          checked={d[key + 'Unknown']}
          disabled={readOnly}
          onChange={e => setUnknown(key, e.target.checked)}
          aria-label={label + '未知'}
        />
        未知
      </label>
    )
  });

  const toggleType = id => {
    if (readOnly) return;
    change('types', d.types.includes(id) ? d.types.filter(x => x !== id) : [...d.types, id]);
    const keys = new Set((schemas[id] || []).map(f => f.id));
    setErrors(old => Object.fromEntries(Object.entries(old).filter(([key]) => key !== 'types' && !keys.has(key) && !key.startsWith(id + '-'))));
  };

  const addCustomType = () => {
    if (readOnly) return;
    const id = uid('custom');
    setD(old => ({
      ...old,
      customTypes: [...old.customTypes, { id, name: '', description: '', deliverables: '', pricing: '' }],
      types: [...old.types, id]
    }));
    setDirty(true);
    setErrors(old => { const next = { ...old }; delete next.types; return next; });
    setTimeout(() => document.getElementById(id + '-name')?.focus(), 40);
  };

  const updateCustomType = (id, key, value) => {
    setD(old => ({ ...old, customTypes: old.customTypes.map(t => t.id === id ? { ...t, [key]: value } : t) }));
    setDirty(true);
    setErrors(old => { const next = { ...old }; delete next[id + '-' + key]; return next; });
  };

  const removeCustomType = id => {
    setD(old => {
      const next = {
        ...old,
        types: old.types.filter(t => t !== id),
        customTypes: old.customTypes.filter(t => t.id !== id)
      };
      readinessFields(id).forEach(f => delete next[f.id]);
      return next;
    });
    setDirty(true);
    setErrors(old => Object.fromEntries(Object.entries(old).filter(([key]) => !key.startsWith(id + '-'))));
  };

  const readiness = t => {
    const matchingAssets = assets.filter(a => a.service_kind === t.id || (t.custom && a.service_kind === 'custom'));
    const filled = hasReadinessContent(d, t.id);
    const isOpen = !!openReadiness[t.id];
    const stageSummary = filled
      ? [d[t.id + '-existingProduct'], d[t.id + '-productStage'], d[t.id + '-productProgress'] !== '' && d[t.id + '-productProgress'] !== undefined ? d[t.id + '-productProgress'] + '%' : ''].filter(Boolean).join(' · ')
      : (matchingAssets.length ? `可从产品库带入（${matchingAssets.length} 项）` : '选填 · 默认按无历史复用评估');

    return (
      <details
        className="product-readiness"
        open={isOpen}
        onToggle={e => setOpenReadiness(old => ({ ...old, [t.id]: e.currentTarget.open }))}
      >
        <summary>
          <I name="layers" size={15} />
          <span>现有产品基础与开发进度</span>
          <small className="readiness-summary">{stageSummary}</small>
          <I name="down" size={14} className="chev" />
        </summary>
        {matchingAssets.length > 0 && !readOnly && (
          <div className="asset-import">
            <label htmlFor={t.id + '-asset'}>从产品与成果库带入</label>
            <select
              id={t.id + '-asset'}
              value=""
              onChange={e => {
                const a = assets.find(a => a.id === e.target.value);
                if (a) {
                  setD(old => ({
                    ...old,
                    [t.id + '-productStage']: a.stage,
                    [t.id + '-productProgress']: a.progress ?? '',
                    [t.id + '-existingProduct']: [a.name, a.version].filter(Boolean).join(' '),
                    [t.id + '-completedWork']: a.completed_work || '',
                    [t.id + '-remainingWork']: a.remaining_work || ''
                  }));
                  setOpenReadiness(old => ({ ...old, [t.id]: true }));
                  setDirty(true);
                  notify('已带入产品成果信息');
                }
              }}
            >
              <option value="">选择已有产品成果…</option>
              {matchingAssets.map(a => <option key={a.id} value={a.id}>{a.name}{a.version ? ' · ' + a.version : ''}</option>)}
            </select>
          </div>
        )}
        <div className="fields-grid">{readinessFields(t.id).map(schemaField)}</div>
        <p className="readiness-note">进度按已有产品范围填写，本次客户新增工作单独说明，避免重复核算历史研发投入。</p>
      </details>
    );
  };

  const customBusiness = t => {
    const value = d.customTypes.find(x => x.id === t.id);
    return (
      <details className="business-panel custom-business" key={t.id} open>
        <summary>
          <I name="edit" size={16} />
          <span>{t.name}</span>
          <span className="custom-type-badge">自定义</span>
          <I name="down" size={15} className="chev" />
        </summary>
        <div className="business-body">
          <div className="fields-grid">
            <F id={t.id + '-name'} label="业务名称" value={value.name} disabled={readOnly} onChange={v => updateCustomType(t.id, 'name', v)} required error={errors[t.id + '-name']} placeholder="例如：数据标注、现场集成、技术培训" wide />
            <F id={t.id + '-description'} label="服务范围与需求" type="textarea" value={value.description} disabled={readOnly} onChange={v => updateCustomType(t.id, 'description', v)} required error={errors[t.id + '-description']} placeholder="描述需要完成的工作、服务对象和范围" wide />
            <F id={t.id + '-deliverables'} label="交付成果" type="textarea" value={value.deliverables} disabled={readOnly} onChange={v => updateCustomType(t.id, 'deliverables', v)} placeholder="具体交付什么，数量或验收方式是什么" wide />
            <F id={t.id + '-pricing'} label="计费方式 / 数量说明" value={value.pricing} disabled={readOnly} onChange={v => updateCustomType(t.id, 'pricing', v)} placeholder="例如：按数据条数、服务人日、项目或次数；未知可留空" wide />
          </div>
          {readiness(t)}
          {!readOnly && (
            <div className="custom-business-actions">
              <button type="button" className="text-button danger-text" aria-label={'删除自定义业务：' + t.name} onClick={() => removeCustomType(t.id)}>
                <I name="trash" size={14} />删除这项业务
              </button>
            </div>
          )}
        </div>
      </details>
    );
  };

  const updateRole = (id, key, value) => change('roles', d.roles.map(r => r.id === id ? { ...r, [key]: value } : r));

  const addFiles = chosen => {
    if (readOnly) return;
    const list = Array.from(chosen || []);
    const valid = list.filter(f => /\.(pdf|docx|xlsx|csv|txt|md|png|jpe?g|webp)$/i.test(f.name) && f.size <= 20 * 1024 * 1024);
    const merged = [...files];
    for (const f of valid) {
      if (!merged.some(x => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) merged.push(f);
    }
    const maxRemain = Math.max(0, 10 - attachments.length);
    setFiles(merged.slice(0, maxRemain));
    if (valid.length < list.length) notify('部分文件格式不支持或超过 20 MB', 'warn');
    else if (merged.length > maxRemain) notify(`每个项目最多保存 10 个附件（还可添加 ${maxRemain} 个）`, 'warn');
    else if (valid.length) notify(`已加入待上传队列（${valid.length} 个文件）`);
    if (fileRef.current) fileRef.current.value = '';
  };

  const renderRows = pairs => (
    <dl>
      {pairs.map(([label, value], idx) => {
        const text = Array.isArray(value) ? value.join('、') : value;
        return (
          <React.Fragment key={label + idx}>
            <dt>{label}</dt>
            <dd className={!text ? 'pending' : ''}>{text || '待补充 / 待确认'}</dd>
          </React.Fragment>
        );
      })}
    </dl>
  );

  const statusText = pending
    ? pendingLabel
    : hasUnsaved
      ? '有未保存的修改'
      : savedAt
        ? `${onSave ? '需求' : '草稿'}已保存 · ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '尚未保存';

  const hasNumbersErrors = Object.keys(errors).filter(k => !requiredKeys.has(k));
  const allValid = done === critical.length && !hasNumbersErrors.length;
  const parseStatusLabel = st => st === 'ready' ? '已提取文本' : st === 'image' ? '图片资料' : st === 'failed' ? '解析失败（请检查文件格式）' : '暂不支持文本提取';

  return (
    <>
      {!embedded && (
        <header className="topbar">
          <div className="brand"><Brand /><span className="brandname">报价工作台</span></div>
        </header>
      )}

      <aside className="app-sidebar form-sidebar" aria-label="需求分区导航">
        {onBack && (
          <button type="button" className="sidebar-back-btn" onClick={() => onBack()}>
            <I name="arrow" size={14} className="flip-x" />
            <span>{project ? '返回项目详情' : '返回项目列表'}</span>
          </button>
        )}
        <div className="nav-caption">需求模块</div>
        <nav aria-label="报价需求分区">
          {sections.map(s => (
            <a
              className={'nav-item' + (active === s.id ? ' active' : '')}
              key={s.id}
              href={'#' + s.id}
              onClick={e => { e.preventDefault(); jump(s.id); }}
              aria-current={active === s.id ? 'location' : undefined}
            >
              <I name={s.icon} size={17} />
              <span>
                <strong>{s.name}</strong>
                <small>{s.detail}</small>
              </span>
            </a>
          ))}
        </nav>
        <div className="app-sidebar-foot">
          <I name={hasUnsaved ? 'edit' : savedAt ? 'check' : 'clock'} size={14} />
          <span>{statusText}</span>
        </div>
      </aside>

      <main className="app-main form-workspace" data-screen-label="需求编辑页">
        <div className="app-breadcrumb">
          {onBack ? (
            <button type="button" onClick={() => onBack()}>项目报价</button>
          ) : (
            <span>项目报价</span>
          )}
          <span>/</span>
          {project && (
            <>
              <button type="button" onClick={() => onBack()}>{project.number}</button>
              <span>/</span>
            </>
          )}
          <span>{project ? '编辑项目需求' : '新建报价项目'}</span>
        </div>

        <div className="app-page-heading">
          <div className="heading-copy">
            <div className="heading-row">
              <h1>{project ? '编辑项目需求' : '新建报价项目'}</h1>
              <span className="quiet-badge">{project ? `需求 v${project.revision}` : '草稿'}</span>
            </div>
            <p>结构化梳理客户场景、复用基础与商务边界，作为成本测算与正式报价依据。</p>
          </div>
          {!readOnly && (
            <div className="page-actions">
              <button type="button" className="button ghost" id="fill-example" onClick={requestExample}>
                <I name="file" size={15} />填入示例
              </button>
              <button type="button" className="button" id="save-draft" disabled={pending} onClick={() => save()}>
                <I name="save" size={15} />{onSave ? '保存需求' : '保存草稿'}
              </button>
            </div>
          )}
        </div>

        {readOnly && window.PriceUI?.ReadOnlyBanner && <window.PriceUI.ReadOnlyBanner user={{ role: 'engineer' }} />}

        {!aiConfigured && onDirectQuote && (
          <div className="app-notice">
            <div className="notice-body">
              <I name="info" size={16} />
              <div>
                <strong>当前未配置模型推理服务</strong>
                <p>你仍可填写并保存项目需求，随后点击底部“保存并创建报价草稿”直接进入手动报价与 PDF/Excel 导出。</p>
              </div>
            </div>
          </div>
        )}

        <nav className="mobile-nav" aria-label="快速跳转">
          {sections.map(s => (
            <a key={s.id} href={'#' + s.id} className={active === s.id ? 'active' : ''} onClick={e => { e.preventDefault(); jump(s.id); }}>
              {s.name}
            </a>
          ))}
        </nav>

        <div className="content-grid">
          <form className="form-column" noValidate onSubmit={e => { e.preventDefault(); showPreview(); }}>
            <S id="project" title="项目与客户" description="明确本次报价服务的客户主体与业务目标。" action={<span className="section-tag">基础信息</span>}>
              <div className="fields-grid">
                {field('projectName', '项目名称', { placeholder: '为本次报价起一个清晰的名称', required: true, wide: true })}
                {field('customerName', '客户公司', { placeholder: '公司完整名称', required: true })}
                {field('country', '客户所在国家 / 地区', { type: 'select', options: ['中国', '中国香港', '中国台湾', '美国', '英国', '德国', '法国', '新加坡', '日本', '韩国', '澳大利亚', '加拿大', '其他 / 多个地区'] })}
                {d.country === '其他 / 多个地区' && field('countryDetails', '具体国家 / 地区', { placeholder: '例如：荷兰、阿联酋，或客户覆盖的多个市场', wide: true })}
                {field('website', '客户官网', { type: 'url', placeholder: 'https://', hint: '选填，用于辅助检索客户公开业务资料' })}
                {field('industry', '客户行业', { type: 'select', options: ['智能硬件 / 物联网', '制造 / 工业', '零售 / 消费', '互联网 / 软件', '汽车 / 交通', '医疗 / 健康', '安防 / 公共服务', '金融 / 企业服务', '教育 / 科研', '其他'] })}
                {field('customerRelation', '合作阶段', { type: 'select', options: ['首次合作', '已沟通需求', '已完成试用 / PoC', '已有客户续约', '已有客户增购'] })}
                {field('customerContact', '对接部门 / 联系人', { placeholder: '例如：产品部 / 张经理' })}
                {field('projectBrief', '项目目标与需求概述', { type: 'textarea', placeholder: '客户希望实现什么？当前痛点是什么？已有哪些数据、硬件或软件系统？', required: true, wide: true, rows: 4 })}
              </div>
            </S>

            <S id="scope" title="报价业务" required description="至少勾选一类交付业务，支持多类组合或添加自定义业务。" action={<span className="section-tag">已选 {d.types.length} 类</span>}>
              <div className="type-grid" role="group" aria-label="选择报价业务（必填）" aria-describedby={errors.types ? 'types-error' : undefined}>
                {allTypes.map(t => (
                  <button
                    type="button"
                    key={t.id}
                    id={'type-' + t.id}
                    disabled={readOnly}
                    className={'type-card' + (d.types.includes(t.id) ? ' selected' : '')}
                    aria-pressed={d.types.includes(t.id)}
                    onClick={() => toggleType(t.id)}
                  >
                    <span className="type-icon"><I name={t.icon} size={20} /></span>
                    <span className="type-copy">
                      <strong>{t.name}</strong>
                      <small>{t.detail}</small>
                    </span>
                    <span className="type-check">{d.types.includes(t.id) && <I name="check" size={11} />}</span>
                  </button>
                ))}
              </div>
              {!readOnly && (
                <button type="button" className="add-business" id="add-custom-business" onClick={addCustomType}>
                  <I name="plus" size={15} />添加自定义业务
                </button>
              )}
              {errors.types && <p className="field-error" id="types-error" role="alert">{errors.types}</p>}
              {!d.types.length && <div className="empty-selection">请选择上方业务类别，补充对应的交付范围与规格。</div>}
              {allTypes.filter(t => d.types.includes(t.id)).map(t => t.custom ? customBusiness(t) : (
                <details className="business-panel" key={t.id} open>
                  <summary>
                    <I name={t.icon} size={16} />
                    <span>{t.name}</span>
                    <I name="down" size={15} className="chev" />
                  </summary>
                  <div className="business-body">
                    <div className="fields-grid">{schemas[t.id].filter(x => !x.advanced).map(schemaField)}</div>
                    {readiness(t)}
                    <details className="advanced">
                      <summary>
                        <I name="down" size={14} />
                        {t.id === 'license' ? '授权权益与限制条件' : t.id === 'software' ? '知识产权与排除范围' : t.id === 'model' ? '评测标准、算力与归属' : '验证标准与后续衔接'}
                      </summary>
                      <div className="fields-grid">{schemas[t.id].filter(x => x.advanced).map(schemaField)}</div>
                    </details>
                  </div>
                </details>
              ))}
            </S>

            <S id="delivery" title="交付与验收" description="交期、部署环境与现场实施条件直接影响交付工作量。">
              <div className="fields-grid">
                {field('startDate', '预计启动日期', { type: 'date' })}
                {field('deliveryDate', '期望交付日期', { type: 'date' })}
                {field('deployment', '部署方式', { type: 'select', options: ['待确认', '客户本地 / 私有化', '客户云账号', '我们托管云服务', '端侧 / 嵌入式', '混合部署'] })}
                {field('hardwareProvider', '运行硬件 / 云资源由谁提供', { type: 'select', options: ['待确认', '客户提供', '我们采购并报价', '沿用已有资源', '需共同评估'] })}
                {field('deliveryLocation', '部署地区 / 现场位置', { placeholder: '例如：上海总部、海外工厂' })}
                {field('onsite', '现场交付要求', { type: 'select', options: ['待确认', '远程交付', '需要', '远程为主，必要时到场'] })}
                {d.onsite === '需要' && field('onsiteDetails', '现场实施与差旅范围', { placeholder: '地点、预计驻场人数与天数；差旅费用承担方式', wide: true })}
                {field('supportPeriod', '维护支持周期', { type: 'number', placeholder: '待确认', min: 0, suffix: '个月' })}
                {field('sla', '响应与支持要求', { placeholder: '例如：工作日支持 / 7×24 小时' })}
                {field('acceptance', '验收标准与交付节点', { type: 'textarea', placeholder: '交付物清单、分阶段里程碑（PoC / 试点 / 正式上线）与验收判定条件', wide: true })}
              </div>
            </S>

            <S id="commercial" title="商务与成本" description="明确币种、税费口径与已知内部投入，统一报价核算基准。">
              <div className="fields-grid">
                <F
                  id="currency"
                  label="报价币种"
                  type="select"
                  required
                  disabled={readOnly}
                  error={errors.currency}
                  value={currencyLabels[d.currency]}
                  options={Object.values(currencyLabels)}
                  onChange={v => change('currency', Object.keys(currencyLabels).find(k => currencyLabels[k] === v))}
                />
                {field('language', '报价单语言', { type: 'select', options: ['中文', 'English', '中英双语'] })}
                {field('budgetStatus', '客户预算情况', { type: 'select', options: ['预算未知', '未披露', '已有预算', '希望我们建议预算'] })}
                {field('priority', '客户优先关注', { type: 'select', options: ['价格与交付平衡', '控制初期投入', '尽快上线', '效果与稳定性', '长期总体成本', '待确认'] })}
                {d.budgetStatus === '已有预算' && (
                  <>
                    <F
                      id="budgetCurrency"
                      label="预算币种"
                      type="select"
                      disabled={readOnly}
                      value={currencyLabels[d.budgetCurrency]}
                      options={Object.values(currencyLabels)}
                      onChange={changeBudgetCurrency}
                    />
                    {field('budgetSource', '预算信息来源', { type: 'select', options: ['客户确认', '公开采购预算', '销售预估'] })}
                    {budgetField('budgetMin', '预算下限')}
                    {budgetField('budgetMax', '预算上限')}
                    <p className="budget-hint">预算上下限可仅填单侧，不确定时勾选“未知”。</p>
                  </>
                )}
                {field('taxMode', '税费口径', { type: 'select', options: taxModes })}
                {['含税报价', '税费另计'].includes(d.taxMode) && field('taxRate', '适用税率', { type: 'number', min: 0, max: 100, placeholder: '例如：6 或 13', suffix: '%' })}
                {field('validity', '报价有效期', { type: 'number', min: 1, suffix: '天' })}
                {field('paymentTerms', '付款方式与节点', { type: 'textarea', placeholder: '例如：合同生效 30%，试点验收 40%，终验 30%', wide: true })}
              </div>

              <details className="cost-block" id="internal-cost">
                <summary>
                  <I name="lock" size={15} />
                  <span>内部成本与定价目标</span>
                  <span className="cost-badge">仅内部测算可见</span>
                  <I name="down" size={15} className="chev" />
                </summary>
                <div className="cost-content">
                  <div className="field-subheading">已知人力投入预估<span>核算币种：人民币 CNY</span></div>
                  <div className="table-scroll">
                    <table className="cost-table">
                      <thead>
                        <tr>
                          <th>角色</th>
                          <th className="num">投入人日</th>
                          <th className="num">成本 / 人日</th>
                          <th className="num">小计</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.roles.map((r, idx) => (
                          <tr key={r.id}>
                            <td><input disabled={readOnly} aria-label={`第 ${idx + 1} 行角色`} value={r.role} onChange={e => updateRole(r.id, 'role', e.target.value)} placeholder="角色名称" /></td>
                            <td className="num"><input disabled={readOnly} type="number" min="0" aria-label={`第 ${idx + 1} 行人日`} value={r.days} onChange={e => updateRole(r.id, 'days', e.target.value)} placeholder="待估算" /></td>
                            <td className="num"><input disabled={readOnly} type="number" min="0" aria-label={`第 ${idx + 1} 行人日成本`} value={r.rate} onChange={e => updateRole(r.id, 'rate', e.target.value)} placeholder="默认按系统设置" /></td>
                            <td className="amount">{r.days !== '' && r.rate !== '' && Number(r.days) >= 0 && Number(r.rate) >= 0 ? '¥ ' + fmtNum(Number(r.days) * Number(r.rate)) : '—'}</td>
                            <td>
                              {!readOnly && (
                                <button type="button" className="icon-button danger" aria-label={`删除第 ${idx + 1} 行角色`} disabled={d.roles.length === 1} onClick={() => change('roles', d.roles.filter(x => x.id !== r.id))}>
                                  <I name="close" size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {errors.roles && <p className="field-error" role="alert">{errors.roles}</p>}
                  <div className="cost-bottom">
                    {!readOnly ? (
                      <button type="button" className="text-button" onClick={() => change('roles', [...d.roles, { id: uid('role'), role: '', days: '', rate: '' }])}>
                        <I name="plus" size={14} />添加角色
                      </button>
                    ) : <span />}
                    <span>已填人力成本 <b>¥ {fmtNum(knownLabor)}</b></span>
                  </div>
                  <div className="fields-grid">
                    {field('otherCost', '已知采购 / 算力等直接费用', { type: 'number', placeholder: '未知可留空', min: 0, suffix: 'CNY' })}
                    {field('margin', '目标项目毛利率', { type: 'number', placeholder: '留空采用系统默认毛利率', min: 0, max: 99.99, suffix: '%' })}
                    {field('riskReserve', '指定风险预留金额', { type: 'number', placeholder: '留空按系统默认比例计算', min: 0, suffix: 'CNY' })}
                    {field('costNotes', '成本与定价补充说明', { type: 'textarea', placeholder: '说明内部成本假设、可复用边界或特殊商务约束', wide: true })}
                  </div>
                </div>
              </details>
            </S>

            <S id="research" title="联网研究与推理设置" description="配置本次 AI 分析采用的推理模型、思考深度及外部公开信息检索范围。" action={<span className="section-tag">已选 {researchCount} 项</span>}>
              {aiModelsStore && window.PriceUI?.AiRunParamsBar && !readOnly && (
                <div style={{ marginBottom: 18 }}>
                  <window.PriceUI.AiRunParamsBar
                    value={activeAiOpts}
                    onChange={setAiRunOpts}
                    modelsStore={aiModelsStore}
                    disabled={pending}
                  />
                </div>
              )}
              <div className="research-list">
                <Switch id="researchCompany" label="检索客户背景" description="官网、主营产品与公开采购记录" icon="building" checked={d.researchCompany} onChange={v => !readOnly && change('researchCompany', v)} />
                <Switch id="researchCost" label="查询资源与服务成本" description="云服务器、算力、API 与第三方组件公开价格" icon="coins" checked={d.researchCost} onChange={v => !readOnly && change('researchCost', v)} />
                <Switch id="researchMarket" label="比对同类项目行情" description="公开中标公告、采购成交与市场标价" icon="layers" checked={d.researchMarket} onChange={v => !readOnly && change('researchMarket', v)} />
                {d.currency !== 'CNY' && (
                  <Switch id="researchFX" label="获取参考汇率" description={`查询人民币与 ${d.currency} 实时参考汇率`} icon="globe" checked={d.researchFX} onChange={v => !readOnly && change('researchFX', v)} />
                )}
              </div>
              {!!researchCount && (
                <div className="research-options">
                  <div className="fields-grid">
                    {d.researchCompany && field('companyTopics', '客户研究重点', { type: 'chips', options: ['主营业务与产品', '业务规模与市场', '融资与公开财报', '历史采购与供应商', '技术与产品线索'], wide: true })}
                    {field('researchRegions', '目标市场范围', { type: 'select', options: ['客户所在市场优先', '中国市场', '海外市场', '全球市场'] })}
                    {field('researchPeriod', '参考资料时效', { type: 'select', options: ['近 1 年', '近 2 年', '近 3 年', '不限，标注资料日期'] })}
                    {field('researchKeywords', '重点检索关键词', { placeholder: '例如：同类系统成交价、边缘盒子硬件成本', wide: true })}
                    {field('sourceLinks', '指定参考网页链接', { type: 'textarea', placeholder: '可填写客户官网、招标公告或供应商定价页链接，每行一条', wide: true })}
                  </div>
                  <p className="inline-note"><I name="info" size={14} />公开检索结果仅作为成本与价格核对依据，客户预算仍以实际确认为准。</p>
                </div>
              )}
            </S>

            <S id="materials" title="资料与补充" description="上传 PRD、招标书、功能清单表或补充约定。">
              {!readOnly && (
                <>
                  <input className="hidden-file" ref={fileRef} type="file" multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={e => addFiles(e.target.files)} aria-label="选择需求资料" />
                  <button
                    type="button"
                    className={'dropzone' + (dragging ? ' dragging' : '')}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                  >
                    <span className="dropzone-icon"><I name="upload" size={22} /></span>
                    <span>
                      <strong>点击选择文件，或拖拽资料到此处</strong>
                      <small>支持 PDF、DOCX、XLSX、CSV、TXT、MD 及常见图片 · 单文件不超过 20 MB，最多 10 个</small>
                    </span>
                  </button>
                </>
              )}

              {!!attachments.length && (
                <div className="files-list">
                  {attachments.map(file => (
                    <div className={'file-item' + (file.parseStatus === 'failed' ? ' file-failed' : '')} key={file.id}>
                      <I name={file.parseStatus === 'failed' ? 'alert' : 'file'} size={17} />
                      <div>
                        <a href={window.appPath('/api/files/download' + (window.PriceUI ? window.PriceUI.qs({ id: file.id }) : '?id=' + encodeURIComponent(file.id)))} target="_blank" rel="noopener noreferrer">
                          <strong>{file.name}</strong>
                        </a>
                        <small>{Math.ceil(file.size / 1024)} KB · {parseStatusLabel(file.parseStatus)}</small>
                      </div>
                      {!readOnly && onRemoveAttachment && (
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={'删除附件 ' + file.name}
                          onClick={async () => {
                            try { await onRemoveAttachment(file.id); notify('附件已移除'); } catch (e) { notify(e.message, 'warn'); }
                          }}
                        >
                          <I name="trash" size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!!files.length && (
                <div className="files-list">
                  {files.map((file, i) => (
                    <div className="file-item pending-upload" key={file.name + i}>
                      <I name="upload" size={17} />
                      <div>
                        <strong>{file.name}</strong>
                        <small>{file.size < 1024 * 1024 ? Math.ceil(file.size / 1024) + ' KB' : (file.size / 1024 / 1024).toFixed(1) + ' MB'} · 待上传（保存时自动上传并提取文本）</small>
                      </div>
                      <button type="button" className="icon-button" aria-label={'取消选择 ' + file.name} onClick={() => setFiles(files.filter((_, n) => n !== i))}>
                        <I name="close" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="field-separator" />
              <div className="fields-grid">
                {field('notes', '其他要求与假设', { type: 'textarea', placeholder: '例如：分期报价要求、客户需配合提供的环境条件，或希望重点评估的风险点', wide: true })}
              </div>

              {!!d.customFields.length && (
                <div className="custom-fields-wrap">
                  {d.customFields.map((c, i) => (
                    <div className="custom-row" key={c.id}>
                      <F id={'custom-name-' + c.id} label="补充项名称" disabled={readOnly} value={c.name} onChange={v => change('customFields', d.customFields.map(x => x.id === c.id ? { ...x, name: v } : x))} placeholder="例如：试用周期" />
                      <F id={'custom-value-' + c.id} label="补充内容" disabled={readOnly} value={c.value} onChange={v => change('customFields', d.customFields.map(x => x.id === c.id ? { ...x, value: v } : x))} placeholder="填写具体说明" />
                      {!readOnly && (
                        <button type="button" className="icon-button danger" aria-label={`删除补充项 ${i + 1}`} onClick={() => change('customFields', d.customFields.filter(x => x.id !== c.id))}>
                          <I name="trash" size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!readOnly && (
                <div className="custom-intro">
                  <p>需要补充表单未覆盖的特定商务或技术维度？</p>
                  <button type="button" className="text-button" id="add-custom" onClick={() => change('customFields', [...d.customFields, { id: uid('field'), name: '', value: '' }])}>
                    <I name="plus" size={14} />添加补充维度
                  </button>
                </div>
              )}
            </S>
          </form>

          <aside className="summary-column" aria-label="报价需求摘要">
            <div className="summary-card">
              <div className="summary-title"><I name="file" size={16} />需求摘要</div>
              <div className="summary-content">
                <div className="summary-project">{d.projectName || '未命名项目'}</div>
                <div className="summary-client">{d.customerName || '待填写客户公司'}</div>
                <div className="summary-label">已选业务</div>
                <div className="summary-tags">
                  {d.types.length ? allTypes.filter(t => d.types.includes(t.id)).map(t => <span key={t.id}>{t.name}</span>) : <span>尚未选择</span>}
                </div>
                <dl>
                  <div className="summary-row"><dt>报价币种</dt><dd>{currencyLabels[d.currency]}</dd></div>
                  <div className="summary-row"><dt>税费口径</dt><dd>{d.taxMode}{['含税报价', '税费另计'].includes(d.taxMode) && d.taxRate !== '' ? ` (${d.taxRate}%)` : ''}</dd></div>
                  <div className="summary-row"><dt>文档语言</dt><dd>{d.language}</dd></div>
                  <div className="summary-row"><dt>期望交付</dt><dd>{d.deliveryDate || '待确认'}</dd></div>
                  <div className="summary-row"><dt>附件资料</dt><dd>{(files.length + attachments.length) ? (files.length + attachments.length) + ' 个文件' : '未添加'}</dd></div>
                </dl>
                <div className="summary-divider" />
                <div className="progress-label">
                  <span>必填完成度</span>
                  <strong>{done} / {critical.length}</strong>
                </div>
                <div className="progress-track"><div style={{ width: (done / critical.length * 100) + '%' }} /></div>
                <div className="checklist">
                  {checklist.map(c => (
                    <div className={'checklist-row' + (c.done ? ' done' : '')} key={c.key}>
                      <span className="check-ring">{c.done && <I name="check" size={9} />}</span>
                      {c.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="summary-caption"><I name="lock" size={13} />内部成本参数仅用于测算，不会写入对外报价单。</div>
            </div>
            <div className="review-tip">
              <button className="text-button" type="button" onClick={showPreview}>
                核对全部已填内容<I name="arrow" size={13} />
              </button>
            </div>
          </aside>
        </div>
      </main>

      {!readOnly && (
        <footer className="form-footer">
          <span className="footer-status">
            <I name={hasUnsaved ? 'edit' : savedAt ? 'check' : 'clock'} size={14} />
            {statusText}
          </span>
          <div className="footer-actions">
            <span className="footer-hint">必填项 <strong>{done}</strong> / {critical.length}</span>
            <button type="button" className="button ghost" id="reset-input" disabled={pending} onClick={() => setConfirm('reset')}>清空</button>
            <button type="button" className="button ghost" id="preview-input" disabled={pending} onClick={showPreview}>预览需求</button>
            {onDirectQuote && (
              <button
                type="button"
                className={aiConfigured ? 'button' : 'button primary large'}
                id="direct-create-quote"
                disabled={pending}
                onClick={directQuote}
              >
                保存并手动建报价
              </button>
            )}
            {onAnalyze && (
              <button
                type="button"
                className={aiConfigured ? 'button primary large' : 'button'}
                id="start-analysis"
                disabled={pending}
                onClick={analyze}
              >
                {pending ? '正在处理…' : '开始 AI 分析'}
                <I name="arrow" size={15} />
              </button>
            )}
          </div>
        </footer>
      )}

      {toast && (
        <div key={toast.key} className={'toast' + (toast.type === 'warn' ? ' warn' : '')} role="status">
          <I name={toast.type === 'warn' ? 'alert' : 'check'} size={16} />
          {toast.message}
        </div>
      )}

      {confirm && (
        <Overlay
          title={confirm === 'example' ? '填入示例需求' : confirm === 'budget-currency' ? '切换预算币种' : '清空当前输入'}
          compact
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setConfirm(null)}>取消</button>
              <button type="button" className="button primary" onClick={confirm === 'example' ? loadExample : confirm === 'budget-currency' ? applyBudgetCurrency : reset}>
                {confirm === 'example' ? '替换为示例' : confirm === 'budget-currency' ? '切换并重填' : '确认清空'}
              </button>
            </>
          }
        >
          <p>
            {confirm === 'example'
              ? '将使用零售视频识别综合项目示例替换当前表单内容，方便快速体验完整测算与报价流程。'
              : confirm === 'budget-currency'
                ? '切换预算币种将清空已填预算金额并暂设为未知，报价币种与内部成本不受影响。'
                : '将清空当前未保存的表单内容及待上传文件队列。'}
          </p>
        </Overlay>
      )}

      {preview && (
        <Overlay
          title="报价需求预览"
          subtitle="核对本次输入信息，未确认字段将在后续分析中标记为待确认项。"
          onClose={() => setPreview(false)}
          footer={
            <>
              <button type="button" className="button" disabled={pending} onClick={() => setPreview(false)}>继续编辑</button>
              {!readOnly && (
                <button type="button" className={allValid && (onAnalyze || onDirectQuote) ? 'button' : 'button primary'} disabled={pending} onClick={() => save({ fromDrawer: true })}>
                  <I name="save" size={14} />{pending ? '处理中…' : '保存需求'}
                </button>
              )}
              {!readOnly && allValid && onDirectQuote && !aiConfigured && (
                <button type="button" className="button primary" disabled={pending} onClick={directQuote}>
                  保存并创建报价<I name="arrow" size={14} />
                </button>
              )}
              {!readOnly && allValid && onAnalyze && aiConfigured && (
                <button type="button" className="button primary" disabled={pending} onClick={analyze}>
                  保存并开始分析<I name="arrow" size={14} />
                </button>
              )}
            </>
          }
        >
          <div className={'review-alert' + (allValid ? ' ok' : '')}>
            <strong>
              {hasNumbersErrors.length
                ? '存在格式或数值范围错误，请修正后继续'
                : allValid
                  ? '必填信息已齐备，可保存需求或直接发起测算'
                  : `还有 ${critical.length - done} 项必填信息待补充`}
            </strong>
            <p>
              {hasNumbersErrors.length
                ? hasNumbersErrors.map(k => errors[k]).join('；')
                : allValid
                  ? (aiConfigured ? '可点击下方“保存并开始分析”进入成本拆解，或直接手动创建报价草稿。' : '当前可直接保存并手动创建报价草稿。')
                  : critical.filter(c => !c.done).map(c => c.label).join('、')}
            </p>
          </div>

          {!readOnly && allValid && onAnalyze && aiConfigured && aiModelsStore && window.PriceUI?.AiRunParamsBar && (
            <div style={{ marginBottom: 20 }}>
              <window.PriceUI.AiRunParamsBar
                compact
                value={activeAiOpts}
                onChange={setAiRunOpts}
                modelsStore={aiModelsStore}
                disabled={pending}
              />
            </div>
          )}

          <div className="review-section">
            <div className="review-section-heading"><h3>项目与客户</h3><button type="button" className="text-button" onClick={() => jump('project')}>定位编辑</button></div>
            {renderRows([
              ['项目名称', d.projectName],
              ['客户公司', d.customerName],
              ['国家 / 地区', d.country === '其他 / 多个地区' ? d.countryDetails : d.country],
              ['客户官网', d.website],
              ['客户行业', d.industry],
              ['合作阶段', d.customerRelation],
              ['对接人 / 部门', d.customerContact],
              ['项目目标', d.projectBrief]
            ])}
          </div>

          <div className="review-section">
            <div className="review-section-heading"><h3>报价业务</h3><button type="button" className="text-button" onClick={() => jump('scope')}>定位编辑</button></div>
            {!d.types.length && <p className="review-footnote">尚未选择业务类型</p>}
            {allTypes.filter(t => d.types.includes(t.id)).map(t => (
              <div key={t.id}>
                <h4 className="review-business">{t.name}{t.custom ? ' · 自定义' : ''}</h4>
                {renderRows(
                  t.custom
                    ? [['业务名称', d.customTypes.find(x => x.id === t.id)?.name], ['服务范围与需求', t.description], ['交付成果', t.deliverables], ['计费方式 / 数量说明', t.pricing]]
                    : schemas[t.id].map(f => [f.label, d[f.id]])
                )}
                {hasReadinessContent(d, t.id) && (
                  <>
                    <h5 className="review-readiness">现有产品基础与开发进度</h5>
                    {renderRows(readinessFields(t.id).map(f => [f.label, d[f.id] !== undefined && d[f.id] !== '' ? d[f.id] + (f.suffix || '') : '']))}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="review-section">
            <div className="review-section-heading"><h3>交付与验收</h3><button type="button" className="text-button" onClick={() => jump('delivery')}>定位编辑</button></div>
            {renderRows([
              ['预计启动', d.startDate],
              ['期望交付', d.deliveryDate],
              ['部署方式', d.deployment],
              ['硬件与资源', d.hardwareProvider],
              ['部署位置', d.deliveryLocation],
              ['现场要求', d.onsite],
              ...(d.onsite === '需要' ? [['现场实施', d.onsiteDetails]] : []),
              ['维护周期', d.supportPeriod !== '' ? d.supportPeriod + ' 个月' : ''],
              ['响应与支持', d.sla],
              ['验收与节点', d.acceptance]
            ])}
          </div>

          <div className="review-section">
            <div className="review-section-heading"><h3>商务与成本</h3><button type="button" className="text-button" onClick={() => jump('commercial')}>定位编辑</button></div>
            {renderRows([
              ['报价币种', currencyLabels[d.currency]],
              ['文档语言', d.language],
              ['预算情况', d.budgetStatus],
              ...(d.budgetStatus === '已有预算' ? [['预算下限', boundText('budgetMin')], ['预算上限', boundText('budgetMax')], ['预算来源', d.budgetSource]] : []),
              ['客户优先关注', d.priority],
              ['税费口径', d.taxMode],
              ...(['含税报价', '税费另计'].includes(d.taxMode) ? [['税率', d.taxRate !== '' ? d.taxRate + '%' : '']] : []),
              ['报价有效期', d.validity ? d.validity + ' 天' : ''],
              ['付款安排', d.paymentTerms],
              ['目标毛利率', d.margin !== '' ? d.margin + '%' : '按系统默认'],
              ['已知直接费用', d.otherCost !== '' ? 'CNY ' + fmtNum(d.otherCost) : ''],
              ['指定风险预留', d.riskReserve !== '' ? 'CNY ' + fmtNum(d.riskReserve) : ''],
              ['成本补充', d.costNotes]
            ])}
            {d.roles.some(r => r.role || r.days || r.rate) && (
              <>
                <h4 className="review-business">内部人员投入预估 · CNY</h4>
                {renderRows(d.roles.map((r, i) => [
                  r.role || '角色 ' + (i + 1),
                  `${r.days || '待估算'} 人日 × ${r.rate !== '' ? '¥ ' + r.rate : '按默认单价'}${r.days !== '' && r.rate !== '' ? ' = ¥ ' + fmtNum(Number(r.days) * Number(r.rate)) : ''}`
                ]))}
              </>
            )}
          </div>

          <div className="review-section">
            <div className="review-section-heading"><h3>联网研究</h3><button type="button" className="text-button" onClick={() => jump('research')}>定位编辑</button></div>
            {renderRows([
              ['客户背景检索', d.researchCompany ? '启用' : '关闭'],
              ['资源成本查询', d.researchCost ? '启用' : '关闭'],
              ['同类项目比对', d.researchMarket ? '启用' : '关闭'],
              ...(d.currency !== 'CNY' ? [['参考汇率查询', d.researchFX ? '启用' : '关闭']] : []),
              ...(researchCount ? [
                ...(d.researchCompany ? [['客户研究重点', d.companyTopics]] : []),
                ['目标市场', d.researchRegions],
                ['资料时效', d.researchPeriod],
                ['重点关键词', d.researchKeywords],
                ['指定参考链接', d.sourceLinks]
              ] : [])
            ])}
          </div>

          <div className="review-section">
            <div className="review-section-heading"><h3>资料与补充</h3><button type="button" className="text-button" onClick={() => jump('materials')}>定位编辑</button></div>
            {renderRows([
              ['附件资料', [...attachments, ...files].map(f => f.name)],
              ['其他要求与假设', d.notes],
              ...d.customFields.map(c => [c.name || '未命名补充项', c.value])
            ])}
          </div>
        </Overlay>
      )}
    </>
  );
}

window.QuoteApp = QuoteApp;
if (!window.QUOTE_PLATFORM) {
  ReactDOM.createRoot(document.getElementById('root')).render(<QuoteApp />);
}
