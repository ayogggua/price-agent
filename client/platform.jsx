const { api, go, roleNames, ErrorBox, Loading, Field } = window.PriceUI;

function LoginPage({ setupRequired, brandTitle, onLogin }) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async e => {
    e.preventDefault();
    const uname = username.trim();
    if (!/^[a-zA-Z0-9_.@-]{3,80}$/.test(uname)) {
      setError('登录账号需使用 3–80 位字母、数字或 . _ @ -');
      return;
    }
    if (setupRequired && password.length < 10) {
      setError('管理员初始密码长度至少需要 10 位');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api(setupRequired ? '/auth/setup' : '/auth/login', { username: uname, password, name: name.trim() });
      onLogin(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-brand">
        <QuoteBrandMark size={32} />
        <span>{brandTitle}</span>
      </div>

      <div className="login-layout">
        <div className="login-intro">
          <h1>智能项目评估与报价系统</h1>
          <p>结构化拆解交付范围，结合历史资产与参考价格完成成本核算与正式单据导出。</p>
          <div className="login-feature-list">
            <span>多业务组合需求录入与文档解析</span>
            <span>复用资产扣减与增量成本测算</span>
            <span>高密度报价明细审核与 PDF / Excel 导出</span>
          </div>
        </div>

        <form className="login-card" onSubmit={submit}>
          <h2>{setupRequired ? '初始化系统管理员' : '登录工作台'}</h2>
          <p>{setupRequired ? '首次启动系统，请创建首个管理员账号以管理报价配置与团队成员。' : '请输入账号与密码进入工作台。'}</p>
          <ErrorBox error={error} />

          {setupRequired && (
            <Field label="管理员姓名" required>
              <input value={name} autoComplete="name" required placeholder="例如：张经理" onChange={e => setName(e.target.value)} />
            </Field>
          )}

          <Field label="登录账号" required>
            <input
              id="login-username"
              value={username}
              autoComplete="username"
              required
              minLength={3}
              onChange={e => setUsername(e.target.value)}
              placeholder="字母、数字或 . _ @ -"
            />
          </Field>

          <Field label="登录密码" required>
            <QuotePasswordInput
              id="login-password"
              value={password}
              autoComplete={setupRequired ? 'new-password' : 'current-password'}
              required
              minLength={setupRequired ? 10 : 1}
              onChange={e => setPassword(e.target.value)}
              placeholder={setupRequired ? '至少 10 位字符' : '输入密码'}
            />
          </Field>

          <button className="button primary large" disabled={busy} type="submit">
            {busy ? '正在验证…' : setupRequired ? '完成初始化并进入' : '登录'}
            <QuoteIcon name="arrow" size={15} />
          </button>
        </form>
      </div>
    </main>
  );
}

function SessionReloginModal({ usernameDefault = '', onRelogin, onSwitchAccount }) {
  const [username, setUsername] = React.useState(usernameDefault);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/login', { username: username.trim(), password });
      onRelogin(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <QuoteOverlay
      compact
      title="会话已过期，请重新验证"
      subtitle="重新登录后将继续停留在当前页面，未保存的编辑内容不会丢失。"
      onClose={onSwitchAccount}
    >
      <form onSubmit={submit} className="relogin-form">
        <ErrorBox error={error} />
        <Field label="登录账号" required>
          <input value={username} autoComplete="username" required onChange={e => setUsername(e.target.value)} />
        </Field>
        <Field label="登录密码" required>
          <QuotePasswordInput value={password} autoComplete="current-password" required placeholder="输入登录密码" onChange={e => setPassword(e.target.value)} />
        </Field>
        <div className="relogin-actions">
          <button type="button" className="button ghost" onClick={onSwitchAccount}>返回登录页</button>
          <button type="submit" className="button primary" disabled={busy}>{busy ? '验证中…' : '重新连接会话'}</button>
        </div>
      </form>
    </QuoteOverlay>
  );
}

function Platform() {
  const [session, setSession] = React.useState(null);
  const [bootError, setBootError] = React.useState('');
  const [topError, setTopError] = React.useState('');
  const [expiredOverlay, setExpiredOverlay] = React.useState(false);
  const [route, setRoute] = React.useState(() => location.hash.slice(1) || 'projects');

  const refreshMe = React.useCallback(async () => {
    const me = await api('/auth/me');
    setSession(me);
    return me;
  }, []);

  React.useEffect(() => {
    refreshMe().catch(e => setBootError(e.message));
    const onHash = () => setRoute(location.hash.slice(1) || 'projects');
    const onExpired = () => {
      setSession(old => {
        if (old?.user) {
          setExpiredOverlay(true);
          return old;
        }
        return old ? { ...old, user: null } : old;
      });
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('price-auth-expired', onExpired);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('price-auth-expired', onExpired);
    };
  }, [refreshMe]);

  const brandTitle = session?.brandName || '报价工作台';
  const companyTag = String(session?.companyName || '').trim();

  React.useEffect(() => {
    document.title = companyTag ? `${companyTag} · ${brandTitle}` : brandTitle;
  }, [brandTitle, companyTag]);

  if (bootError) {
    return (
      <div className="standalone-error">
        <h2>无法连接工作台服务</h2>
        <ErrorBox error={bootError} />
        <button type="button" className="button primary" onClick={() => location.reload()}>重试连接</button>
      </div>
    );
  }

  if (!session) return <Loading text="正在加载报价工作台…" />;

  if (!session.user) {
    return (
      <LoginPage
        setupRequired={session.setupRequired}
        brandTitle={brandTitle}
        onLogin={async r => {
          setSession(old => ({ ...old, ...r, setupRequired: false }));
          refreshMe().catch(() => {});
          if (!location.hash || location.hash === '#') {
            go('projects', null, { force: true });
          }
        }}
      />
    );
  }

  const [view, params] = route.split('?');
  const itemId = new URLSearchParams(params).get('id');
  const user = session.user;

  const nav = [
    ['projects', '项目报价', 'file'],
    ['assets', '产品与成果库', 'layers'],
    ['references', '价格参考库', 'coins'],
    ['settings', '系统设置', 'building']
  ];

  const handleLogout = async () => {
    if (!window.PriceUI.canLeave()) return;
    setTopError('');
    try {
      await api('/auth/logout', {});
      window.PriceUI.setDirtyGuard(null);
      setExpiredOverlay(false);
      setSession(old => ({ ...old, user: null }));
    } catch (e) {
      setTopError(e.message);
    }
  };

  return (
    <div className="platform-shell">
      <header className="topbar">
        <button type="button" className="brand brand-button" onClick={() => go('projects')}>
          <QuoteBrandMark size={28} />
          <span className="brandname">{brandTitle}</span>
        </button>

        {companyTag && <span className="workspace-tag">{companyTag}</span>}

        <div className="topbar-end">
          {session.aiConfigured === false && (
            <button type="button" className="ai-status-pill" onClick={() => go('settings')} title="点击查看模型服务状态">
              <QuoteIcon name="info" size={13} />
              <span>AI 待配置</span>
            </button>
          )}
          <span className="user-label">
            <strong>{user.name}</strong>
            <small>{roleNames[user.role] || user.role}</small>
          </span>
          <button type="button" className="button ghost small" onClick={handleLogout}>退出</button>
        </div>
      </header>

      {topError && (
        <div className="topbar-alert">
          <ErrorBox error={topError} />
        </div>
      )}

      {view === 'input' ? (
        <ProjectEditor key={itemId || 'new'} projectId={itemId} user={user} session={session} />
      ) : (
        <>
          <aside className="app-sidebar" aria-label="主导航">
            <div className="nav-caption">功能导航</div>
            {nav.map(([id, label, icon]) => {
              const isActive = view === id || (id === 'projects' && ['project', 'quote'].includes(view));
              return (
                <button
                  type="button"
                  key={id}
                  className={'app-nav-item' + (isActive ? ' active' : '')}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => go(id)}
                >
                  <QuoteIcon name={icon} size={17} />
                  <span>{label}</span>
                </button>
              );
            })}
            <div className="app-sidebar-foot">
              <QuoteIcon name="shield" size={14} />
              <span>当前角色：{roleNames[user.role] || user.role}</span>
            </div>
          </aside>

          <main className="app-main">
            {view === 'project' && itemId ? (
              <ProjectPage key={itemId} projectId={itemId} user={user} session={session} />
            ) : view === 'quote' && itemId ? (
              <QuotePage key={itemId} quoteId={itemId} user={user} />
            ) : view === 'assets' || view === 'references' ? (
              <LibraryPage key={view} kind={view} user={user} />
            ) : view === 'settings' ? (
              <SettingsPage
                user={user}
                onSessionSync={patch => setSession(old => ({ ...old, ...patch }))}
              />
            ) : (
              <ProjectsPage user={user} session={session} />
            )}
          </main>
        </>
      )}

      {expiredOverlay && (
        <SessionReloginModal
          usernameDefault={user.username}
          onRelogin={res => {
            setSession(old => ({ ...old, ...res }));
            setExpiredOverlay(false);
            refreshMe().catch(() => {});
          }}
          onSwitchAccount={() => {
            window.PriceUI.setDirtyGuard(null);
            setExpiredOverlay(false);
            setSession(old => ({ ...old, user: null }));
          }}
        />
      )}
    </div>
  );
}

class PlatformBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    if (Array.isArray(window.quoteErrors)) window.quoteErrors.push(String(error));
  }
  render() {
    if (this.state.error) {
      return (
        <div className="standalone-error">
          <h2>页面渲染出现异常</h2>
          <p className="muted" style={{ margin: '10px 0 20px' }}>已保存至服务器的数据不受影响，可刷新页面重新进入。</p>
          <button type="button" className="button primary" onClick={() => location.reload()}>刷新工作台</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <PlatformBoundary>
    <Platform />
  </PlatformBoundary>
);
