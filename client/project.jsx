const {
  uid, qs, api, go, money, date, shortDate, statuses, evidenceNames,
  thinkingLevelLabels, coerceThinkingLevel, useAiModels, AiRunParamsBar,
  canWriteBusiness, calcEstimatePreview, formatSourceSummary,
  Status, ErrorBox, NoticeBox, ReadOnlyBanner, Empty, Loading, Field, Confirm, PageTitle
} = window.PriceUI;

function FxRatePrompt({ currency, busy, onClose, onConfirm }) {
  const [rate, setRate] = React.useState('');
  const [err, setErr] = React.useState('');
  const submit = () => {
    const n = Number(rate);
    if (!(Number.isFinite(n) && n > 0 && n <= 1e6)) {
      setErr('请输入大于 0 的有效汇率数值');
      return;
    }
    onConfirm(n);
  };
  return (
    <QuoteOverlay
      compact
      title="确认外币折算汇率"
      subtitle={`本次项目报价币种为 ${currency}，请确认折算汇率后生成报价草稿。`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="button primary" disabled={busy} onClick={submit}>
            {busy ? '正在生成…' : '确认并生成报价'}
          </button>
        </>
      }
    >
      <ErrorBox error={err} />
      <Field label={`1 人民币 (CNY) 折合 ${currency}`} required hint="内部成本按 CNY 核算，生成报价单时按此汇率折算对外单价。">
        <input
          type="number"
          min="0.000001"
          step="any"
          autoFocus
          placeholder={`例如：${currency === 'USD' ? '0.14' : currency === 'HKD' ? '1.08' : currency === 'JPY' ? '21.5' : '0.13'}`}
          value={rate}
          onChange={e => { setRate(e.target.value); setErr(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
      </Field>
    </QuoteOverlay>
  );
}

function ProjectEditor({ projectId, user, session }) {
  const modelsStore = useAiModels();
  const [record, setRecord] = React.useState(null);
  const [files, setFiles] = React.useState([]);
  const [assets, setAssets] = React.useState([]);
  const [defaults, setDefaults] = React.useState(null);
  const [aiReady, setAiReady] = React.useState(session?.aiConfigured ?? true);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fxPromptProject, setFxPromptProject] = React.useState(null);
  const [fxBusy, setFxBusy] = React.useState(false);

  React.useEffect(() => {
    Promise.all([
      projectId ? api('/projects/get' + qs({ id: projectId })) : Promise.resolve(null),
      api('/assets/list'),
      api('/settings/get').catch(() => null)
    ])
      .then(([p, a, s]) => {
        setRecord(p?.project || null);
        setFiles(p?.files || []);
        setAssets(a?.assets || []);
        if (s?.settings) setDefaults(s.settings);
        if (s?.ai !== undefined) setAiReady(!!s.ai.configured);
        setReady(true);
      })
      .catch(e => setError(e.message));
  }, [projectId]);

  const save = async (input, selected) => {
    const r = await api('/projects/save', { id: record?.id, revision: record?.revision, input });
    setRecord(r.project);
    if (!record?.id) history.replaceState(null, '', '#input' + qs({ id: r.project.id }));
    if (selected.length) {
      try {
        const form = new FormData();
        form.append('projectId', r.project.id);
        form.append('revision', String(r.project.revision));
        selected.forEach(f => form.append('files', f));
        const f = await api('/files/upload', form);
        setFiles(f.files);
        setRecord(f.project);
        return f.project;
      } catch (uploadErr) {
        const wrapped = new Error('需求主体已保存，但附件上传未完成：' + uploadErr.message);
        wrapped.projectSaved = true;
        throw wrapped;
      }
    }
    return r.project;
  };

  const createManualQuote = async (proj, fxRate) => {
    const r = await api('/quotes/create', { projectId: proj.id, ...(fxRate ? { fxRate } : {}) });
    go('quote', r.quote.id, { force: true });
  };

  if (error) {
    return (
      <main className="app-main">
        <ErrorBox error={error} />
        <button type="button" className="button" onClick={() => go('projects', null, { force: true })}>返回项目列表</button>
      </main>
    );
  }
  if (!ready) return <main className="app-main"><Loading /></main>;

  const canWrite = canWriteBusiness(user);

  return (
    <>
      <QuoteApp
        embedded
        project={record}
        defaults={defaults}
        attachments={files}
        assets={assets}
        aiConfigured={aiReady || modelsStore.configured}
        aiModelsStore={modelsStore}
        readOnly={!canWrite}
        onBack={() => go(record ? 'project' : 'projects', record?.id)}
        onSave={save}
        onRemoveAttachment={async id => {
          const r = await api('/files/delete', { id, revision: record.revision });
          setFiles(r.files);
          setRecord(r.project);
        }}
        onAnalyze={async (input, selected, aiOpts) => {
          const p = await save(input, selected);
          try {
            await api('/analysis/start', { projectId: p.id, ...(aiOpts || {}) });
          } catch (startErr) {
            go('project', p.id, { force: true });
            return;
          }
          go('project', p.id, { force: true });
        }}
        onDirectQuote={canWrite ? async (input, selected) => {
          const p = await save(input, selected);
          if (p.input.currency !== 'CNY') {
            setFxPromptProject(p);
            return;
          }
          await createManualQuote(p);
        } : undefined}
      />
      {fxPromptProject && (
        <FxRatePrompt
          currency={fxPromptProject.input.currency}
          busy={fxBusy}
          onClose={() => go('project', fxPromptProject.id, { force: true })}
          onConfirm={async rate => {
            setFxBusy(true);
            try {
              await createManualQuote(fxPromptProject, rate);
            } catch (e) {
              setFxBusy(false);
              go('project', fxPromptProject.id, { force: true });
            }
          }}
        />
      )}
    </>
  );
}

function OnboardingCard({ session, user, hasProjects, onDismiss }) {
  const companyReady = !!String(session?.companyName || '').trim();
  const aiReady = !!session?.aiConfigured;
  if (hasProjects && companyReady) return null;

  return (
    <div className="panel onboarding-panel">
      <div className="onboarding-head">
        <div>
          <h2>工作台初始化向导</h2>
          <p>完成以下基础配置后，即可顺畅执行需求评估、报价审核与正式单据导出。</p>
        </div>
        {hasProjects && (
          <button type="button" className="text-button" onClick={onDismiss}>收起引导</button>
        )}
      </div>
      <div className="onboarding-steps">
        <div className={'onboarding-step' + (companyReady ? ' is-done' : '')}>
          <div className="step-head">
            <span className="step-status"><QuoteIcon name={companyReady ? 'check' : 'building'} size={15} /></span>
            <strong>配置报价主体与默认毛利</strong>
            <span className={'status-badge ' + (companyReady ? 'status-ready' : 'status-warn')}>{companyReady ? '已配置' : '待完善'}</span>
          </div>
          <p>{companyReady ? `当前默认报价方：${session.companyName}` : '填写公司名称、联系方式与角色人日成本，避免报价单提交审核时缺少报价方信息。'}</p>
          {user?.role === 'admin' && (
            <button type="button" className="text-button" onClick={() => go('settings')}>
              前往系统设置<QuoteIcon name="arrow" size={13} />
            </button>
          )}
        </div>

        <div className={'onboarding-step' + (aiReady ? ' is-done' : '')}>
          <div className="step-head">
            <span className="step-status"><QuoteIcon name={aiReady ? 'check' : 'nodes'} size={15} /></span>
            <strong>连接模型推理服务（可选）</strong>
            <span className={'status-badge ' + (aiReady ? 'status-ready' : 'status-warn')}>{aiReady ? '已就绪' : '可选配置'}</span>
          </div>
          <p>{aiReady ? '已连接模型服务，支持自动拆解工作量、风险识别与市场询价。' : '未配置模型密钥时，仍可直接手动创建报价单、管理历史价格库并导出 PDF / Excel。'}</p>
          <button type="button" className="text-button" onClick={() => go('settings')}>
            查看服务状态<QuoteIcon name="arrow" size={13} />
          </button>
        </div>

        <div className="onboarding-step">
          <div className="step-head">
            <span className="step-status"><QuoteIcon name="layers" size={15} /></span>
            <strong>沉淀产品成果与开始报价</strong>
          </div>
          <p>录入现有 SDK、系统模块或历史成交记录，在需求拆解与报价单编辑中直接引用。</p>
          <div className="step-links">
            <button type="button" className="text-button" onClick={() => go('assets')}>维护产品库</button>
            {canWriteBusiness(user) && (
              <button type="button" className="text-button" onClick={() => go('input')}>新建首份报价<QuoteIcon name="arrow" size={13} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectsPage({ user, session }) {
  const [search, setSearch] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [hideGuide, setHideGuide] = React.useState(false);
  const [deleting, setDeleting] = React.useState(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);

  const serverStatus = filter === 'review_quote'
    ? 'review'
    : ['draft', 'analyzing', 'ready', 'quoted', 'won', 'lost'].includes(filter) ? filter : '';
  const listUrl = '/projects/list' + qs({ q: debouncedQ, status: serverStatus });
  const { data, error, loading, reload, setError } = window.PriceUI.useLoad(listUrl);

  const canWrite = canWriteBusiness(user);
  const canDeleteProject = p => canWrite && (p.ownerId === user.id || ['admin', 'reviewer'].includes(user.role));

  const quotesByProject = React.useMemo(() => {
    const map = new Map();
    for (const q of (data?.quotes || [])) {
      if (!map.has(q.projectId)) map.set(q.projectId, []);
      map.get(q.projectId).push(q);
    }
    return map;
  }, [data?.quotes]);

  const filtered = React.useMemo(() => {
    if (!data?.projects) return [];
    let rows = data.projects;
    if (search.trim() && search.trim() !== debouncedQ) {
      const kw = search.trim().toLowerCase();
      rows = rows.filter(p => (p.input.projectName + ' ' + p.input.customerName + ' ' + p.number).toLowerCase().includes(kw));
    }
    if (filter === 'review_quote') {
      rows = rows.filter(p => (quotesByProject.get(p.id) || []).some(q => q.status === 'review'));
    } else if (serverStatus && serverStatus !== 'review') {
      rows = rows.filter(p => p.status === serverStatus);
    }
    return rows;
  }, [data?.projects, quotesByProject, filter, serverStatus, search, debouncedQ]);

  const stats = data ? {
    total: data.stats?.total ?? data.projects.length,
    analyzing: data.stats?.analyzing ?? data.projects.filter(p => p.status === 'analyzing').length,
    reviewQuotes: data.stats?.reviewQuotes ?? data.quotes.filter(q => q.status === 'review').length,
    won: data.stats?.won ?? data.projects.filter(p => p.status === 'won').length
  } : { total: 0, analyzing: 0, reviewQuotes: 0, won: 0 };

  const statCards = [
    ['all', '报价项目', stats.total],
    ['analyzing', '分析中', stats.analyzing],
    ['review_quote', '待审核报价', stats.reviewQuotes],
    ['won', '已成交项目', stats.won]
  ];

  const filterTabs = [
    ['all', '全部'],
    ['draft', '草稿'],
    ['analyzing', '分析中'],
    ['ready', '已分析'],
    ['quoted', '已报价'],
    ['review_quote', '待审核'],
    ['won', '已成交']
  ];

  return (
    <>
      <PageTitle title="项目报价" description="集中管理客户需求拆解、内部成本测算与对外报价版本。">
        {canWrite && (
          <button type="button" className="button primary" onClick={() => go('input')}>
            <QuoteIcon name="plus" size={16} />新建报价项目
          </button>
        )}
      </PageTitle>

      <ReadOnlyBanner user={user} />

      {!hideGuide && data && (
        <OnboardingCard
          session={session}
          user={user}
          hasProjects={stats.total > 0}
          onDismiss={() => setHideGuide(true)}
        />
      )}

      <div className="stats-grid" role="group" aria-label="项目统计与快捷筛选">
        {statCards.map(([key, label, val]) => (
          <button
            type="button"
            className={'stat stat-button' + (filter === key ? ' active' : '')}
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(old => old === key && key !== 'all' ? 'all' : key)}
          >
            <span>{label}</span>
            <strong>{data ? val : '—'}</strong>
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel-toolbar wrap-toolbar">
          <div className="filter-pills" role="tablist" aria-label="按状态筛选项目">
            {filterTabs.map(([id, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === id}
                key={id}
                className={'filter-pill' + (filter === id ? ' active' : '')}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="search-wrap">
            <QuoteIcon name="search" size={15} />
            <input
              className="search-input"
              placeholder="搜索项目名称、客户或编号…"
              aria-label="搜索项目"
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

        <ErrorBox error={error} />

        {!data && loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            icon="file"
            title={search || filter !== 'all' ? '没有匹配当前筛选条件的项目' : '创建首个报价项目'}
            description={
              search || filter !== 'all'
                ? '可清空关键词或切换筛选状态查看全部项目。'
                : '支持算法授权、软件定制开发、模型训练与技术方案组合测算，也可直接创建正式报价单。'
            }
            action={
              search || filter !== 'all' ? (
                <button type="button" className="button" onClick={() => { setSearch(''); setFilter('all'); }}>重置筛选条件</button>
              ) : canWrite ? (
                <button type="button" className="button primary" onClick={() => go('input')}>
                  <QuoteIcon name="plus" size={15} />新建报价项目
                </button>
              ) : null
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>项目 / 客户</th>
                  <th>报价业务</th>
                  <th>状态</th>
                  <th className="num">最新报价</th>
                  <th>负责人</th>
                  <th>更新时间</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const pQuotes = quotesByProject.get(p.id) || [];
                  const latestQuote = pQuotes[0];
                  const latestTotal = latestQuote ? (latestQuote.total ?? latestQuote.totals?.total ?? 0) : null;
                  return (
                    <tr key={p.id}>
                      <td>
                        <button type="button" className="table-link" onClick={() => go('project', p.id)}>
                          {p.input.projectName || '未命名项目'}
                        </button>
                        <small>{p.input.customerName || '客户待确认'} · {p.number}</small>
                      </td>
                      <td>
                        <div className="tags">
                          {window.QuoteData.allTypes(p.input).filter(t => p.input.types.includes(t.id)).map(t => (
                            <span key={t.id}>{t.name}</span>
                          ))}
                        </div>
                      </td>
                      <td><Status value={p.status} /></td>
                      <td className="num">
                        {latestQuote ? (
                          <button type="button" className="quote-amount-link" onClick={() => go('quote', latestQuote.id)}>
                            <strong>{money(latestTotal, latestQuote.currency)}</strong>
                            <small>{statuses[latestQuote.status] || latestQuote.status}</small>
                          </button>
                        ) : (
                          <span className="muted">尚未生成</span>
                        )}
                      </td>
                      <td>{p.ownerName || '—'}</td>
                      <td>{shortDate(p.updatedAt)}</td>
                      <td className="num">
                        <div className="row-actions">
                          <button type="button" className="text-button" onClick={() => go('project', p.id)}>
                            打开<QuoteIcon name="arrow" size={13} />
                          </button>
                          {canDeleteProject(p) && (
                            <button
                              type="button"
                              className="icon-button danger"
                              aria-label={'删除项目 ' + (p.input.projectName || p.number)}
                              title="删除项目"
                              onClick={() => setDeleting(p)}
                            >
                              <QuoteIcon name="trash" size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleting && (
        <Confirm
          danger
          confirmText="确认删除"
          title="删除报价项目"
          busy={deleteBusy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setDeleteBusy(true);
            try {
              await api('/projects/delete', { id: deleting.id });
              setDeleting(null);
              await reload();
            } catch (e) {
              setError(e.message);
              setDeleting(null);
            } finally {
              setDeleteBusy(false);
            }
          }}
        >
          <p>确认删除项目 <strong>{deleting.input.projectName || deleting.number}</strong>（{deleting.number}）？</p>
          <p className="muted" style={{ marginTop: 8 }}>该项目关联的分析记录、草稿报价单及上传附件将一并清理，操作不可撤销。</p>
        </Confirm>
      )}
    </>
  );
}

function ProjectPage({ projectId, user, session }) {
  const { data, error, reload, setData, setError } = window.PriceUI.useLoad('/projects/get' + qs({ id: projectId }));
  const modelsStore = useAiModels();
  const [aiParams, setAiParams] = React.useState(null);
  const [tab, setTab] = React.useState('analysis');
  const [runId, setRunId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [canceling, setCanceling] = React.useState(false);
  const [fx, setFx] = React.useState('');
  const [fxModalMode, setFxModalMode] = React.useState(null);
  const [adjust, setAdjust] = React.useState(false);
  const [deletingQuote, setDeletingQuote] = React.useState(null);
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const fileInputRef = React.useRef(null);

  React.useEffect(() => {
    if (modelsStore.loaded && !aiParams) {
      setAiParams({
        model: modelsStore.defaults.model || session?.model || '',
        thinkingLevel: coerceThinkingLevel(modelsStore.defaults.model, modelsStore.defaults.thinkingLevel, modelsStore.models),
        enableSearch: modelsStore.defaults.enableSearch ?? true,
        enableUrlContext: modelsStore.defaults.enableUrlContext ?? true
      });
    }
  }, [modelsStore.loaded, modelsStore.defaults, modelsStore.models, aiParams, session?.model]);

  const run = data?.runs.find(r => r.id === (runId || data.project.currentRunId)) || data?.runs[0];

  React.useEffect(() => {
    if (!run || !['running', 'queued'].includes(run.status)) return;
    const handle = setInterval(() => {
      api('/analysis/get' + qs({ id: run.id }))
        .then(({ run: r }) => {
          setData(old => old ? ({ ...old, runs: old.runs.map(x => x.id === r.id ? r : x) }) : old);
          if (!['running', 'queued'].includes(r.status)) reload();
        })
        .catch(e => setError(e.message));
    }, 2000);
    return () => clearInterval(handle);
  }, [run?.id, run?.status]);

  if (!data) return <><ErrorBox error={error} /><Loading /></>;

  const p = data.project;
  const canWrite = canWriteBusiness(user);
  const aiReady = !!(session?.aiConfigured || modelsStore.configured);
  const running = run && ['running', 'queued'].includes(run.status);
  const stale = run && run.projectRevision !== p.revision;
  const activeAiParams = aiParams || modelsStore.defaults;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const model = String(activeAiParams?.model || '').trim();
      const thinkingLevel = coerceThinkingLevel(model, activeAiParams?.thinkingLevel, modelsStore.models);
      await api('/analysis/start', {
        projectId,
        ...(model ? { model } : {}),
        thinkingLevel,
        enableSearch: activeAiParams?.enableSearch !== false,
        enableUrlContext: activeAiParams?.enableUrlContext !== false
      });
      setRunId('');
      setTab('analysis');
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const executeCreateQuote = async ({ mode, fxRate }) => {
    setBusy(true);
    setError('');
    try {
      const payload = mode === 'run'
        ? { runId: run.id, ...(fxRate ? { fxRate: Number(fxRate) } : {}) }
        : { projectId: p.id, ...(fxRate ? { fxRate: Number(fxRate) } : {}) };
      const r = await api('/quotes/create', payload);
      setFxModalMode(null);
      go('quote', r.quote.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const triggerCreateFromRun = () => {
    if (p.input.currency !== 'CNY' && !run?.result?.fx?.rate && !(Number(fx) > 0)) {
      setFxModalMode('run');
      return;
    }
    executeCreateQuote({ mode: 'run', fxRate: fx ? Number(fx) : undefined });
  };

  const triggerCreateManual = () => {
    if (p.input.currency !== 'CNY') {
      setFxModalMode('manual');
      return;
    }
    executeCreateQuote({ mode: 'manual' });
  };

  const uploadAttachments = async fileList => {
    const chosen = Array.from(fileList || []);
    if (!chosen.length) return;
    const valid = chosen.filter(f => /\.(pdf|docx|xlsx|csv|txt|md|png|jpe?g|webp)$/i.test(f.name) && f.size <= 20 * 1024 * 1024);
    if (!valid.length) {
      setError('请选择支持的文件格式（PDF/DOCX/XLSX/CSV/TXT/MD/常见图片），且单文件不超过 20 MB');
      return;
    }
    setUploadingFile(true);
    setError('');
    try {
      const form = new FormData();
      form.append('projectId', p.id);
      form.append('revision', String(p.revision));
      valid.forEach(f => form.append('files', f));
      await api('/files/upload', form);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const parseStatusBadge = st => {
    if (st === 'ready') return <span className="status-badge status-ready">已提取文本</span>;
    if (st === 'image') return <span className="status-badge">图片资料</span>;
    if (st === 'failed') return <span className="status-badge status-failed">解析失败</span>;
    return <span className="status-badge status-warn">未提取文本</span>;
  };

  return (
    <>
      <div className="app-breadcrumb">
        <button type="button" onClick={() => go('projects')}>项目报价</button>
        <span>/</span>
        <span>{p.number}</span>
      </div>

      <PageTitle
        title={p.input.projectName || '未命名项目'}
        badge={<Status value={p.status} />}
        description={`${p.input.customerName || '客户待确认'} · 需求版本 v${p.revision} · 报价币种 ${p.input.currency}`}
      >
        {canWrite && <button type="button" className="button" onClick={() => go('input', projectId)}>编辑需求</button>}
        {canWrite && run?.status === 'completed' && (
          <button type="button" className="button" onClick={() => setAdjust(true)}>调整测算</button>
        )}
        {canWrite && (!run || run.status !== 'completed' || stale) && (
          <button type="button" className={aiReady ? 'button' : 'button primary'} disabled={busy} onClick={triggerCreateManual}>
            手动创建报价
          </button>
        )}
        {canWrite && (
          <button type="button" className={run?.status === 'completed' && !stale ? 'button' : (aiReady ? 'button primary' : 'button')} disabled={busy || running} onClick={start}>
            {running ? '分析中…' : run ? '重新分析' : '开始 AI 分析'}
          </button>
        )}
        {canWrite && run?.status === 'completed' && !stale && (
          <button type="button" className="button primary" disabled={busy} onClick={triggerCreateFromRun}>
            生成报价草稿<QuoteIcon name="arrow" size={15} />
          </button>
        )}
      </PageTitle>

      <ReadOnlyBanner user={user} />
      <ErrorBox error={error} />

      <div className="app-tabs" role="tablist">
        {[
          ['analysis', '分析与测算', null],
          ['input', '需求摘要', null],
          ['quotes', '报价记录', data.quotes.length],
          ['files', '资料附件', data.files.length]
        ].map(([id, label, count]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
            {count !== null && <span>{count}</span>}
          </button>
        ))}
      </div>

      {tab === 'analysis' && (
        <>
          {!aiReady && !running && (
            <NoticeBox
              action={
                <div className="inline-actions">
                  {user.role === 'admin' && <button type="button" className="button small" onClick={() => go('settings')}>检查服务设置</button>}
                  {canWrite && <button type="button" className="button small primary" disabled={busy} onClick={triggerCreateManual}>直接手动创建报价</button>}
                </div>
              }
            >
              <strong>当前尚未配置模型推理服务</strong>
              <p>管理员可在服务端配置兼容 OpenAI 接口的模型参数并在“系统设置”验证连接；无需 AI 拆解时，可直接点击右侧“直接手动创建报价”编写正式报价单。</p>
            </NoticeBox>
          )}

          {canWrite && !running && (
            <div className="panel ai-run-panel">
              <AiRunParamsBar
                value={activeAiParams}
                onChange={setAiParams}
                modelsStore={modelsStore}
                disabled={busy}
                action={
                  <button type="button" className="button primary" disabled={busy} onClick={start}>
                    {run ? '按所选参数重新分析' : '开始 AI 分析'}
                  </button>
                }
              />
            </div>
          )}

          {data.runs.length > 1 && (
            <div className="run-picker">
              <span>历史分析批次</span>
              <select aria-label="选择分析记录" value={run?.id || ''} onChange={e => setRunId(e.target.value)}>
                {data.runs.map(r => (
                  <option key={r.id} value={r.id}>
                    {shortDate(r.createdAt)} · 需求 v{r.projectRevision} · {statuses[r.status] || r.status}
                  </option>
                ))}
              </select>
            </div>
          )}

          {stale && (
            <NoticeBox
              action={canWrite && <button type="button" className="button small primary" disabled={busy || running} onClick={start}>按最新需求重新分析</button>}
            >
              <strong>需求版本已更新（当前 v{p.revision}，本分析基于 v{run.projectRevision}）</strong>
              <p>基于本分析生成报价前建议重新运行 AI 分析，或点击上方“手动创建报价”直接基于最新需求建单。</p>
            </NoticeBox>
          )}

          {!run ? (
            <div className="panel">
              <Empty
                icon="compass"
                title="项目需求已就绪"
                description={aiReady ? '发起 AI 分析将结合现有产品库、历史价格参考库、上传文档与公开资料测算新增成本。' : '可直接基于当前需求创建报价草稿，手工维护报价明细并导出 PDF / Excel。'}
                action={
                  canWrite && (
                    <div className="inline-actions">
                      {aiReady && <button type="button" className="button primary" onClick={start} disabled={busy}>开始 AI 分析</button>}
                      <button type="button" className={aiReady ? 'button' : 'button primary'} onClick={triggerCreateManual} disabled={busy}>
                        手动创建报价草稿
                      </button>
                    </div>
                  )
                }
              />
            </div>
          ) : running ? (
            <div className="panel analysis-progress">
              <div className="analysis-progress-head">
                <h2>{run.stage}</h2>
                <strong>{run.progress}%</strong>
              </div>
              <div className="progress-track"><div style={{ width: run.progress + '%' }} /></div>
              <p>正在结合需求范围、复用资产与参考资料拆解交付工作量并核算建议价格。</p>
              {canWrite && (
                <button
                  type="button"
                  className="button"
                  disabled={canceling}
                  onClick={async () => {
                    setCanceling(true);
                    try {
                      await api('/analysis/cancel', { id: run.id });
                      await reload();
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setCanceling(false);
                    }
                  }}
                >
                  {canceling ? '正在取消…' : '取消分析'}
                </button>
              )}
            </div>
          ) : run.status === 'completed' ? (
            <>
              <AnalysisResult run={run} />
              <div className="generate-bar">
                <div>
                  <strong>核对成本与范围后，生成对外报价草稿</strong>
                  <p>生成后可在报价编辑表中调整项目排序、数量、单价、税率折扣及商务条款。</p>
                </div>
                <div className="generate-actions">
                  {p.input.currency !== 'CNY' && !run.result.fx?.rate && (
                    <label className="fx-input">
                      <span>1 CNY =</span>
                      <input
                        type="number"
                        aria-label="报价参考汇率"
                        min="0"
                        step="any"
                        placeholder="填写汇率"
                        value={fx}
                        onChange={e => setFx(e.target.value)}
                      />
                      <span>{p.input.currency}</span>
                    </label>
                  )}
                  <button type="button" className="button primary" disabled={busy || stale || !canWrite} onClick={triggerCreateFromRun}>
                    生成报价草稿<QuoteIcon name="arrow" size={15} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="panel">
              <Empty
                icon="alert"
                title={run.status === 'canceled' ? '分析任务已取消' : '本次分析未能完成'}
                description={run.error || '可检查模型服务连接后重新分析，或直接手动创建报价草稿。'}
                action={
                  canWrite && (
                    <div className="inline-actions">
                      <button type="button" className="button" disabled={busy} onClick={start}>重新分析</button>
                      <button type="button" className="button primary" disabled={busy} onClick={triggerCreateManual}>手动创建报价草稿</button>
                    </div>
                  )
                }
              />
            </div>
          )}
        </>
      )}

      {tab === 'input' && (
        <div className="panel content-panel">
          <div className="panel-toolbar inline">
            <h2>项目需求概览</h2>
            {canWrite && <button type="button" className="text-button" onClick={() => go('input', projectId)}><QuoteIcon name="edit" size={14} />编辑需求</button>}
          </div>
          <p className="prose">{p.input.projectBrief || '尚未填写'}</p>
          <div className="summary-grid">
            {[
              ['报价币种', p.input.currency],
              ['报价单语言', p.input.language],
              ['税费口径', p.input.taxMode + (['含税报价', '税费另计'].includes(p.input.taxMode) && p.input.taxRate ? ` (${p.input.taxRate}%)` : '')],
              ['客户预算', p.input.budgetStatus],
              ['期望交付', p.input.deliveryDate || '待确认'],
              ['部署方式', p.input.deployment || '待确认'],
              ['合作阶段', p.input.customerRelation || '首次合作'],
              ['有效期', (p.input.validity || 30) + ' 天']
            ].map(([k, v]) => (
              <div key={k}><span>{k}</span><strong>{v}</strong></div>
            ))}
          </div>
          {window.QuoteData.allTypes(p.input).filter(t => p.input.types.includes(t.id)).map(t => (
            <div className="input-business-summary" key={t.id}>
              <h3>{t.name}</h3>
              <p>
                {t.custom
                  ? t.description
                  : p.input[{ license: 'licenseProduct', software: 'softwareModules', model: 'modelTarget', solution: 'solutionProblem' }[t.id]] || '详细范围待补充'}
              </p>
              <dl>
                {window.QuoteData.readinessFields(t.id).map(f => (
                  <React.Fragment key={f.id}>
                    <dt>{f.label}</dt>
                    <dd>{p.input[f.id] !== undefined && p.input[f.id] !== '' ? p.input[f.id] + (f.suffix || '') : '待确认'}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {tab === 'quotes' && (
        <div className="panel">
          <div className="panel-toolbar">
            <h2>对外报价单记录</h2>
            {canWrite && (
              <div className="inline-actions">
                {run?.status === 'completed' && !stale && (
                  <button type="button" className="button small primary" disabled={busy} onClick={triggerCreateFromRun}>
                    基于 AI 测算新建报价
                  </button>
                )}
                <button type="button" className="button small" disabled={busy} onClick={triggerCreateManual}>
                  <QuoteIcon name="plus" size={14} />手动创建空白报价
                </button>
              </div>
            )}
          </div>
          {!data.quotes.length ? (
            <Empty
              icon="file"
              title="尚未生成报价单"
              description="可通过 AI 分析测算自动生成报价明细，或直接手动创建空白报价草稿。"
              action={canWrite && <button type="button" className="button primary" disabled={busy} onClick={triggerCreateManual}>手动创建报价草稿</button>}
            />
          ) : (
            <div className="table-scroll">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>报价编号</th>
                    <th>版本</th>
                    <th>状态</th>
                    <th>税费口径</th>
                    <th className="num">报价合计</th>
                    <th>更新时间</th>
                    <th className="num">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quotes.map(q => (
                    <tr key={q.id}>
                      <td>
                        <button type="button" className="table-link" onClick={() => go('quote', q.id)}>{q.number}</button>
                      </td>
                      <td>v{q.revision}</td>
                      <td><Status value={q.status} /></td>
                      <td>{q.content?.taxMode || '—'}</td>
                      <td className="num"><strong>{money(q.totals.total, q.currency)}</strong></td>
                      <td>{shortDate(q.updatedAt)}</td>
                      <td className="num">
                        <div className="row-actions">
                          <button type="button" className="text-button" onClick={() => go('quote', q.id)}>
                            打开报价<QuoteIcon name="arrow" size={13} />
                          </button>
                          {canWrite && q.status === 'draft' && (
                            <button
                              type="button"
                              className="icon-button danger"
                              title="删除草稿"
                              aria-label={'删除报价草稿 ' + q.number}
                              onClick={() => setDeletingQuote(q)}
                            >
                              <QuoteIcon name="trash" size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'files' && (
        <div className="panel content-panel">
          <div className="panel-toolbar inline">
            <div>
              <h2>项目需求附件</h2>
              <p className="muted" style={{ marginTop: 4 }}>上传的文档将自动提取文本用于 AI 需求拆解（单个文件不超过 20 MB，最多 10 个）。</p>
            </div>
            {canWrite && data.files.length < 10 && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden-file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp"
                  onChange={e => uploadAttachments(e.target.files)}
                />
                <button type="button" className="button" disabled={uploadingFile} onClick={() => fileInputRef.current?.click()}>
                  <QuoteIcon name="upload" size={15} />{uploadingFile ? '正在上传解析…' : '上传附件'}
                </button>
              </>
            )}
          </div>
          {data.files.length ? (
            <div className="attachments-list">
              {data.files.map(f => (
                <div className="attachment-row" key={f.id}>
                  <QuoteIcon name={f.parseStatus === 'failed' ? 'alert' : 'file'} size={17} />
                  <a href={window.appPath('/api/files/download' + qs({ id: f.id }))} target="_blank" rel="noopener noreferrer">{f.name}</a>
                  <span className="num">{Math.ceil(f.size / 1024)} KB</span>
                  {parseStatusBadge(f.parseStatus)}
                  {canWrite && (
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={'删除附件 ' + f.name}
                      title="删除附件"
                      onClick={async () => {
                        try {
                          await api('/files/delete', { id: f.id, revision: p.revision });
                          await reload();
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      <QuoteIcon name="trash" size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon="paperclip"
              title="暂无项目附件"
              description="可上传 PRD、招标文件、Excel 功能清单或参考架构图。"
              action={canWrite && <button type="button" className="button" disabled={uploadingFile} onClick={() => fileInputRef.current?.click()}><QuoteIcon name="upload" size={15} />选择文件上传</button>}
            />
          )}
        </div>
      )}

      {adjust && (
        <CostAdjuster
          run={run}
          projectTypes={p.input.types}
          onClose={() => setAdjust(false)}
          onSaved={async () => { setAdjust(false); await reload(); }}
        />
      )}

      {fxModalMode && (
        <FxRatePrompt
          currency={p.input.currency}
          busy={busy}
          onClose={() => setFxModalMode(null)}
          onConfirm={rate => executeCreateQuote({ mode: fxModalMode, fxRate: rate })}
        />
      )}

      {deletingQuote && (
        <Confirm
          danger
          confirmText="删除草稿"
          title="删除报价草稿"
          busy={busy}
          onClose={() => setDeletingQuote(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api('/quotes/delete', { id: deletingQuote.id });
              setDeletingQuote(null);
              await reload();
            } catch (e) {
              setError(e.message);
              setDeletingQuote(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>确认删除草稿报价单 <strong>{deletingQuote.number}</strong>？已批准或已发送的正式版本不受影响。</p>
        </Confirm>
      )}
    </>
  );
}

function AnalysisResult({ run }) {
  const r = run.result;
  const research = run.research || { sources: [], warnings: [] };
  const sourceLinks = ids => (
    <span className="source-links">
      {(ids || []).map(id => {
        const s = research.sources.find(x => x.id === id);
        if (!s) return null;
        return s.url
          ? <a key={id} href={s.url} target="_blank" rel="noopener noreferrer">[{id}]</a>
          : <span key={id}>[内部参考]</span>;
      })}
    </span>
  );

  const hasSuggestedRange = r.totals.suggestedLowCNY !== undefined && r.totals.suggestedHighCNY !== undefined;
  const aiMeta = r.aiMeta || run.aiMeta || run.usage || {};
  const runModel = aiMeta.model || run.model || '';
  const runThinking = aiMeta.thinkingLevel || '';
  const runSearch = aiMeta.enableSearch;
  const runUrlCtx = aiMeta.enableUrlContext;
  const searchQueries = Array.isArray(aiMeta.webSearchQueries) && aiMeta.webSearchQueries.length
    ? aiMeta.webSearchQueries
    : Array.isArray(research.webSearchQueries) ? research.webSearchQueries : [];

  return (
    <>
      <div className="estimate-grid">
        <div className="estimate-card">
          <span>新增成本 · 基准估算</span>
          <strong>{money(r.totals.costBase)}</strong>
          <small>成本区间 {money(r.totals.costLow)} – {money(r.totals.costHigh)}</small>
        </div>
        <div className="estimate-card">
          <span>算法与产品授权售价</span>
          <strong>{money(r.totals.licenseTotal)}</strong>
          <small>与定制交付成本独立核算</small>
        </div>
        <div className="estimate-card accented">
          <span>建议对外报价 · 未税</span>
          <strong>{money(r.totals.suggestedCNY)}</strong>
          <small>
            风险预留 {money(r.totals.riskReserve)} · 目标毛利 {r.totals.margin}%
            {hasSuggestedRange ? ` · 建议区间 ${money(r.totals.suggestedLowCNY)} – ${money(r.totals.suggestedHighCNY)}` : ''}
          </small>
        </div>
      </div>

      <div className="panel content-panel">
        <div className="panel-toolbar inline wrap-toolbar">
          <h2>评估结论</h2>
          {(runModel || runThinking || runSearch !== undefined) && (
            <div className="analysis-meta-bar">
              {runModel && <span className="quiet-badge">模型：{runModel}</span>}
              {runThinking && <span className="quiet-badge">思考强度：{thinkingLevelLabels[runThinking] || runThinking}</span>}
              {runSearch !== undefined && <span className="quiet-badge">实时联网：{runSearch ? '已开启' : '关闭'}</span>}
              {runUrlCtx !== undefined && <span className="quiet-badge">链接读取：{runUrlCtx ? '已开启' : '关闭'}</span>}
            </div>
          )}
        </div>
        {r.adjustedAt && (
          <p className="calculation-note highlight-note">
            {r.adjustedBy} 于 {shortDate(r.adjustedAt)} 人工校准了测算明细
            {r.originalEstimate?.totals ? `（初始 AI 基准成本 ${money(r.originalEstimate.totals.costBase)}，初始建议未税价 ${money(r.originalEstimate.totals.suggestedCNY)}）` : ''}。
          </p>
        )}
        <p className="prose">{r.summary}</p>
        {r.budgetAssessment && <p className="calculation-note">{typeof r.budgetAssessment === 'string' ? r.budgetAssessment : r.budgetAssessment.summary}</p>}
        <p className="calculation-note">{r.calculationNote}</p>
        {r.fx && (
          <p className="calculation-note">
            参考汇率：1 CNY = {r.fx.rate} {r.fx.quote} · {r.fx.date}
            {r.fx.source && /^https?:\/\//.test(r.fx.source) && (
              <> · <a href={r.fx.source} target="_blank" rel="noopener noreferrer">汇率来源</a></>
            )}
          </p>
        )}
      </div>

      <div className="panel">
        <div className="panel-toolbar">
          <h2>本次新增成本明细</h2>
          <span className="muted">内部核算币种 · CNY</span>
        </div>
        <div className="table-scroll">
          <table className="app-table cost-detail">
            <thead>
              <tr>
                <th>工作项 / 成本构成</th>
                <th className="num">数量区间</th>
                <th className="num">基准数量</th>
                <th className="num">成本单价</th>
                <th className="num">基准成本</th>
                <th>测算依据</th>
              </tr>
            </thead>
            <tbody>
              {r.costLines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <strong>{l.description}</strong>
                    {l.reuseNote && <small>{l.reuseNote}</small>}
                  </td>
                  <td className="num">{l.quantityLow} – {l.quantityHigh} {l.unit}</td>
                  <td className="num">{l.quantityBase} {l.unit}</td>
                  <td className="num">{money(l.unitCostCNY)}</td>
                  <td className="num"><strong>{money(l.base)}</strong></td>
                  <td>
                    <span className={'confidence ' + l.confidence}>
                      {{ high: '依据明确', medium: '待进一步核对', low: '经验假设' }[l.confidence] || l.confidence}
                    </span>
                    <small>{l.basis}</small>
                    {sourceLinks(l.sourceIds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!!r.licenseLines.length && (
        <div className="panel content-panel">
          <h2>授权产品定价建议</h2>
          {r.licenseLines.map((l, i) => (
            <div className="license-estimate" key={i}>
              <div>
                <strong>{l.name}</strong>
                <p>{l.quantity} {l.unit} × {money(l.unitPriceCNY)}</p>
                <small>{l.basis}{sourceLinks(l.sourceIds)}</small>
              </div>
              <b className="num">{money(l.totalCNY)}</b>
            </div>
          ))}
        </div>
      )}

      <div className="two-panels">
        <div className="panel content-panel">
          <h2>待确认事项与测算假设</h2>
          {r.missingInfo.length > 0 && (
            <>
              <h3>需向客户确认</h3>
              <ul className="plain-list">{r.missingInfo.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
          <h3>测算前提假设</h3>
          <ul className="plain-list">{r.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>

        <div className="panel content-panel">
          <h2>交付阶段与风险识别</h2>
          {r.deliveryPlan.map((p, i) => (
            <div className="delivery-stage" key={i}>
              <strong>{p.stage}<small>{p.duration}</small></strong>
              <p>{p.work}</p>
            </div>
          ))}
          {r.risks.length > 0 && (
            <>
              <h3>关键项目风险</h3>
              <ul className="plain-list">{r.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
        </div>
      </div>

      <div className="panel content-panel">
        <h2>客户公开信息核查</h2>
        <p className="prose">{r.company.summary || '未检索到足够可验证的公开背景资料。'}</p>
        {r.company.facts.length > 0 && (
          <ul className="plain-list">
            {r.company.facts.map((f, i) => <li key={i}>{f.statement}{sourceLinks(f.sourceIds)}</li>)}
          </ul>
        )}
        {r.company.uncertainties.map((s, i) => <p className="muted" key={i} style={{ marginTop: 6 }}>{s}</p>)}
      </div>

      <div className="panel">
        <div className="panel-toolbar"><h2>相似项目与价格参考</h2></div>
        {r.comparables.length ? (
          <div className="table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>参考项目</th>
                  <th>证据类别</th>
                  <th className="num">原始参考金额</th>
                  <th>可比性与范围差异</th>
                </tr>
              </thead>
              <tbody>
                {r.comparables.map((c, i) => (
                  <tr key={i}>
                    <td><strong>{c.title}</strong>{sourceLinks([c.sourceId])}</td>
                    <td>{evidenceNames[c.evidenceType] || c.evidenceType}</td>
                    <td className="num">{c.amount !== null ? money(c.amount, c.currency) : '未披露'}</td>
                    <td>{c.comparability}<small>{c.differences}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">本次未检索到足够可比的成交或公开中标价格证据。</div>
        )}
      </div>

      <details className="panel source-panel">
        <summary>
          <span>研究来源与参考库命中记录</span>
          <span>{research.sources.length} 条记录</span>
        </summary>
        <div className="content-panel">
          {searchQueries.length > 0 && (
            <div className="search-query-tags">
              <span>联网检索词：</span>
              {searchQueries.map((qText, idx) => <span className="quiet-badge" key={idx}>{qText}</span>)}
            </div>
          )}
          {research.warnings.map((s, i) => <p className="source-warning" key={i}>{s}</p>)}
          {!research.sources.length && <p className="muted">本次分析未使用外部网页或内部历史参考记录。</p>}
          {research.sources.map(s => (
            <div className="source-record" key={s.id}>
              <strong>
                {s.id} · {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
              </strong>
              <small>
                {s.access === 'snippet' ? '公开搜索摘要' : s.access === 'internal' ? '内部历史参考库' : '已核验网页正文'}
                {' · '}
                {shortDate(s.retrievedAt)}
              </small>
              <p>{formatSourceSummary(s)}</p>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

function CostAdjuster({ run, projectTypes = [], onClose, onSaved }) {
  const makeState = src => JSON.parse(JSON.stringify({
    costLines: src.costLines,
    licenseLines: src.licenseLines,
    margin: src.totals.margin,
    riskReserve: src.totals.riskReserve
  }));

  const [draft, setDraft] = React.useState(() => makeState(run.result));
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const preview = React.useMemo(() => calcEstimatePreview(draft), [draft]);

  const updateCost = (i, key, value) => {
    setDraft(d => ({ ...d, costLines: d.costLines.map((l, j) => i === j ? { ...l, [key]: value } : l) }));
    setError('');
  };

  const addCostLine = () => {
    setDraft(d => ({
      ...d,
      costLines: [
        ...d.costLines,
        {
          businessId: projectTypes[0] || 'shared',
          category: 'labor',
          role: '',
          description: '',
          quantityLow: 1,
          quantityBase: 1,
          quantityHigh: 1,
          unit: '人日',
          unitCostCNY: 1800,
          basis: '人工补充',
          sourceIds: [],
          confidence: 'high',
          reuseNote: ''
        }
      ]
    }));
  };

  const restoreOriginal = async () => {
    if (!run.result.originalEstimate) return;
    setBusy(true);
    setError('');
    try {
      await api('/analysis/adjust', { id: run.id, reset: true });
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!draft.costLines.length) {
      setError('至少需保留一行成本明细');
      return;
    }
    for (let i = 0; i < draft.costLines.length; i++) {
      const l = draft.costLines[i];
      if (!String(l.description || '').trim() || !String(l.unit || '').trim()) {
        setError(`请填写第 ${i + 1} 项成本的工作名称与计价单位`);
        return;
      }
      const low = Number(l.quantityLow), base = Number(l.quantityBase), high = Number(l.quantityHigh), unitCost = Number(l.unitCostCNY);
      if ([low, base, high, unitCost].some(n => !Number.isFinite(n) || n < 0)) {
        setError(`第 ${i + 1} 项的数量与成本单价必须为大于或等于 0 的数字`);
        return;
      }
      if (low > base || base > high) {
        setError(`第 ${i + 1} 项需满足：数量下限 <= 基准数量 <= 数量上限`);
        return;
      }
    }
    for (let i = 0; i < draft.licenseLines.length; i++) {
      const l = draft.licenseLines[i];
      if (!(Number(l.quantity) > 0) || !(Number(l.unitPriceCNY) >= 0)) {
        setError(`授权项目“${l.name}”的数量需大于 0，单价不能为负数`);
        return;
      }
    }
    const margin = Number(draft.margin), risk = Number(draft.riskReserve);
    if (!(Number.isFinite(margin) && margin >= 0 && margin < 100)) {
      setError('目标毛利率需在 0% 到 100% 之间（不含 100%）');
      return;
    }
    if (!(Number.isFinite(risk) && risk >= 0)) {
      setError('风险预留金额不能为负数');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api('/analysis/adjust', { id: run.id, ...draft });
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <QuoteOverlay
      wide
      title="校准成本与定价参数"
      subtitle="金额统一按 CNY 实时重算；保存后生成新的建议未税报价。"
      onClose={onClose}
      footer={
        <>
          {run.result.originalEstimate && (
            <button type="button" className="button ghost" disabled={busy} onClick={restoreOriginal} style={{ marginRight: 'auto' }}>
              <QuoteIcon name="refresh" size={14} />恢复初始 AI 测算
            </button>
          )}
          <button type="button" className="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="button primary" disabled={busy} onClick={submit}>
            {busy ? '保存中…' : '保存测算'}
          </button>
        </>
      }
    >
      <div className="adjust-live-summary">
        <div>
          <span>新增基准成本</span>
          <strong>{money(preview.costBase)}</strong>
          <small>区间 {money(preview.costLow)} – {money(preview.costHigh)}</small>
        </div>
        <div>
          <span>风险预留</span>
          <strong>{money(preview.riskReserve)}</strong>
          <small>毛利率 {draft.margin || 0}%</small>
        </div>
        {preview.licenseTotal > 0 && (
          <div>
            <span>授权售价</span>
            <strong>{money(preview.licenseTotal)}</strong>
          </div>
        )}
        <div className="accent">
          <span>重算建议未税总价</span>
          <strong>{money(preview.suggestedCNY)}</strong>
        </div>
      </div>

      <ErrorBox error={error} />

      <div className="adjust-section-head">
        <h3>新增交付成本项</h3>
        <button type="button" className="text-button" onClick={addCostLine}>
          <QuoteIcon name="plus" size={14} />补充成本项
        </button>
      </div>

      {draft.costLines.map((l, i) => (
        <div className="adjust-cost-row" key={i}>
          <div className="adjust-cost-top">
            <input
              className="adjust-title-input"
              aria-label={`成本项 ${i + 1} 名称`}
              placeholder="填写工作或成本项名称"
              value={l.description}
              onChange={e => updateCost(i, 'description', e.target.value)}
            />
            <span className="adjust-line-subtotal">基准小计 {money(preview.costLines[i]?.base || 0)}</span>
            <button
              type="button"
              className="icon-button danger"
              disabled={draft.costLines.length === 1}
              aria-label={`删除成本项 ${i + 1}`}
              onClick={() => setDraft(d => ({ ...d, costLines: d.costLines.filter((_, j) => j !== i) }))}
            >
              <QuoteIcon name="trash" size={14} />
            </button>
          </div>
          <div className="adjust-cost-fields five-cols">
            <Field label="数量下限">
              <input type="number" min="0" step="any" value={l.quantityLow} onChange={e => updateCost(i, 'quantityLow', e.target.value)} />
            </Field>
            <Field label="基准数量">
              <input type="number" min="0" step="any" value={l.quantityBase} onChange={e => updateCost(i, 'quantityBase', e.target.value)} />
            </Field>
            <Field label="数量上限">
              <input type="number" min="0" step="any" value={l.quantityHigh} onChange={e => updateCost(i, 'quantityHigh', e.target.value)} />
            </Field>
            <Field label="单位">
              <input value={l.unit} onChange={e => updateCost(i, 'unit', e.target.value)} placeholder="人日 / 项" />
            </Field>
            <Field label="成本单价 (CNY)">
              <input type="number" min="0" step="any" value={l.unitCostCNY} onChange={e => updateCost(i, 'unitCostCNY', e.target.value)} />
            </Field>
          </div>
        </div>
      ))}

      {draft.licenseLines.length > 0 && (
        <>
          <div className="adjust-section-head"><h3>算法与产品授权项</h3></div>
          {draft.licenseLines.map((l, i) => (
            <div className="adjust-cost-row" key={'license' + i}>
              <div className="adjust-cost-top">
                <strong>{l.name}</strong>
                <span className="adjust-line-subtotal">授权小计 {money(preview.licenseLines[i]?.totalCNY || 0)}</span>
              </div>
              <div className="adjust-cost-fields">
                <Field label={`授权数量 (${l.unit})`}>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={l.quantity}
                    onChange={e => setDraft(d => ({ ...d, licenseLines: d.licenseLines.map((x, j) => i === j ? { ...x, quantity: e.target.value } : x) }))}
                  />
                </Field>
                <Field label={'授权单价 (CNY / ' + l.unit + ')'}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={l.unitPriceCNY}
                    onChange={e => setDraft(d => ({ ...d, licenseLines: d.licenseLines.map((x, j) => i === j ? { ...x, unitPriceCNY: e.target.value } : x) }))}
                  />
                </Field>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="simple-grid" style={{ marginTop: 18 }}>
        <Field label="风险预留金额 (CNY)">
          <input type="number" min="0" step="any" value={draft.riskReserve} onChange={e => { setDraft({ ...draft, riskReserve: e.target.value }); setError(''); }} />
        </Field>
        <Field label="目标毛利率 (%)">
          <input type="number" min="0" max="99.9" step="any" value={draft.margin} onChange={e => { setDraft({ ...draft, margin: e.target.value }); setError(''); }} />
        </Field>
      </div>
    </QuoteOverlay>
  );
}

Object.assign(window, { ProjectEditor, ProjectsPage, ProjectPage, AnalysisResult });
