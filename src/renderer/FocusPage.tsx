import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Preset, TimerMode } from '../shared/types';
import { errorMessage, personalToolApi } from './api';
import { Icon, Modal, Spinner, Switch } from './components';
import { formatClock, formatDuration, formatFullDate, formatTimer, sameDay } from './format';
import { elapsedSeconds, timerDisplaySeconds, type UiSnapshot } from './model';
import type { CommitSnapshot, Notify } from './ui-types';

interface FocusPageProps {
  snapshot: UiSnapshot;
  commitSnapshot: CommitSnapshot;
  notify: Notify;
}

interface PresetDraft {
  id?: string;
  name: string;
  minutes: string;
  seconds: string;
  isDefault: boolean;
}

const emptyPresetDraft: PresetDraft = {
  name: '',
  minutes: '25',
  seconds: '0',
  isDefault: false,
};

export function FocusPage({ snapshot, commitSnapshot, notify }: FocusPageProps) {
  const defaultPreset = snapshot.presets.find((preset) => preset.isDefault) ?? snapshot.presets[0];
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [selectedPresetId, setSelectedPresetId] = useState(defaultPreset?.id ?? '');
  const [customDuration, setCustomDuration] = useState(defaultPreset?.durationSeconds ?? 25 * 60);
  const [title, setTitle] = useState('');
  const [autoSync, setAutoSync] = useState(snapshot.notion.autoSyncPomodoros);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);

  const activeTimer = snapshot.activeTimer;
  const notionConnected = snapshot.notion.connectionState !== 'disconnected';
  const notionDegraded = snapshot.notion.connectionState === 'degraded';
  const selectedPreset = snapshot.presets.find((preset) => preset.id === selectedPresetId);
  const selectedDuration = selectedPreset?.durationSeconds ?? customDuration;

  useEffect(() => {
    if (!snapshot.presets.some((preset) => preset.id === selectedPresetId) && defaultPreset) {
      setSelectedPresetId(defaultPreset.id);
      setCustomDuration(defaultPreset.durationSeconds);
    }
  }, [defaultPreset, selectedPresetId, snapshot.presets]);

  useEffect(() => setAutoSync(snapshot.notion.autoSyncPomodoros), [snapshot.notion.autoSyncPomodoros]);

  useEffect(() => {
    if (!activeTimer) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [activeTimer]);

  const elapsed = elapsedSeconds(activeTimer, now);
  const displaySeconds = activeTimer ? timerDisplaySeconds(activeTimer, now) : mode === 'countdown' ? selectedDuration : 0;
  const timerProgress = activeTimer
    ? activeTimer.mode === 'countdown' && activeTimer.durationSeconds
      ? Math.min(1, elapsed / activeTimer.durationSeconds)
      : (elapsed % 3_600) / 3_600
    : 0;

  const todayEntries = useMemo(
    () => snapshot.entries.filter((entry) => entry.source === 'timer' && sameDay(entry.startAt, Date.now())),
    [snapshot.entries],
  );
  const todaySeconds = todayEntries.reduce(
    (sum, entry) => sum + (entry.focusSeconds ?? Math.max(0, (entry.endAt - entry.startAt) / 1_000)),
    0,
  );

  const mutate = async (key: string, action: () => ReturnType<ReturnType<typeof personalToolApi>['getSnapshot']>, success?: string) => {
    setBusy(key);
    try {
      commitSnapshot(await action());
      if (success) notify(success, 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setBusy(null);
    }
  };

  const startTimer = () =>
    mutate(
      'start',
      () =>
        personalToolApi().timerStart({
          mode,
          durationSeconds: mode === 'countdown' ? selectedDuration : undefined,
          title: title.trim() || '专注时间',
          presetId: mode === 'countdown' ? selectedPreset?.id : undefined,
          autoSync,
        }),
      '计时已经开始',
    );

  return (
    <div className="page focus-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">专注空间</p>
          <h1 className="page-title">把时间留给重要的事</h1>
          <p className="page-subtitle">设定节奏，完成后自动留下清晰的时间记录。</p>
        </div>
        <div className="header-stat" aria-label={`今日专注 ${formatDuration(todaySeconds)}`}>
          <span>今日专注</span>
          <strong>{formatDuration(todaySeconds)}</strong>
        </div>
      </header>

      <div className="focus-layout">
        <section className="panel timer-panel">
          {!activeTimer && (
            <>
              <div className="timer-mode" role="group" aria-label="计时模式">
                <button className={`segment-button ${mode === 'countdown' ? 'is-active' : ''}`} type="button" onClick={() => setMode('countdown')}>
                  倒计时
                </button>
                <button className={`segment-button ${mode === 'countup' ? 'is-active' : ''}`} type="button" onClick={() => setMode('countup')}>
                  正计时
                </button>
              </div>

              <label className="session-title-field">
                <span>这段时间准备做什么？</span>
                <input
                  className="session-title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={80}
                  placeholder="例如：完成项目方案"
                />
              </label>

              {mode === 'countdown' && (
                <div className="preset-area">
                  <div className="preset-row" role="list" aria-label="常用时长">
                    {snapshot.presets.map((preset) => (
                      <button
                        type="button"
                        role="listitem"
                        className={`preset-chip ${selectedPresetId === preset.id ? 'is-active' : ''}`}
                        key={preset.id}
                        onClick={() => {
                          setSelectedPresetId(preset.id);
                          setCustomDuration(preset.durationSeconds);
                        }}
                      >
                        {preset.name}
                        <small>{formatDuration(preset.durationSeconds)}</small>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`preset-chip preset-custom ${selectedPresetId === '' ? 'is-active' : ''}`}
                      onClick={() => setDurationOpen(true)}
                    >
                      <Icon name="plus" size={16} /> 自定义
                    </button>
                  </div>
                  <button className="text-button" type="button" onClick={() => setPresetManagerOpen(true)}>
                    管理预设
                  </button>
                </div>
              )}
            </>
          )}

          {activeTimer && (
            <div className="active-session-heading">
              <span className={`badge ${activeTimer.status === 'paused' ? 'badge-warm' : 'badge-success'}`}>
                {activeTimer.status === 'paused' ? '已暂停' : '专注中'}
              </span>
              <h2>{activeTimer.title}</h2>
              <p>{activeTimer.mode === 'countdown' ? '倒计时' : '正计时'} · 开始于 {formatClock(activeTimer.startedAt)}</p>
            </div>
          )}

          <button
            type="button"
            className={`timer-orb ${activeTimer?.status === 'running' ? 'is-running' : ''}`}
            style={{ '--timer-progress': `${timerProgress * 360}deg` } as CSSProperties}
            onClick={() => !activeTimer && mode === 'countdown' && setDurationOpen(true)}
            aria-label={!activeTimer && mode === 'countdown' ? '编辑计时时长' : undefined}
          >
            <span className="timer-ring" />
            <span className="timer-time">{formatTimer(displaySeconds)}</span>
            <span className="timer-caption">
              {activeTimer
                ? activeTimer.status === 'paused'
                  ? '休息一下，准备好再继续'
                  : activeTimer.mode === 'countdown'
                    ? '剩余时间'
                    : '已经专注'
                : mode === 'countdown'
                  ? '点击时间可自定义'
                  : '从零开始，按自己的节奏'}
            </span>
          </button>

          <div className="timer-controls">
            {!activeTimer ? (
              <button className="button button-primary button-large" type="button" onClick={startTimer} disabled={Boolean(busy)}>
                {busy === 'start' ? <Spinner /> : <Icon name="play" />}
                开始专注
              </button>
            ) : (
              <>
                <button
                  className="button button-primary button-large"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    mutate(
                      activeTimer.status === 'running' ? 'pause' : 'resume',
                      () => (activeTimer.status === 'running' ? personalToolApi().timerPause() : personalToolApi().timerResume()),
                    )
                  }
                >
                  {busy === 'pause' || busy === 'resume' ? <Spinner /> : <Icon name={activeTimer.status === 'running' ? 'pause' : 'play'} />}
                  {activeTimer.status === 'running' ? '暂停' : '继续'}
                </button>
                <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => mutate('finish', () => personalToolApi().timerFinish(), '已保存到活动记录')}>
                  <Icon name="check" /> 完成
                </button>
                <button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={() => mutate('reset', () => personalToolApi().timerReset(), '本次计时已重置')}>
                  <Icon name="reset" /> 放弃
                </button>
              </>
            )}
          </div>

          {!activeTimer && (
            <div className="auto-record-row">
              <span>
                <Icon name={notionConnected ? 'cloud' : 'cloud-off'} size={18} />
                <span><strong>完成后自动同步</strong><small>{notionDegraded ? '连接已保留，恢复后会自动重试' : notionConnected ? '写入已连接的 Notion 数据库' : '连接 Notion 后即可自动写入'}</small></span>
              </span>
              <Switch checked={autoSync} onChange={setAutoSync} label="完成后自动同步" disabled={!notionConnected} />
            </div>
          )}
        </section>

        <aside className="panel today-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">今天</p>
              <h2>专注记录</h2>
            </div>
            <span className="metric">{todayEntries.length} 次</span>
          </div>
          {todayEntries.length ? (
            <div className="session-list">
              {todayEntries.slice().reverse().slice(0, 6).map((entry) => (
                <article className="session-list-item" key={entry.id}>
                  <span className="session-dot" />
                  <div>
                    <strong>{entry.title}</strong>
                    <small>{formatClock(entry.startAt)} – {formatClock(entry.endAt)}</small>
                  </div>
                  <span>{formatDuration(entry.focusSeconds ?? (entry.endAt - entry.startAt) / 1_000)}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="today-empty">
              <span><Icon name="sparkle" /></span>
              <h3>今天从这里开始</h3>
              <p>完成的番茄钟会自动出现在这里和日历中。</p>
            </div>
          )}
          <footer className="today-summary">
            <div><span>累计</span><strong>{formatDuration(todaySeconds)}</strong></div>
            <div><span>最近记录</span><strong>{todayEntries.length ? formatFullDate(todayEntries[todayEntries.length - 1]!.startAt) : '—'}</strong></div>
          </footer>
        </aside>
      </div>

      <DurationModal
        open={durationOpen}
        initialSeconds={selectedDuration}
        onClose={() => setDurationOpen(false)}
        onApply={(seconds) => {
          setSelectedPresetId('');
          setCustomDuration(seconds);
          setDurationOpen(false);
        }}
      />
      <PresetManager
        open={presetManagerOpen}
        presets={snapshot.presets}
        busy={busy}
        onClose={() => setPresetManagerOpen(false)}
        onSave={(draft) => {
          const seconds = Math.max(1, Number(draft.minutes || 0) * 60 + Number(draft.seconds || 0));
          return mutate('preset', () => personalToolApi().savePreset({ id: draft.id, name: draft.name.trim(), durationSeconds: seconds, isDefault: draft.isDefault }), '预设已保存');
        }}
        onDelete={(id) => mutate('preset-delete', () => personalToolApi().deletePreset(id), '预设已删除')}
      />
    </div>
  );
}

function DurationModal({ open, initialSeconds, onClose, onApply }: { open: boolean; initialSeconds: number; onClose: () => void; onApply: (seconds: number) => void }) {
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('25');
  const [seconds, setSeconds] = useState('0');

  useEffect(() => {
    if (!open) return;
    setHours(String(Math.floor(initialSeconds / 3_600)));
    setMinutes(String(Math.floor((initialSeconds % 3_600) / 60)));
    setSeconds(String(initialSeconds % 60));
  }, [initialSeconds, open]);

  const total = Number(hours || 0) * 3_600 + Number(minutes || 0) * 60 + Number(seconds || 0);
  return (
    <Modal
      open={open}
      title="自定义时长"
      description="最长可设置 23 小时 59 分钟 59 秒。"
      onClose={onClose}
      width="440px"
      footer={<><button className="button button-secondary" type="button" onClick={onClose}>取消</button><button className="button button-primary" type="button" disabled={total < 1 || total > 86_399} onClick={() => onApply(total)}>应用</button></>}
    >
      <div className="duration-fields">
        <label><span>小时</span><input type="number" min="0" max="23" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
        <span>:</span>
        <label><span>分钟</span><input type="number" min="0" max="59" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        <span>:</span>
        <label><span>秒</span><input type="number" min="0" max="59" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label>
      </div>
    </Modal>
  );
}

function PresetManager({
  open,
  presets,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  presets: Preset[];
  busy: string | null;
  onClose: () => void;
  onSave: (draft: PresetDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PresetDraft>(emptyPresetDraft);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open) {
      setDraft(emptyPresetDraft);
      setEditing(false);
    }
  }, [open]);

  const editPreset = (preset: Preset) => {
    setDraft({
      id: preset.id,
      name: preset.name,
      minutes: String(Math.floor(preset.durationSeconds / 60)),
      seconds: String(preset.durationSeconds % 60),
      isDefault: preset.isDefault,
    });
    setEditing(true);
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    await onSave(draft);
    setDraft(emptyPresetDraft);
    setEditing(false);
  };

  return (
    <Modal open={open} title="常用时长" description="给不同类型的工作建立顺手的计时预设。" onClose={onClose} width="680px">
      <div className="preset-manager">
        <div className="preset-manager-list">
          {presets.map((preset) => (
            <article className="preset-manager-item" key={preset.id}>
              <div className="preset-avatar">{Math.max(1, Math.round(preset.durationSeconds / 60))}</div>
              <div><strong>{preset.name}</strong><small>{formatDuration(preset.durationSeconds)}{preset.isDefault ? ' · 默认' : ''}</small></div>
              <button className="button button-icon" type="button" aria-label={`编辑 ${preset.name}`} onClick={() => editPreset(preset)}><Icon name="edit" size={17} /></button>
              <button
                className="button button-icon danger-icon"
                type="button"
                aria-label={`删除 ${preset.name}`}
                disabled={busy === 'preset-delete'}
                onClick={() => window.confirm(`确定删除“${preset.name}”吗？`) && void onDelete(preset.id)}
              ><Icon name="trash" size={17} /></button>
            </article>
          ))}
        </div>
        <form className="preset-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="preset-editor-title"><h3>{editing ? '编辑预设' : '新建预设'}</h3>{editing && <button className="text-button" type="button" onClick={() => { setEditing(false); setDraft(emptyPresetDraft); }}>取消编辑</button>}</div>
          <label className="form-field"><span>名称</span><input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="例如：深度工作" maxLength={30} /></label>
          <div className="inline-fields">
            <label className="form-field"><span>分钟</span><input type="number" min="0" max="1439" value={draft.minutes} onChange={(event) => setDraft((value) => ({ ...value, minutes: event.target.value }))} /></label>
            <label className="form-field"><span>秒</span><input type="number" min="0" max="59" value={draft.seconds} onChange={(event) => setDraft((value) => ({ ...value, seconds: event.target.value }))} /></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft((value) => ({ ...value, isDefault: event.target.checked }))} />设为默认预设</label>
          <button className="button button-primary" type="submit" disabled={busy === 'preset' || !draft.name.trim()}>{busy === 'preset' ? <Spinner /> : <Icon name={editing ? 'check' : 'plus'} />}{editing ? '保存修改' : '添加预设'}</button>
        </form>
      </div>
    </Modal>
  );
}
