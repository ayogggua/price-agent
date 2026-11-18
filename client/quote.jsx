const {
  uid, qs, api, downloadFile, go, setDirtyGuard, calcQuoteTotals,
  money, date, shortDate, statuses, evidenceNames, canWriteBusiness,
  Status, ErrorBox, NoticeBox, ReadOnlyBanner, Empty, Loading, Field, Confirm, PageTitle
} = window.PriceUI;

const businessTypeNames = {
  license: '算法 License',
  software: '软件开发',
  model: '模型开发',
  solution: '算法方案',
  custom: '其他服务'
};

function LibraryPickerModal({ kind, currency, defaultUnit, onClose, onPick }) {
  const isAssets = kind === 'assets';
  const store = window.PriceUI.useLoad(isAssets ? '/assets/list' : '/references/list');
  const [kw, setKw] = React.useState('');
  const [cat, setCat] = React.useState('all');

  const rows = store.data?.[isAssets ? 'assets' : 'references'] || [];
  const filtered = rows.filter(r => {
    if (cat !== 'all') {
      if (isAssets && r.service_kind !== cat) return false;
      if (!isAssets && r.evidence_type !== cat) return false;
    }
    if (!kw.trim()) return true;
    const text = isAssets
      ? `${r.name} ${r.version} ${r.completed_work} ${r.notes}`
      : `${r.title} ${r.service_kind} ${r.scope_text} ${r.notes}`;
    return text.toLowerCase().includes(kw.trim().toLowerCase());
  });

  return (
    <QuoteOverlay
      wide
      title={isAssets ? '从产品与成果库选入明细' : '从历史价格参考库引用'}
      subtitle={isAssets ? '选择已有产品或模块快速生成报价明细行。' : `选择历史成交或公开价格记录带入报价明细（当前报价币种：${currency}）。`}
      onClose={onClose}
      footer={<button type="button" className="button" onClick={onClose}>关闭</button>}
    >
      <div className="picker-toolbar">
        <div className="filter-pills">
          <button type="button" className={'filter-pill' + (cat === 'all' ? ' active' : '')} onClick={() => setCat('all')}>全部</button>
          {isAssets
            ? Object.entries(businessTypeNames).map(([k, v]) => (
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
            placeholder={isAssets ? '搜索产品名称或功能描述…' : '搜索参考项目、类别或范围…'}
            value={kw}
            onChange={e => setKw(e.target.value)}
          />
        </div>
      </div>

      <ErrorBox error={store.error} />
      {store.loading ? (
        <Loading />
      ) : !filtered.length ? (
        <Empty
          icon={isAssets ? 'layers' : 'coins'}
          title={rows.length ? '没有匹配当前筛选条件的记录' : (isAssets ? '产品与成果库暂无记录' : '价格参考库暂无记录')}
          description={rows.length ? '请调整搜索词或分类筛选。' : '可前往左侧导航栏维护常用产品资产与历史成交参考。'}
        />
      ) : (
        <div className="picker-list">
          {filtered.map(r => (
            <div className="picker-item" key={r.id}>
              <div className="picker-item-body">
                {isAssets ? (
                  <>
                    <div className="picker-item-head">
                      <strong>{r.name}{r.version ? ' ' + r.version : ''}</strong>
                      <span className="quiet-badge">{businessTypeNames[r.service_kind] || r.service_kind}</span>
                      <span className="muted">{r.stage}{r.progress !== null ? ` · ${r.progress}%` : ''}</span>
                    </div>
                    <p>{r.completed_work || r.notes || '暂无交付范围说明'}</p>
                  </>
                ) : (
                  <>
                    <div className="picker-item-head">
                      <strong>{r.title}</strong>
                      <span className="quiet-badge">{evidenceNames[r.evidence_type] || r.evidence_type}</span>
                      <span className="picker-price">{money(r.amount, r.currency)}</span>
                    </div>
                    <p>{r.scope_text}</p>
                    <small className="muted">
                      {r.service_kind}{r.reference_date ? ' · ' + r.reference_date : ''}
                      {r.currency !== currency ? ` · 原币种 ${r.currency}（选入后请按 ${currency} 核对单价）` : ''}
                    </small>
                  </>
                )}
              </div>
              <button
                type="button"
                className="button small primary"
                onClick={() => {
                  if (isAssets) {
                    onPick({
                      id: uid('item'),
                      name: [r.name, r.version].filter(Boolean).join(' '),
                      description: r.completed_work || r.notes || '',
                      quantity: 1,
                      unit: defaultUnit,
                      unitPrice: 0
                    });
                  } else {
                    const sameCurrency = r.currency === currency;
                    onPick({
                      id: uid('item'),
                      name: r.title,
                      description: r.scope_text + (!sameCurrency ? `\n（参考原价：${money(r.amount, r.currency)}，请核对折算单价）` : ''),
                      quantity: 1,
                      unit: defaultUnit,
                      unitPrice: sameCurrency ? Number(r.amount) : 0
                    });
                  }
                }}
              >
                选入明细
              </button>
            </div>
          ))}
        </div>
      )}
    </QuoteOverlay>
  );
}

function QuotePage({ quoteId, user }) {
  const { data, error, reload, setData, setError } = window.PriceUI.useLoad('/quotes/get' + qs({ id: quoteId }));
  const [content, setContent] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [view, setView] = React.useState('edit');
  const [deal, setDeal] = React.useState(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyDetail, setHistoryDetail] = React.useState(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [pickerKind, setPickerKind] = React.useState(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState({});
  const [defaultSeller, setDefaultSeller] = React.useState(null);

  React.useEffect(() => {
    api('/settings/get').then(r => setDefaultSeller(r?.settings || null)).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (data) {
      const normalized = {
        ...data.quote.content,
        taxMode: data.quote.content.taxMode === '税费另行说明' ? '税费另计' : data.quote.content.taxMode
      };
      setContent(normalized);
      setDirty(false);
      setFieldErrors({});
    }
  }, [data?.quote.revision]);

  React.useEffect(() => {
    setDirtyGuard(() => dirty);
    return () => setDirtyGuard(null);
  }, [dirty]);

  React.useEffect(() => {
    const fn = e => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);

  const clearFieldError = key => {
    setFieldErrors(old => {
      if (!old[key]) return old;
      const next = { ...old };
      delete next[key];
      return next;
    });
  };

  const change = (key, value) => {
    setContent(old => ({ ...old, [key]: value }));
    setDirty(true);
    clearFieldError(key);
  };

  const validateQuote = (c, { forReview = false } = {}) => {
    const errs = {};
    if (!String(c.title || '').trim()) errs.title = '请填写报价名称';
    if (!String(c.customer || '').trim()) errs.customer = '请填写客户公司名称';
    const valNum = Number(c.validity);
    if (!Number.isInteger(valNum) || valNum < 1 || valNum > 3650) errs.validity = '有效期需为 1–3650 的整数天';
    const taxRateNum = Number(c.taxRate);
    if (!Number.isFinite(taxRateNum) || taxRateNum < 0 || taxRateNum > 100) errs.taxRate = '税率应在 0–100% 之间';
    const discNum = Number(c.discountPercent);
    if (!Number.isFinite(discNum) || discNum < 0 || discNum > 100) errs.discountPercent = '折扣比例应在 0–100% 之间';

    if (!Array.isArray(c.items) || !c.items.length) {
      errs.items = '至少需要保留一行报价明细';
    } else {
      c.items.forEach((item, idx) => {
        if (!String(item.name || '').trim()) errs['item-name-' + item.id] = `请填写第 ${idx + 1} 项名称`;
        if (!String(item.unit || '').trim()) errs['item-unit-' + item.id] = '必填';
        if (!(Number(item.quantity) > 0)) errs['item-qty-' + item.id] = '需大于 0';
        if (!(Number(item.unitPrice) >= 0 && Number.isFinite(Number(item.unitPrice)))) errs['item-price-' + item.id] = '无效单价';
      });
    }

    if (forReview) {
      if (!String(c.seller || '').trim()) errs.seller = '提交审核前请填写报价方公司名称';
      if (c.taxMode === '待确认') errs.taxMode = '提交审核前请确认税费口径';
      if (!String(c.paymentTerms || '').trim()) errs.paymentTerms = '提交审核前请明确付款方式与节点';
      const totals = calcQuoteTotals(c);
      if (totals.total <= 0) errs.total = '对外报价合计金额必须大于 0';
    }
    return errs;
  };

  const focusFirstQuoteError = errs => {
    const keys = Object.keys(errs);
    if (!keys.length) return;
    setView('edit');
    setTimeout(() => {
      const el = document.getElementById('qfield-' + keys[0]);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector?.('input,select,textarea')?.focus?.() || el?.focus?.();
    }, 40);
  };

  const save = async () => {
    const errs = validateQuote(content, { forReview: false });
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      focusFirstQuoteError(errs);
      throw new Error(Object.values(errs)[0]);
    }
    const { quote } = await api('/quotes/save', { id: quoteId, revision: data.quote.revision, content });
    setData(old => ({ ...old, quote }));
    setContent(quote.content);
    setDirty(false);
    setFieldErrors({});
    return quote;
  };

  const action = async fn => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (data && content && dirty && !busy && canWriteBusiness(user) && !['won', 'lost'].includes(data.quote.status)) {
          action(save);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const transition = async (status, extra = {}) => {
    if (['review', 'approved'].includes(status)) {
      const errs = validateQuote(content, { forReview: true });
      setFieldErrors(errs);
      if (Object.keys(errs).length) {
        focusFirstQuoteError(errs);
        throw new Error(Object.values(errs)[0]);
      }
    }
    let q = data.quote;
    if (dirty) q = await save();
    const r = await api('/quotes/status', { id: quoteId, revision: q.revision, status, ...extra });
    setData(old => ({ ...old, quote: r.quote }));
    await reload();
    setDeal(null);
  };

  const download = async format => {
    let q = data.quote;
    if (dirty && canWriteBusiness(user) && !['won', 'lost'].includes(q.status)) {
      q = await save();
    }
    const isDraft = !['approved', 'sent', 'won'].includes(q.status);
    const fallback = q.number + (isDraft ? '-draft' : '') + '.' + format;
    await downloadFile('/quotes/export' + qs({ id: quoteId, format }), fallback);
  };

  const loadHistoryVersion = async vId => {
    setHistoryLoading(true);
    try {
      const res = await api('/quotes/version' + qs({ id: vId }));
      setHistoryDetail(res.version);
    } catch (e) {
      setError(e.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!data || !content) return <><ErrorBox error={error} /><Loading /></>;

  const q = data.quote;
  const canEdit = canWriteBusiness(user) && !['won', 'lost'].includes(q.status);
  const approved = ['approved', 'sent', 'won'].includes(q.status);
  const total = calcQuoteTotals(content);
  const defaultUnit = content.language === 'English' ? 'project' : '项';
  const taxActive = ['含税报价', '税费另计'].includes(content.taxMode);

  const updateItem = (itemId, patch) => {
    change('items', content.items.map(x => x.id === itemId ? { ...x, ...patch } : x));
    Object.keys(patch).forEach(k => {
      const mapKey = k === 'name' ? 'name' : k === 'unit' ? 'unit' : k === 'quantity' ? 'qty' : k === 'unitPrice' ? 'price' : '';
      if (mapKey) clearFieldError(`item-${mapKey}-${itemId}`);
    });
  };

  const moveItem = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= content.items.length) return;
    const next = [...content.items];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    change('items', next);
  };

  const duplicateItem = idx => {
    const src = content.items[idx];
    const copy = { ...src, id: uid('item'), name: src.name ? src.name + '（副本）' : '' };
    const next = [...content.items];
    next.splice(idx + 1, 0, copy);
    change('items', next);
  };

  const syncDefaultSeller = () => {
    if (!defaultSeller) return;
    setContent(old => ({
      ...old,
      seller: defaultSeller.companyName || old.seller,
      sellerContact: defaultSeller.companyContact || old.sellerContact,
      sellerAddress: defaultSeller.companyAddress || old.sellerAddress
    }));
    setDirty(true);
    clearFieldError('seller');
  };

  return (
    <>
      <div className="app-breadcrumb">
        <button type="button" onClick={() => go('projects')}>项目报价</button>
        <span>/</span>
        <button type="button" onClick={() => go('project', q.projectId)}>返回所属项目</button>
        <span>/</span>
        <span>{q.number}</span>
      </div>

      <PageTitle
        title={content.title || '报价单'}
        badge={<Status value={q.status} />}
        description={`${q.number} · 版本 v${q.revision} · 币种 ${content.currency}${dirty ? ' · 有未保存的修改' : ''}`}
      >
        {canEdit && q.status === 'draft' && (
          <button type="button" className="button ghost danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <QuoteIcon name="trash" size={14} />删除草稿
          </button>
        )}
        {canEdit && (
          <button type="button" className="button" disabled={busy || !dirty} onClick={() => action(save)}>
            <QuoteIcon name="save" size={14} />保存修改
          </button>
        )}
        <button type="button" className="button" disabled={busy} onClick={() => action(() => download('xlsx'))}>
          <QuoteIcon name="download" size={14} />导出 Excel
        </button>
        <button type="button" className="button primary" disabled={busy} onClick={() => action(() => download('pdf'))}>
          <QuoteIcon name="download" size={14} />导出 PDF
        </button>
      </PageTitle>

      <ReadOnlyBanner user={user} />
      <ErrorBox error={error} />

      {dirty && approved && (
        <NoticeBox>
          <strong>当前报价单已处于“{statuses[q.status]}”状态</strong>
          <p>保存新的内容修改后，报价状态将自动退回“草稿”并生成新版本，需重新经过审核批准。</p>
        </NoticeBox>
      )}

      <div className="quote-control-row">
        <div className="app-tabs compact-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'edit'} className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            编辑报价明细
          </button>
          <button type="button" role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>
            正式版式预览
          </button>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="button small"
            onClick={() => {
              setHistoryOpen(true);
              if (data.versions[0]) loadHistoryVersion(data.versions[0].id);
            }}
          >
            <QuoteIcon name="clock" size={14} />历史版本 ({data.versions.length})
          </button>

          {canEdit && q.status === 'draft' && (
            <button type="button" className="button primary" disabled={busy} onClick={() => action(() => transition('review'))}>
              提交审核
            </button>
          )}
          {q.status === 'review' && ['admin', 'reviewer'].includes(user.role) && (
            <>
              <button type="button" className="button" disabled={busy} onClick={() => action(() => transition('draft'))}>退回修改</button>
              <button type="button" className="button primary" disabled={busy || dirty} onClick={() => action(() => transition('approved'))}>批准报价</button>
            </>
          )}
          {canEdit && q.status === 'approved' && (
            <button type="button" className="button" disabled={busy || dirty} onClick={() => action(() => transition('sent'))}>标记已发送</button>
          )}
          {canEdit && ['approved', 'sent'].includes(q.status) && (
            <>
              <button type="button" className="button primary" disabled={busy || dirty} onClick={() => setDeal(String(total.total))}>记录成交</button>
              <button type="button" className="button" disabled={busy || dirty} onClick={() => action(() => transition('lost'))}>记录未成交</button>
            </>
          )}
        </div>
      </div>

      {view === 'preview' ? (
        <QuotePaper content={content} totals={total} number={q.number} draft={!approved || dirty} createdAt={q.createdAt} />
      ) : (
        <fieldset className="quote-edit-fields" disabled={!canEdit || busy}>
          <div className="panel content-panel">
            <h2>商务主体与基础信息</h2>
            <div className="simple-grid">
              <div id="qfield-title">
                <Field label="报价名称" required error={fieldErrors.title}>
                  <input value={content.title} onChange={e => change('title', e.target.value)} placeholder="对外报价单标题" />
                </Field>
              </div>
              <div id="qfield-customer">
                <Field label="客户公司" required error={fieldErrors.customer}>
                  <input value={content.customer} onChange={e => change('customer', e.target.value)} placeholder="客户完整名称" />
                </Field>
              </div>
              <div id="qfield-seller">
                <Field
                  label="报价方公司（提审必填）"
                  required
                  error={fieldErrors.seller}
                  labelAction={
                    canEdit && !String(content.seller || '').trim() ? (
                      defaultSeller?.companyName ? (
                        <button type="button" className="text-button small-link" onClick={syncDefaultSeller}>填入系统默认报价方</button>
                      ) : user.role === 'admin' ? (
                        <button type="button" className="text-button small-link" onClick={() => go('settings')}>前往配置默认报价方</button>
                      ) : null
                    ) : null
                  }
                >
                  <input value={content.seller} onChange={e => change('seller', e.target.value)} placeholder="本公司全称" />
                </Field>
              </div>
              <Field label="报价方联系方式">
                <input value={content.sellerContact} onChange={e => change('sellerContact', e.target.value)} placeholder="联系人 / 电话 / 邮箱" />
              </Field>
              <Field label="报价方地址" wide>
                <input value={content.sellerAddress} onChange={e => change('sellerAddress', e.target.value)} placeholder="公司办公或通信地址（展示于报价单页脚）" />
              </Field>
              <Field label="报价单语言">
                <select value={content.language} onChange={e => change('language', e.target.value)}>
                  {['中文', 'English', '中英双语'].map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="报价币种" hint={content.currency !== 'CNY' && content.fxRate ? `折算参考：1 CNY = ${content.fxRate} ${content.currency}` : undefined}>
                <input value={content.currency} readOnly />
              </Field>
              <div id="qfield-validity">
                <Field label="报价有效期（天）" required error={fieldErrors.validity}>
                  <input type="number" min="1" max="3650" value={content.validity} onChange={e => change('validity', e.target.value)} />
                </Field>
              </div>
            </div>
          </div>

          <div className="panel" id="qfield-total">
            <div className="panel-toolbar wrap-toolbar">
              <div>
                <h2>报价明细表</h2>
                <p className="muted" style={{ marginTop: 3 }}>支持上下调整顺序、复制条目，或直接从产品库与历史价格库选入。</p>
              </div>
              {canEdit && (
                <div className="inline-actions">
                  <button type="button" className="button small" onClick={() => setPickerKind('assets')}>
                    <QuoteIcon name="layers" size={14} />从产品成果库选入
                  </button>
                  <button type="button" className="button small" onClick={() => setPickerKind('references')}>
                    <QuoteIcon name="coins" size={14} />从价格参考库引用
                  </button>
                  <button
                    type="button"
                    className="button small primary"
                    onClick={() => change('items', [...content.items, { id: uid('item'), name: '', description: '', quantity: 1, unit: defaultUnit, unitPrice: 0 }])}
                  >
                    <QuoteIcon name="plus" size={14} />添加明细行
                  </button>
                </div>
              )}
            </div>

            {fieldErrors.total && <div style={{ padding: '12px 24px 0' }}><ErrorBox error={fieldErrors.total} /></div>}

            <div className="table-scroll">
              <table className="quote-edit-table">
                <thead>
                  <tr>
                    <th className="col-idx">#</th>
                    <th className="col-scope">报价项目 / 对外交付范围</th>
                    <th className="col-qty num">数量</th>
                    <th className="col-unit">单位</th>
                    <th className="col-price num">单价 ({content.currency})</th>
                    <th className="col-amount num">小计 ({content.currency})</th>
                    {canEdit && <th className="col-ops num">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {content.items.map((item, i) => {
                    const line = total.lines[i] || { amount: 0 };
                    const nameErr = fieldErrors['item-name-' + item.id];
                    const qtyErr = fieldErrors['item-qty-' + item.id];
                    const unitErr = fieldErrors['item-unit-' + item.id];
                    const priceErr = fieldErrors['item-price-' + item.id];
                    return (
                      <tr key={item.id} id={'qfield-item-name-' + item.id}>
                        <td className="col-idx">{String(i + 1).padStart(2, '0')}</td>
                        <td className="col-scope">
                          <input
                            className={'line-name-input' + (nameErr ? ' input-error' : '')}
                            aria-label={`第 ${i + 1} 项报价项目名称`}
                            placeholder="填写对外报价项名称（必填）"
                            value={item.name}
                            onChange={e => updateItem(item.id, { name: e.target.value })}
                          />
                          {nameErr && <small className="field-error">{nameErr}</small>}
                          <textarea
                            className="line-desc-input"
                            aria-label={`第 ${i + 1} 项交付范围说明`}
                            placeholder="交付物、规格边界或服务内容说明"
                            rows={2}
                            value={item.description}
                            onChange={e => updateItem(item.id, { description: e.target.value })}
                          />
                        </td>
                        <td className="col-qty num" id={'qfield-item-qty-' + item.id}>
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            className={'num-input' + (qtyErr ? ' input-error' : '')}
                            aria-label={`第 ${i + 1} 项数量`}
                            value={item.quantity}
                            onChange={e => updateItem(item.id, { quantity: e.target.value })}
                          />
                          {qtyErr && <small className="field-error">{qtyErr}</small>}
                        </td>
                        <td className="col-unit" id={'qfield-item-unit-' + item.id}>
                          <input
                            type="text"
                            className={unitErr ? 'input-error' : ''}
                            aria-label={`第 ${i + 1} 项单位`}
                            placeholder={defaultUnit}
                            value={item.unit}
                            onChange={e => updateItem(item.id, { unit: e.target.value })}
                          />
                          {unitErr && <small className="field-error">{unitErr}</small>}
                        </td>
                        <td className="col-price num" id={'qfield-item-price-' + item.id}>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            className={'num-input' + (priceErr ? ' input-error' : '')}
                            aria-label={`第 ${i + 1} 项单价`}
                            value={item.unitPrice}
                            onChange={e => updateItem(item.id, { unitPrice: e.target.value })}
                          />
                          {priceErr && <small className="field-error">{priceErr}</small>}
                        </td>
                        <td className="col-amount num">
                          <strong>{money(line.amount, content.currency)}</strong>
                        </td>
                        {canEdit && (
                          <td className="col-ops num">
                            <div className="line-ops">
                              <button type="button" className="icon-button small-icon" title="上移" aria-label={`上移第 ${i + 1} 项`} disabled={i === 0} onClick={() => moveItem(i, -1)}>
                                <QuoteIcon name="up" size={14} />
                              </button>
                              <button type="button" className="icon-button small-icon" title="下移" aria-label={`下移第 ${i + 1} 项`} disabled={i === content.items.length - 1} onClick={() => moveItem(i, 1)}>
                                <QuoteIcon name="down" size={14} />
                              </button>
                              <button type="button" className="icon-button small-icon" title="复制行" aria-label={`复制第 ${i + 1} 项`} onClick={() => duplicateItem(i)}>
                                <QuoteIcon name="copy" size={14} />
                              </button>
                              <button
                                type="button"
                                className="icon-button small-icon danger"
                                title="删除行"
                                aria-label={`删除第 ${i + 1} 项`}
                                disabled={content.items.length === 1}
                                onClick={() => change('items', content.items.filter(x => x.id !== item.id))}
                              >
                                <QuoteIcon name="trash" size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-panels">
            <div className="panel content-panel">
              <h2>税费与折扣核算</h2>
              <div className="simple-grid">
                <div id="qfield-taxMode">
                  <Field label="税费口径（提审必填）" required error={fieldErrors.taxMode}>
                    <select
                      value={content.taxMode}
                      onChange={e => {
                        const nextMode = e.target.value;
                        change('taxMode', nextMode);
                        if (!['含税报价', '税费另计'].includes(nextMode)) {
                          setContent(old => ({ ...old, taxMode: nextMode, taxRate: 0 }));
                        }
                      }}
                    >
                      {window.QuoteData.taxModes.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </Field>
                </div>
                <div id="qfield-taxRate">
                  <Field
                    label="适用税率（%）"
                    error={fieldErrors.taxRate}
                    hint={!taxActive ? '未税或待确认口径下不计税额' : undefined}
                  >
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      disabled={!taxActive || !canEdit || busy}
                      value={taxActive ? content.taxRate : 0}
                      onChange={e => change('taxRate', e.target.value)}
                    />
                  </Field>
                </div>
                <div id="qfield-discountPercent">
                  <Field label="整体折扣比例（%）" error={fieldErrors.discountPercent} hint="0 表示无折扣，20 表示八折">
                    <input type="number" min="0" max="100" step="any" value={content.discountPercent} onChange={e => change('discountPercent', e.target.value)} />
                  </Field>
                </div>
              </div>
            </div>

            <div className="panel content-panel quote-totals">
              <div><span>明细小计</span><b>{money(total.subtotal, content.currency)}</b></div>
              <div><span>折扣减免{Number(content.discountPercent) > 0 ? ` (${content.discountPercent}%)` : ''}</span><b>− {money(total.discount, content.currency)}</b></div>
              {content.taxMode === '含税报价' && (
                <div><span>不含税净额</span><b>{money(total.exTax, content.currency)}</b></div>
              )}
              <div>
                <span>
                  税额
                  {content.taxMode === '含税报价'
                    ? `（已含 · ${Number(content.taxRate) || 0}%）`
                    : content.taxMode === '税费另计'
                      ? `（另计 · ${Number(content.taxRate) || 0}%）`
                      : '（未计税）'}
                </span>
                <b>{money(total.tax, content.currency)}</b>
              </div>
              <div className="total">
                <span>对外报价合计</span>
                <strong>{money(total.total, content.currency)}</strong>
              </div>
            </div>
          </div>

          <div className="panel content-panel">
            <h2>交付与商务条款</h2>
            <div className="simple-grid">
              <div className="full" id="qfield-paymentTerms">
                <Field label="付款方式与节点（提审必填）" required wide error={fieldErrors.paymentTerms}>
                  <textarea rows={3} value={content.paymentTerms} onChange={e => change('paymentTerms', e.target.value)} placeholder="例如：合同签订后 5 个工作日内支付 30% 首付款，初验通过支付 40%，终验通过支付 30%。" />
                </Field>
              </div>
              <Field label="交付周期与验收标准" wide>
                <textarea rows={3} value={content.deliveryTerms} onChange={e => change('deliveryTerms', e.target.value)} placeholder="说明交付里程碑、验收方式及质保期" />
              </Field>
              <Field label="范围边界、前提假设与客户配合事项" wide>
                <textarea rows={4} value={content.notes} onChange={e => change('notes', e.target.value)} placeholder="明确不包含项、硬件或网络环境准备责任等" />
              </Field>
            </div>
          </div>
        </fieldset>
      )}

      {pickerKind && (
        <LibraryPickerModal
          kind={pickerKind}
          currency={content.currency}
          defaultUnit={defaultUnit}
          onClose={() => setPickerKind(null)}
          onPick={newItem => {
            change('items', [...content.items, newItem]);
            setPickerKind(null);
          }}
        />
      )}

      {deal !== null && (
        <Confirm
          title="记录项目实际成交"
          confirmText="确认成交并归档"
          busy={busy}
          onClose={() => setDeal(null)}
          onConfirm={() => action(() => transition('won', { dealAmount: Number(deal) }))}
        >
          <Field label={`实际签约成交金额（${content.currency}）`} required>
            <input type="number" min="0.01" step="any" value={deal} onChange={e => setDeal(e.target.value)} />
          </Field>
          <p className="muted" style={{ marginTop: 10 }}>确认后本报价单将锁定归档，实际成交金额将自动沉淀至“价格参考库”供后续同类项目比对。</p>
        </Confirm>
      )}

      {confirmDelete && (
        <Confirm
          danger
          confirmText="确认删除"
          title="删除报价草稿"
          busy={busy}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => action(async () => {
            await api('/quotes/delete', { id: quoteId });
            go('project', q.projectId, { force: true });
          })}
        >
          <p>确认删除当前草稿报价单 <strong>{q.number}</strong>？删除后将返回所属项目页面。</p>
        </Confirm>
      )}

      {historyOpen && (
        <QuoteOverlay
          wide
          title={`历史报价快照 · ${q.number}`}
          subtitle="每次保存修改或变更审核状态均会自动留存不可篡改的版本快照。"
          onClose={() => { setHistoryOpen(false); setHistoryDetail(null); }}
          footer={
            <>
              {canEdit && historyDetail && historyDetail.revision !== q.revision && (
                <button
                  type="button"
                  className="button ghost"
                  style={{ marginRight: 'auto' }}
                  onClick={() => {
                    setContent(historyDetail.content);
                    setDirty(true);
                    setHistoryOpen(false);
                    setView('edit');
                  }}
                >
                  <QuoteIcon name="refresh" size={14} />载入此版本内容到编辑区
                </button>
              )}
              <button type="button" className="button" onClick={() => { setHistoryOpen(false); setHistoryDetail(null); }}>关闭</button>
            </>
          }
        >
          <div className="version-selector-bar">
            {data.versions.map(v => (
              <button
                type="button"
                key={v.id}
                className={'filter-pill' + (historyDetail?.id === v.id ? ' active' : '')}
                onClick={() => loadHistoryVersion(v.id)}
              >
                v{v.revision} · {statuses[v.status] || v.status} · {shortDate(v.createdAt)}
              </button>
            ))}
          </div>
          {historyLoading ? (
            <Loading text="正在加载历史版本…" />
          ) : historyDetail ? (
            <QuotePaper
              content={historyDetail.content}
              totals={calcQuoteTotals(historyDetail.content)}
              number={q.number}
              createdAt={historyDetail.createdAt || historyDetail.created_at}
              draft={!['approved', 'sent', 'won'].includes(historyDetail.status)}
            />
          ) : null}
        </QuoteOverlay>
      )}
    </>
  );
}

function QuotePaper({ content: c, totals, number, draft, createdAt }) {
  const en = c.language === 'English';
  const bi = c.language === '中英双语';
  const t = (zh, english) => en ? english : bi ? zh + ' / ' + english : zh;
  const taxMap = {
    '未税报价': 'Excluding tax',
    '含税报价': 'Tax included',
    '税费另计': 'Tax added separately',
    '待确认': 'To be confirmed'
  };
  const showRate = ['含税报价', '税费另计'].includes(c.taxMode);
  const taxDisplay = t(c.taxMode, taxMap[c.taxMode] || c.taxMode) + (showRate ? ` · ${Number(c.taxRate) || 0}%` : '');
  const formattedTotals = totals.exTax !== undefined ? totals : calcQuoteTotals(c);

  return (
    <article className="quote-paper">
      <div className="paper-head">
        <div>
          <h1>{en ? 'QUOTATION' : bi ? '报价单 / QUOTATION' : '报价单'}</h1>
          <p>{c.title}</p>
        </div>
        {draft && <span className="paper-draft">{t('草稿 · 尚未批准', 'DRAFT — Not approved')}</span>}
      </div>

      <div className="paper-meta">
        {[
          [t('报价编号', 'Quotation No.'), number],
          [t('报价日期', 'Date'), createdAt ? new Date(createdAt).toLocaleDateString('zh-CN') : '—'],
          [t('客户名称', 'Customer'), c.customer || '—'],
          [t('报价方', 'Quoted By'), c.seller || '—'],
          [t('有效期', 'Validity'), c.validity + ' ' + t('天', 'days')],
          [t('税费口径', 'Tax Basis'), taxDisplay]
        ].map(([k, v]) => (
          <div key={k}><span>{k}</span><strong>{v}</strong></div>
        ))}
      </div>

      <div className="table-scroll">
        <table className="paper-table">
          <thead>
            <tr>
              <th>{t('报价项目 / 交付范围', 'Item / Scope')}</th>
              <th className="num">{t('数量', 'Qty')}</th>
              <th className="num">{t('单价', 'Unit Price')}</th>
              <th className="num">{t('金额', 'Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {formattedTotals.lines.map((x, i) => (
              <tr key={x.id || i}>
                <td>
                  <strong>{x.name || '—'}</strong>
                  {x.description && <p>{x.description}</p>}
                </td>
                <td className="num">{x.quantity} {x.unit}</td>
                <td className="num">{money(x.unitPrice, c.currency)}</td>
                <td className="num"><strong>{money(x.amount, c.currency)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="paper-breakdown">
        <div><span>{t('小计', 'Subtotal')}</span><span>{money(formattedTotals.subtotal, c.currency)}</span></div>
        {formattedTotals.discount > 0 && (
          <div><span>{t('折扣', 'Discount')}</span><span>− {money(formattedTotals.discount, c.currency)}</span></div>
        )}
        {c.taxMode === '含税报价' && (
          <div><span>{t('不含税净额', 'Net (Excl. Tax)')}</span><span>{money(formattedTotals.exTax, c.currency)}</span></div>
        )}
        {showRate && (
          <div><span>{t('税额', 'Tax')} ({Number(c.taxRate) || 0}%)</span><span>{money(formattedTotals.tax, c.currency)}</span></div>
        )}
      </div>

      <div className="paper-total">
        <span>{t('报价合计', 'Grand Total')} ({c.currency})</span>
        <strong>{money(formattedTotals.total, c.currency)}</strong>
      </div>

      {[
        [t('付款条款', 'Payment Terms'), c.paymentTerms],
        [t('交付与验收', 'Delivery & Acceptance'), c.deliveryTerms],
        [t('范围与约定', 'Scope & Assumptions'), c.notes]
      ].map(([k, v]) => v && (
        <section key={k}>
          <h3>{k}</h3>
          <p>{v}</p>
        </section>
      ))}

      <footer>{[c.seller, c.sellerContact, c.sellerAddress].filter(Boolean).join(' · ') || t('报价方信息待补充', 'Seller details pending')}</footer>
    </article>
  );
}

Object.assign(window, { QuotePage, QuotePaper });
