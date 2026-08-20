export type TimerMode = 'countdown' | 'countup'
export type TimerStatus = 'running' | 'paused'
export type EntryKind = 'pomodoro' | 'manual' | 'external'
export type EntrySource = 'local' | 'notion'
export type SyncStatus = 'local' | 'pending' | 'synced' | 'error'

export interface Preset {
  id: string
  name: string
  durationSeconds: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface TimerSession {
  id: string
  mode: TimerMode
  status: TimerStatus
  title: string
  presetId?: string
  plannedDurationMs: number | null
  startedAt: string
  runningSince: string | null
  accumulatedMs: number
  autoSync: boolean
}

export interface CalendarEntry {
  id: string
  kind: EntryKind
  source: EntrySource
  title: string
  notes: string
  startAt: string
  endAt: string
  focusMs?: number
  plannedDurationMs?: number
  timerMode?: TimerMode
  syncStatus: SyncStatus
  notionPageId?: string
  lastSyncError?: string
  createdAt: string
  updatedAt: string
}

export interface NotionSettings {
  databaseId: string
  databaseName?: string
  connected: boolean
  tokenConfigured: boolean
  autoSyncPomodoros: boolean
  autoSyncManual: boolean
  titleProperty?: string
  dateProperty?: string
  lastSyncedAt?: string
  lastError?: string
}

export interface AppSettings {
  notion: NotionSettings
}

export interface AppSnapshot {
  version: number
  presets: Preset[]
  activeTimer: TimerSession | null
  entries: CalendarEntry[]
  settings: AppSettings
}

export interface TimerStartInput {
  mode: TimerMode
  durationSeconds?: number
  title: string
  presetId?: string
  autoSync?: boolean
}

export interface PresetInput {
  id?: string
  name: string
  durationSeconds: number
  isDefault?: boolean
}

export interface ManualEntryInput {
  title: string
  notes: string
  startAt: string
  endAt: string
}

export interface NotionSettingsInput {
  databaseId: string
  token?: string
  autoSyncPomodoros: boolean
  autoSyncManual: boolean
}

export interface NotionTestInput {
  databaseId: string
  token?: string
}

export interface NotionTestResult {
  ok: boolean
  message: string
  databaseName?: string
  titleProperty?: string
  dateProperty?: string
}

export interface PersonalToolAPI {
  getSnapshot(): Promise<AppSnapshot>
  timerStart(input: TimerStartInput): Promise<AppSnapshot>
  timerPause(): Promise<AppSnapshot>
  timerResume(): Promise<AppSnapshot>
  timerFinish(): Promise<AppSnapshot>
  timerReset(): Promise<AppSnapshot>
  savePreset(input: PresetInput): Promise<AppSnapshot>
  deletePreset(id: string): Promise<AppSnapshot>
  createEntry(input: ManualEntryInput): Promise<AppSnapshot>
  deleteEntry(id: string): Promise<AppSnapshot>
  updateNotionSettings(input: NotionSettingsInput): Promise<AppSnapshot>
  testNotion(input: NotionTestInput): Promise<NotionTestResult>
  syncNotion(): Promise<AppSnapshot>
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void
}
