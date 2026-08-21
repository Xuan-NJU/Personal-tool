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

export function normalizeSnapshot(snapshot: AppSnapshot): UiSnapshot {
  const notion = snapshot.settings.notion;
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
      status: !notion.connected ? 'disconnected' : notion.lastError ? 'error' : notion.lastSyncedAt ? 'synced' : 'idle',
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
  return Math.floor((remaining ?? elapsedMs(timer.raw, now)) / 1_000);
}
