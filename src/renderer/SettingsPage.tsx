import { useEffect, useState } from 'react';
import type { NotionTestResult } from '../shared/types';
import { errorMessage, personalToolApi } from './api';
import { Icon, Spinner, Switch } from './components';
import { relativeSyncTime } from './format';
import { toEpoch, type UiSnapshot } from './model';
import type { CommitSnapshot, Notify } from './ui-types';

interface SettingsPageProps {
  snapshot: UiSnapshot;
  commitSnapshot: CommitSnapshot;
  notify: Notify;
}

export function SettingsPage({ snapshot, commitSnapshot, notify }: SettingsPageProps) {
  const [databaseId, setDatabaseId] = useState(snapshot.notion.databaseId);
  const [token, setToken] = useState('');
  const [autoSyncPomodoros, setAutoSyncPomodoros] = useState(snapshot.notion.autoSyncPomodoros);
  const [autoSyncManual, setAutoSyncManual] = useState(snapshot.notion.autoSyncManual);
  const [busy, setBusy] = useState<'test' | 'save' | 'sync' | null>(null);
  const [testResult, setTestResult] = useState<NotionTestResult | null>(null);

  useEffect(() => {
    setDatabaseId(snapshot.notion.databaseId);
    setAutoSyncPomodoros(snapshot.notion.autoSyncPomodoros);
    setAutoSyncManual(snapshot.notion.autoSyncManual);
  }, [snapshot.notion.autoSyncManual, snapshot.notion.autoSyncPomodoros, snapshot.notion.databaseId]);

  const notionConnected = snapshot.notion.connectionState !== 'disconnected';
  const notionDegraded = snapshot.notion.connectionState === 'degraded';
  const connectionLabel = notionDegraded
    ? '已连接 · 同步异常'
    : !notionConnected
    ? snapshot.notion.databaseId
      ? '需要检查连接'
      : '尚未连接'
    : '连接正常';
  const connectionDescription = notionDegraded
    ? snapshot.notion.databaseName
      ? `已连接到“${snapshot.notion.databaseName}”；本地记录会安全保留，并在下次同步时重试。`
      : '连接配置仍然保留；本地记录会安全保留，并在下次同步时重试。'
    : snapshot.notion.databaseName
      ? `当前数据库：${snapshot.notion.databaseName}`
      : notionConnected
        ? '已经可以发送番茄钟和手动活动记录。'
        : '完成下方配置后，你的记录会同时保存在本机与 Notion。';

  const test = async () => {
    if (!databaseId.trim()) return;
    setBusy('test');
    setTestResult(null);
    try {
      const result = await personalToolApi().testNotion({ databaseId: databaseId.trim(), token: token.trim() || undefined });
      setTestResult(result);
      notify(result.message, result.ok ? 'success' : 'error');
    } catch (cause) {
      const message = errorMessage(cause);
      setTestResult({ ok: false, message });
      notify(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const canTest = Boolean(token.trim() || snapshot.notion.tokenConfigured);
      const next = await personalToolApi().updateNotionSettings({
        databaseId: databaseId.trim(),
        token: token.trim() || undefined,
        autoSyncPomodoros,
        autoSyncManual,
      });
      commitSnapshot(next);
      setToken('');
      if (canTest) {
        const result = await personalToolApi().testNotion({ databaseId: databaseId.trim() });
        setTestResult(result);
        commitSnapshot(await personalToolApi().getSnapshot());
        notify(result.ok ? 'Notion 设置已保存并验证' : `设置已保存；${result.message}`, result.ok ? 'success' : 'error');
      } else {
        notify('Notion 设置已保存；填写 Token 后可测试连接', 'info');
      }
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const next = await personalToolApi().syncNotion();
      commitSnapshot(next);
      const partial = Boolean(next.settings.notion.lastError);
      notify(partial ? '同步尚未完全完成，应用会在后台自动重试' : '同步完成', partial ? 'info' : 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">偏好与连接</p>
          <h1 className="page-title">设置</h1>
          <p className="page-subtitle">控制记录如何保存，以及何时同步到 Notion。</p>
        </div>
      </header>

      <div className={`status-card connection-status ${notionConnected ? 'is-connected' : ''} ${snapshot.notion.error ? 'has-error' : ''}`}>
        <span className="status-card-icon"><Icon name={notionConnected ? 'cloud' : 'cloud-off'} size={28} /></span>
        <div>
          <span className="status-kicker">NOTION 数据库</span>
          <h2>{connectionLabel}</h2>
          <p>{connectionDescription}</p>
        </div>
        <div className="connection-meta">
          <span>{relativeSyncTime(toEpoch(snapshot.notion.lastSyncedAt))}</span>
          {notionConnected && <button className="button button-secondary" type="button" disabled={busy === 'sync'} onClick={sync}>{busy === 'sync' ? <Spinner /> : <Icon name="refresh" />}立即同步</button>}
        </div>
      </div>

      {snapshot.notion.error && (
        <div className="error-banner" role="alert">
          <Icon name="info" />
          <span><strong>{notionDegraded ? '连接仍保留，最近一次同步没有完成' : 'Notion 连接需要检查'}</strong>{snapshot.notion.error}</span>
        </div>
      )}

      <div className="settings-grid">
        <section className="panel settings-section notion-config-section">
          <div className="settings-section-header">
            <span className="settings-section-icon"><Icon name="database" /></span>
            <div><h2>Notion 连接</h2><p>连接一个带日期属性的数据库，用它承载日历记录。</p></div>
          </div>

          <div className="setup-note">
            <Icon name="info" />
            <p><strong>关于 Notion Calendar</strong>Notion Calendar 没有独立的事件写入接口。本应用连接同一个 Notion 数据库；将该数据库添加到 Notion Calendar 后，两处会展示相同记录。</p>
          </div>

          <div className="connection-form">
            <label className="form-field form-field-full">
              <span>数据库 ID</span>
              <input value={databaseId} onChange={(event) => { setDatabaseId(event.target.value); setTestResult(null); }} placeholder="粘贴数据库链接中的 ID" spellCheck={false} />
              <small>支持直接粘贴数据库 ID；集成必须有该数据库的访问权限。</small>
            </label>
            <label className="form-field form-field-full">
              <span>Internal Integration Token</span>
              <input type="password" value={token} onChange={(event) => { setToken(event.target.value); setTestResult(null); }} placeholder={snapshot.notion.tokenConfigured ? '已安全保存；留空表示不更改' : 'secret_…'} autoComplete="off" spellCheck={false} />
              <small>Token 仅交给本机主进程使用，不会写入页面或日志。</small>
            </label>

            {testResult && (
              <div className={`connection-test-result ${testResult.ok ? 'is-success' : 'is-error'}`} role="status">
                <Icon name={testResult.ok ? 'check' : 'info'} />
                <span><strong>{testResult.ok ? testResult.databaseName || '连接测试成功' : '无法连接'}</strong>{testResult.message}{testResult.ok && testResult.titleProperty && <small>标题：{testResult.titleProperty} · 日期：{testResult.dateProperty}</small>}</span>
              </div>
            )}

            <div className="form-actions">
              <button className="button button-secondary" type="button" disabled={!databaseId.trim() || busy !== null} onClick={test}>{busy === 'test' ? <Spinner /> : <Icon name="cloud" />}测试连接</button>
              <button className="button button-primary" type="button" disabled={!databaseId.trim() || busy !== null} onClick={save}>{busy === 'save' ? <Spinner /> : <Icon name="check" />}保存设置</button>
            </div>
          </div>
        </section>

        <div className="settings-side">
          <section className="panel settings-section">
            <div className="settings-section-header">
              <span className="settings-section-icon warm"><Icon name="refresh" /></span>
              <div><h2>自动记录</h2><p>选择哪些本地活动自动进入 Notion。</p></div>
            </div>
            <div className="setting-list">
              <div className="setting-row">
                <div><strong>完成的番茄钟</strong><small>结束计时后自动创建一条记录</small></div>
                <Switch checked={autoSyncPomodoros} onChange={setAutoSyncPomodoros} label="自动同步番茄钟" />
              </div>
              <div className="setting-row">
                <div><strong>手动活动记录</strong><small>日历中新建的活动自动上传</small></div>
                <Switch checked={autoSyncManual} onChange={setAutoSyncManual} label="自动同步手动记录" />
              </div>
            </div>
            {(autoSyncPomodoros !== snapshot.notion.autoSyncPomodoros || autoSyncManual !== snapshot.notion.autoSyncManual) && (
              <button className="button button-primary setting-save" type="button" disabled={busy !== null || !databaseId.trim()} onClick={save}>{busy === 'save' ? <Spinner /> : <Icon name="check" />}保存同步偏好</button>
            )}
          </section>

          <section className="panel settings-section local-first-card">
            <div className="settings-section-header">
              <span className="settings-section-icon green"><Icon name="check" /></span>
              <div><h2>本地优先</h2><p>断网不会打断你的计时。</p></div>
            </div>
            <p>番茄钟与活动会先保存在电脑中。连接恢复后，等待中的记录会再次同步，无需重复添加。</p>
            <div className="local-promise"><span>✓</span>离线可用</div>
            <div className="local-promise"><span>✓</span>失败可重试</div>
            <div className="local-promise"><span>✓</span>同步状态可见</div>
          </section>
        </div>
      </div>
    </div>
  );
}
