import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { errorMessage, personalToolApi } from './api';
import { EmptyState, Icon, Modal, Spinner } from './components';
import {
  addDays,
  formatClock,
  formatDayHeader,
  formatDuration,
  formatFullDate,
  formatWeekRange,
  sameDay,
  startOfWeek,
  toLocalInputValue,
} from './format';
import type { UiCalendarEntry, UiSnapshot } from './model';
import type { CommitSnapshot, Notify } from './ui-types';

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, index) => index);

interface CalendarPageProps {
  snapshot: UiSnapshot;
  commitSnapshot: CommitSnapshot;
  notify: Notify;
  onOpenSettings: () => void;
}

export function CalendarPage({ snapshot, commitSnapshot, notify, onOpenSettings }: CalendarPageProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const selectedEntry = snapshot.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const weekEnd = addDays(weekStart, 7).getTime();
  const weekEntries = snapshot.entries.filter((entry) => entry.endAt > weekStart.getTime() && entry.startAt < weekEnd);
  const focusSeconds = weekEntries
    .filter((entry) => entry.source === 'timer')
    .reduce((sum, entry) => sum + (entry.focusSeconds ?? (entry.endAt - entry.startAt) / 1_000), 0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR_HEIGHT * 7.5;
  }, []);

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

  const sync = () => mutate('sync', () => personalToolApi().syncNotion(), '日历已经同步');
  const removeSelected = async () => {
    if (!selectedEntry || !window.confirm(`确定删除“${selectedEntry.title}”吗？`)) return;
    await mutate('delete', () => personalToolApi().deleteEntry(selectedEntry.id), '活动记录已删除');
    setSelectedEntryId(null);
  };

  return (
    <div className="page calendar-page">
      <header className="page-header calendar-page-header">
        <div>
          <p className="eyebrow">时间脉络</p>
          <h1 className="page-title">日历</h1>
          <p className="page-subtitle">看见这一周的安排，也记下时间真正花在了哪里。</p>
        </div>
        <div className="header-stat compact-stat">
          <span>本周专注</span>
          <strong>{formatDuration(focusSeconds)}</strong>
        </div>
      </header>

      {!snapshot.notion.connected && (
        <div className="info-banner">
          <span className="info-banner-icon"><Icon name="cloud-off" /></span>
          <div><strong>当前使用本地日历</strong><p>连接 Notion 数据库后，番茄钟和手动记录可以自动同步。</p></div>
          <button className="button button-secondary" type="button" onClick={onOpenSettings}>去连接</button>
        </div>
      )}
      {snapshot.notion.error && (
        <div className="error-banner" role="alert">
          <Icon name="info" />
          <span><strong>部分记录同步失败</strong>{snapshot.notion.error}</span>
          <button className="text-button" type="button" onClick={sync}>重试</button>
        </div>
      )}

      <section className="panel calendar-workspace">
        <div className="calendar-toolbar">
          <div className="calendar-period-control">
            <button className="button button-secondary today-button" type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}>今天</button>
            <div className="calendar-arrow-group">
              <button className="button button-icon" type="button" aria-label="上一周" onClick={() => setWeekStart((value) => addDays(value, -7))}><Icon name="chevron-left" /></button>
              <button className="button button-icon" type="button" aria-label="下一周" onClick={() => setWeekStart((value) => addDays(value, 7))}><Icon name="chevron-right" /></button>
            </div>
            <h2>{formatWeekRange(weekStart)}</h2>
          </div>
          <div className="calendar-toolbar-actions">
            {snapshot.notion.connected && (
              <button className="button button-secondary" type="button" disabled={busy === 'sync'} onClick={sync}>
                {busy === 'sync' ? <Spinner /> : <Icon name="refresh" />} 同步
              </button>
            )}
            <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" /> 添加记录</button>
          </div>
        </div>

        <div className={`calendar-content ${selectedEntry ? 'has-detail' : ''}`}>
          <div className="calendar-grid" ref={scrollRef} role="grid" aria-label={`${formatWeekRange(weekStart)}周视图`}>
            <div className="week-header">
              <div className="week-corner" />
              {days.map((day) => {
                const label = formatDayHeader(day);
                const today = sameDay(day, Date.now());
                return <div className={`day-header ${today ? 'is-today' : ''}`} key={day.toISOString()}><span>{label.weekday}</span><strong>{label.date}</strong></div>;
              })}
            </div>
            <div className="week-body">
              <div className="time-column" aria-hidden="true">
                {HOURS.map((hour) => <div className="time-label" key={hour} style={{ height: HOUR_HEIGHT }}>{String(hour).padStart(2, '0')}:00</div>)}
              </div>
              {days.map((day) => (
                <DayColumn
                  key={day.toISOString()}
                  day={day}
                  entries={weekEntries}
                  selectedEntryId={selectedEntryId}
                  onSelect={setSelectedEntryId}
                />
              ))}
            </div>
          </div>

          {selectedEntry && (
            <EventDetail
              entry={selectedEntry}
              deleting={busy === 'delete'}
              onClose={() => setSelectedEntryId(null)}
              onDelete={removeSelected}
            />
          )}
        </div>
      </section>

      {!weekEntries.length && (
        <div className="calendar-empty-overlay">
          <EmptyState
            icon="calendar"
            title="这一周还很宽阔"
            description="开始一次专注，或补记一段已经完成的事情。"
            action={<button className="button button-secondary" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" /> 添加活动</button>}
          />
        </div>
      )}

      <CreateEntryModal
        open={createOpen}
        busy={busy === 'create'}
        autoSync={snapshot.notion.connected && snapshot.notion.autoSyncManual}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          await mutate('create', () => personalToolApi().createEntry(input), '活动已经添加');
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function DayColumn({ day, entries, selectedEntryId, onSelect }: { day: Date; entries: UiCalendarEntry[]; selectedEntryId: string | null; onSelect: (id: string) => void }) {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  const dayEntries = entries.filter((entry) => entry.endAt > start.getTime() && entry.startAt < end.getTime());

  return (
    <div className={`day-column ${sameDay(day, Date.now()) ? 'is-today' : ''}`} role="gridcell">
      {HOURS.map((hour) => <div className="hour-cell" key={hour} style={{ height: HOUR_HEIGHT }} />)}
      {dayEntries.map((entry) => {
        const visibleStart = Math.max(entry.startAt, start.getTime());
        const visibleEnd = Math.min(entry.endAt, end.getTime());
        const minutesFromMidnight = (visibleStart - start.getTime()) / 60_000;
        const durationMinutes = Math.max(15, (visibleEnd - visibleStart) / 60_000);
        const top = (minutesFromMidnight / 60) * HOUR_HEIGHT;
        const height = Math.max(24, (durationMinutes / 60) * HOUR_HEIGHT);
        return (
          <button
            className={`calendar-event event-${entry.source} sync-${entry.syncStatus} ${selectedEntryId === entry.id ? 'is-selected' : ''}`}
            style={{ '--event-top': `${top}px`, '--event-height': `${height}px` } as CSSProperties}
            key={`${entry.id}-${day.toISOString()}`}
            type="button"
            title={`${entry.title} · ${formatClock(entry.startAt)}–${formatClock(entry.endAt)}`}
            onClick={() => onSelect(entry.id)}
          >
            <strong>{entry.source === 'timer' && <span aria-hidden="true">● </span>}{entry.title}</strong>
            <small>{formatClock(entry.startAt)} – {formatClock(entry.endAt)}</small>
          </button>
        );
      })}
    </div>
  );
}

function EventDetail({ entry, deleting, onClose, onDelete }: { entry: UiCalendarEntry; deleting: boolean; onClose: () => void; onDelete: () => void }) {
  const typeLabel = entry.source === 'timer' ? '番茄钟' : entry.source === 'remote' ? 'Notion 记录' : '手动记录';
  const statusLabel = { local: '仅本地', pending: '等待同步', synced: '已同步', error: '同步失败' }[entry.syncStatus];
  return (
    <aside className="event-detail-panel" aria-label="活动详情">
      <div className="event-detail-top">
        <span className={`event-kind event-kind-${entry.source}`}>{typeLabel}</span>
        <button className="button button-icon" type="button" aria-label="关闭详情" onClick={onClose}><Icon name="close" /></button>
      </div>
      <h3>{entry.title}</h3>
      <div className="event-detail-time"><Icon name="clock" /><span>{formatFullDate(entry.startAt)}<br />至 {formatFullDate(entry.endAt)}</span></div>
      {entry.focusSeconds !== undefined && <div className="detail-metric"><span>实际专注</span><strong>{formatDuration(entry.focusSeconds)}</strong></div>}
      {entry.notes && <div className="event-notes"><span>备注</span><p>{entry.notes}</p></div>}
      <div className={`sync-detail sync-${entry.syncStatus}`}>
        <Icon name={entry.syncStatus === 'error' ? 'cloud-off' : 'cloud'} size={18} />
        <span><strong>{statusLabel}</strong>{entry.syncError && <small>{entry.syncError}</small>}</span>
      </div>
      {entry.source !== 'remote' && (
        <button className="button button-danger detail-delete" type="button" disabled={deleting} onClick={onDelete}>
          {deleting ? <Spinner /> : <Icon name="trash" />} 删除记录
        </button>
      )}
    </aside>
  );
}

function CreateEntryModal({
  open,
  busy,
  autoSync,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  autoSync: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; notes: string; startAt: string; endAt: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  useEffect(() => {
    if (!open) return;
    const start = new Date();
    start.setSeconds(0, 0);
    start.setMinutes(Math.floor(start.getMinutes() / 15) * 15);
    const end = new Date(start.getTime() + 60 * 60_000);
    setTitle('');
    setNotes('');
    setStartAt(toLocalInputValue(start));
    setEndAt(toLocalInputValue(end));
  }, [open]);

  const valid = title.trim() && startAt && endAt && new Date(endAt).getTime() > new Date(startAt).getTime();
  return (
    <Modal
      open={open}
      title="添加活动记录"
      description="补记已经完成的工作、学习或休息时间。"
      onClose={onClose}
      footer={<><button className="button button-secondary" type="button" onClick={onClose}>取消</button><button className="button button-primary" type="button" disabled={!valid || busy} onClick={() => void onCreate({ title: title.trim(), notes: notes.trim(), startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() })}>{busy ? <Spinner /> : <Icon name="check" />}保存记录</button></>}
    >
      <div className="entry-form">
        <label className="form-field form-field-full"><span>做了什么</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理本周实验结果" maxLength={100} /></label>
        <div className="inline-fields">
          <label className="form-field"><span>开始时间</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
          <label className="form-field"><span>结束时间</span><input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>
        </div>
        {startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime() && <p className="field-error">结束时间必须晚于开始时间。</p>}
        <label className="form-field form-field-full"><span>备注 <small>选填</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="记下结果、上下文或接下来的计划……" maxLength={500} /></label>
        <div className="modal-sync-note"><Icon name={autoSync ? 'cloud' : 'info'} /><span>{autoSync ? '保存后会自动同步到已连接的 Notion 数据库。' : '这条记录会先安全地保存在本机。'}</span></div>
      </div>
    </Modal>
  );
}
