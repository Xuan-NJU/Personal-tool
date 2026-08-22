export type TimerMode = 'countdown' | 'countup'
export type TimerStatus = 'running' | 'paused'
export type EntryKind = 'pomodoro' | 'manual' | 'external'
export type EntrySource = 'local' | 'notion'
export type SyncStatus = 'local' | 'pending' | 'synced' | 'error'
export type TodoPriority = 'low' | 'medium' | 'high'
export type ResearchIdeaStatus = 'seed' | 'exploring' | 'validated' | 'archived'

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
  notionDatabaseId?: string
  lastSyncError?: string
  createdAt: string
  updatedAt: string
}

export interface DailyTodo {
  id: string
  dateKey: string
  title: string
  notes: string
  priority: TodoPriority
  completed: boolean
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ResearchIdea {
  id: string
  title: string
  summary: string
  tags: string[]
  status: ResearchIdeaStatus
  createdAt: string
  updatedAt: string
}

export interface NotionDeletion {
  id: string
  entryId: string
  notionPageId?: string
  databaseId?: string
  title: string
  startAt: string
  endAt: string
  requestedAt: string
  lastAttemptAt?: string
  lastError?: string
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

export interface ReminderSettings {
  systemNotification: boolean
  playSound: boolean
  showWindow: boolean
  flashTaskbar: boolean
}

export interface TimerCompletion {
  id: string
  entryId: string
  timerId: string
  title: string
  focusMs: number
  plannedDurationMs?: number
  completedAt: string
}

export interface AppSettings {
  notion: NotionSettings
  reminders: ReminderSettings
}

export interface AppSnapshot {
  version: number
  presets: Preset[]
  activeTimer: TimerSession | null
  pendingTimerCompletion: TimerCompletion | null
  entries: CalendarEntry[]
  todos: DailyTodo[]
  ideas: ResearchIdea[]
  notionDeletions: NotionDeletion[]
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

export interface DailyTodoInput {
  id?: string
  dateKey: string
  title: string
  notes: string
  priority: TodoPriority
}

export interface ResearchIdeaInput {
  id?: string
  title: string
  summary: string
  tags: string[]
  status: ResearchIdeaStatus
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

export interface ReminderSettingsInput {
  systemNotification: boolean
  playSound: boolean
  showWindow: boolean
  flashTaskbar: boolean
}

export interface PersonalToolAPI {
  getSnapshot(): Promise<AppSnapshot>
  timerStart(input: TimerStartInput): Promise<AppSnapshot>
  timerPause(): Promise<AppSnapshot>
  timerResume(): Promise<AppSnapshot>
  timerFinish(): Promise<AppSnapshot>
  timerReset(): Promise<AppSnapshot>
  acknowledgeTimerCompletion(id: string): Promise<AppSnapshot>
  savePreset(input: PresetInput): Promise<AppSnapshot>
  deletePreset(id: string): Promise<AppSnapshot>
  createEntry(input: ManualEntryInput): Promise<AppSnapshot>
  deleteEntry(id: string): Promise<AppSnapshot>
  saveTodo(input: DailyTodoInput): Promise<AppSnapshot>
  toggleTodo(id: string): Promise<AppSnapshot>
  deleteTodo(id: string): Promise<AppSnapshot>
  saveIdea(input: ResearchIdeaInput): Promise<AppSnapshot>
  deleteIdea(id: string): Promise<AppSnapshot>
  updateReminderSettings(input: ReminderSettingsInput): Promise<AppSnapshot>
  updateNotionSettings(input: NotionSettingsInput): Promise<AppSnapshot>
  testNotion(input: NotionTestInput): Promise<NotionTestResult>
  syncNotion(): Promise<AppSnapshot>
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void
}
