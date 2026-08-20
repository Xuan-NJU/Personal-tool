import { useEffect, useState } from 'react';
import { errorMessage, personalToolApi } from './api';
import { CalendarPage } from './CalendarPage';
import { EmptyState, Icon, Spinner } from './components';
import { FocusPage } from './FocusPage';
import { formatTimer, relativeSyncTime } from './format';
import { SettingsPage } from './SettingsPage';
import { timerDisplaySeconds } from './model';
import type { NoticeKind } from './ui-types';
import { useAppSnapshot } from './useAppSnapshot';

type PageName = 'focus' | 'calendar' | 'settings';

const pages: Array<{ id: PageName; label: string; icon: 'timer' | 'calendar' | 'settings' }> = [
  { id: 'focus', label: '专注', icon: 'timer' },
  { id: 'calendar', label: '日历', icon: 'calendar' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

export function App() {
  const { snapshot, commitSnapshot, loading, error, reload } = useAppSnapshot();
  const [page, setPage] = useState<PageName>('focus');
  const [notice, setNotice] = useState<{ id: number; message: string; kind: NoticeKind } | null>(null);
  const [miniBusy, setMiniBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice((current) => (current?.id === notice.id ? null : current)), 3_600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!snapshot?.activeTimer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [snapshot?.activeTimer]);

  const notify = (message: string, kind: NoticeKind = 'info') => setNotice({ id: Date.now(), message, kind });

  const miniToggle = async () => {
    if (!snapshot?.activeTimer) return;
    setMiniBusy(true);
    try {
      const next = snapshot.activeTimer.status === 'running' ? await personalToolApi().timerPause() : await personalToolApi().timerResume();
      commitSnapshot(next);
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setMiniBusy(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <main className="launch-screen">
        <div className="launch-mark"><span className="tomato-leaf">◆</span><span>小</span></div>
        <Spinner label="正在打开小番茄" />
        <p>正在整理你的时间记录…</p>
      </main>
    );
  }

  if (error && !snapshot) {
    return (
      <main className="launch-screen launch-error">
        <EmptyState icon="cloud-off" title="暂时无法打开应用数据" description={error} action={<button className="button button-primary" type="button" onClick={reload}><Icon name="refresh" />重试</button>} />
      </main>
    );
  }

  if (!snapshot) return null;

  const syncClass = snapshot.notion.error ? 'is-error' : snapshot.notion.connected ? 'is-connected' : 'is-local';
  const syncLabel = snapshot.notion.error
    ? '同步需处理'
    : snapshot.notion.connected
      ? relativeSyncTime(snapshot.notion.lastSyncedAt ? Date.parse(snapshot.notion.lastSyncedAt) : undefined)
      : '仅本地';
  const pageTitle = pages.find((item) => item.id === page)?.label ?? '小番茄';
  const miniSeconds = timerDisplaySeconds(snapshot.activeTimer, now);

  return (
    <div className={`app-shell ${snapshot.activeTimer ? 'has-mini-timer' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true"><span>小</span><i /></span>
          <span className="brand-copy"><strong>小番茄</strong><small>Personal Tool</small></span>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {pages.map((item) => (
            <button
              className={`nav-button ${page === item.id ? 'is-active' : ''}`}
              type="button"
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon"><Icon name={item.icon} /></span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer">
          <button className={`sidebar-sync ${syncClass}`} type="button" onClick={() => setPage('settings')}>
            <span className="sidebar-sync-icon"><Icon name={snapshot.notion.connected ? 'cloud' : 'cloud-off'} size={18} /></span>
            <span><strong>{snapshot.notion.connected ? snapshot.notion.databaseName || 'Notion 已连接' : 'Notion 未连接'}</strong><small>{syncLabel}</small></span>
          </button>
          <p className="version-label">小番茄 · 本地优先</p>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title"><span className="mobile-brand-mark">小</span><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <button className={`sync-pill ${syncClass}`} type="button" onClick={() => setPage('settings')}>
              <span className="sync-dot" />
              {syncLabel}
            </button>
          </div>
        </header>

        <main className="content">
          {error && <div className="error-banner app-error" role="alert"><Icon name="info" /><span><strong>数据刷新失败</strong>{error}</span><button className="text-button" type="button" onClick={reload}>重试</button></div>}
          {page === 'focus' && <FocusPage snapshot={snapshot} commitSnapshot={commitSnapshot} notify={notify} />}
          {page === 'calendar' && <CalendarPage snapshot={snapshot} commitSnapshot={commitSnapshot} notify={notify} onOpenSettings={() => setPage('settings')} />}
          {page === 'settings' && <SettingsPage snapshot={snapshot} commitSnapshot={commitSnapshot} notify={notify} />}
        </main>
      </div>

      {snapshot.activeTimer && page !== 'focus' && (
        <div className="mini-timer" role="region" aria-label="正在进行的计时">
          <button className="mini-timer-main" type="button" onClick={() => setPage('focus')}>
            <span className={`mini-timer-pulse ${snapshot.activeTimer.status === 'paused' ? 'is-paused' : ''}`} />
            <span><strong>{snapshot.activeTimer.title}</strong><small>{snapshot.activeTimer.status === 'paused' ? '已暂停' : snapshot.activeTimer.mode === 'countdown' ? '剩余时间' : '正向计时'}</small></span>
          </button>
          <time>{formatTimer(miniSeconds)}</time>
          <button className="button button-icon mini-timer-toggle" type="button" disabled={miniBusy} aria-label={snapshot.activeTimer.status === 'running' ? '暂停计时' : '继续计时'} onClick={miniToggle}>
            {miniBusy ? <Spinner /> : <Icon name={snapshot.activeTimer.status === 'running' ? 'pause' : 'play'} />}
          </button>
        </div>
      )}

      {notice && (
        <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast-icon"><Icon name={notice.kind === 'success' ? 'check' : notice.kind === 'error' ? 'info' : 'sparkle'} /></span>
          <span>{notice.message}</span>
          <button className="button button-icon" type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><Icon name="close" size={17} /></button>
        </div>
      )}
    </div>
  );
}
