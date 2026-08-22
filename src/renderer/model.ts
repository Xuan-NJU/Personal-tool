import type {
  AppSnapshot,
  CalendarEntry,
  DailyTodo,
  NotionSettings,
  Preset,
  ResearchIdea,
  TimerMode,
  TimerSession,
} from '../shared/types';
import { elapsedMs, remainingMs } from '../shared/timer';

export type { AppSnapshot, CalendarEntry, DailyTodo, NotionSettings, Preset, ResearchIdea, TimerMode, TimerSession };

export interface UiTimerSession {
  raw: TimerSession;
  id: string;
  title: string;
  mode: TimerMode;
  status: TimerSession['status'];
  durationSeconds?: number;
  startedAt: number;
  autoSync: boolean;
}

export interface UiCalendarEntry {
  raw: CalendarEntry;
  id: string;
  title: string;
  notes: string;
  startAt: number;
  endAt: number;
  source: 'timer' | 'manual' | 'remote';
  syncStatus: 'local' | 'pending' | 'synced' | 'error';
  syncError?: string;
  focusSeconds?: number;
}

export interface UiNotionSettings extends NotionSettings {
  connectionState: 'disconnected' | 'connected' | 'degraded';
  status: 'disconnected' | 'idle' | 'synced' | 'error';
  error?: string;
}

export interface UiSnapshot {
  raw: AppSnapshot;
  presets: Preset[];
  activeTimer: UiTimerSession | null;
  entries: UiCalendarEntry[];
  todos: DailyTodo[];
  ideas: ResearchIdea[];
  notion: UiNotionSettings;
}

export function toEpoch(value: string | number | undefined | null): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeTimer(timer: TimerSession | null): UiTimerSession | null {
  if (!timer) return null;
  return {
    raw: timer,
    id: timer.id,
    title: timer.title || '专注时间',
    mode: timer.mode,
    status: timer.status,
    durationSeconds:
      timer.plannedDurationMs === null ? undefined : Math.max(0, Math.round(timer.plannedDurationMs / 1_000)),
    startedAt: toEpoch(timer.startedAt) ?? Date.now(),
    autoSync: timer.autoSync,
  };
}

function normalizeEntry(entry: CalendarEntry): UiCalendarEntry | null {
  const startAt = toEpoch(entry.startAt);
  const endAt = toEpoch(entry.endAt);
  if (startAt === undefined || endAt === undefined || endAt <= startAt) return null;
  return {
    raw: entry,
    id: entry.id,
    title: entry.title || (entry.kind === 'pomodoro' ? '专注时间' : '未命名活动'),
    notes: entry.notes,
    startAt,
    endAt,
    source: entry.kind === 'pomodoro' ? 'timer' : entry.kind === 'external' ? 'remote' : 'manual',
    syncStatus: entry.syncStatus,
    syncError: entry.lastSyncError,
    focusSeconds: entry.focusMs === undefined ? undefined : Math.round(entry.focusMs / 1_000),
  };
}

function notionConnectionState(notion: NotionSettings): UiNotionSettings['connectionState'] {
  if (notion.connected) return notion.lastError ? 'degraded' : 'connected';

  // Older snapshots marked every network/sync failure as disconnected. Preserve the
  // last verified connection for retryable failures, while keeping credential,
  // permission, and database errors in the disconnected state.
  const connectionMustBeChecked = /密钥无效|已失效|没有访问目标数据库的权限|找不到数据库|\b(?:401|403|404)\b|unauthori[sz]ed|forbidden/i.test(
    notion.lastError ?? '',
  );
  const wasVerified = Boolean(
    notion.databaseId
      && notion.tokenConfigured
      && (notion.databaseName || notion.lastSyncedAt || (notion.titleProperty && notion.dateProperty)),
  );
  return notion.lastError && wasVerified && !connectionMustBeChecked ? 'degraded' : 'disconnected';
}

export function normalizeSnapshot(snapshot: AppSnapshot): UiSnapshot {
  const notion = snapshot.settings.notion;
  const connectionState = notionConnectionState(notion);
  return {
    raw: snapshot,
    presets: snapshot.presets,
    activeTimer: normalizeTimer(snapshot.activeTimer),
    entries: snapshot.entries
      .map(normalizeEntry)
      .filter((entry): entry is UiCalendarEntry => Boolean(entry))
      .sort((a, b) => a.startAt - b.startAt),
    todos: [...(snapshot.todos ?? [])].sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
      const priority = { high: 0, medium: 1, low: 2 } as const;
      return priority[a.priority] - priority[b.priority] || a.createdAt.localeCompare(b.createdAt);
    }),
    ideas: [...(snapshot.ideas ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    notion: {
      ...notion,
      connectionState,
      status: connectionState === 'disconnected' ? 'disconnected' : notion.lastError ? 'error' : notion.lastSyncedAt ? 'synced' : 'idle',
      error: notion.lastError,
    },
  };
}

export function elapsedSeconds(timer: UiTimerSession | null, now: number): number {
  return timer ? Math.floor(elapsedMs(timer.raw, now) / 1_000) : 0;
}

export function timerDisplaySeconds(timer: UiTimerSession | null, now: number): number {
  if (!timer) return 0;
  const remaining = remainingMs(timer.raw, now);
  return remaining === null
    ? Math.floor(elapsedMs(timer.raw, now) / 1_000)
    : Math.ceil(remaining / 1_000);
}
