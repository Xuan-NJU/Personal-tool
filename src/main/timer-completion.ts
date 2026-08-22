import type { AppSnapshot, CalendarEntry, TimerCompletion } from '../shared/types'
import { elapsedMs, isTimerDue } from '../shared/timer'

export interface CompleteActiveTimerOptions {
  automatic: boolean
  nowMs?: number
  expectedTimerId?: string
}

export interface CompleteActiveTimerResult {
  entry: CalendarEntry
  shouldSync: boolean
}

/**
 * Completes the active timer as one in-memory state transition.
 *
 * The caller remains responsible for persisting the mutated snapshot and for
 * performing post-commit effects such as notifications and remote sync.
 */
export function completeActiveTimer(
  draft: AppSnapshot,
  options: CompleteActiveTimerOptions
): CompleteActiveTimerResult | null {
  const timer = draft.activeTimer
  if (!timer) return null
  if (options.expectedTimerId && timer.id !== options.expectedTimerId) return null

  const nowMs = options.nowMs ?? Date.now()
  if (options.automatic && !isTimerDue(timer, nowMs)) return null

  const measuredMs = elapsedMs(timer, nowMs)
  const plannedDurationMs = timer.plannedDurationMs
  const reachedCountdownEnd =
    timer.mode === 'countdown' &&
    plannedDurationMs !== null &&
    measuredMs >= plannedDurationMs
  const focusMs: number = reachedCountdownEnd && plannedDurationMs !== null ? plannedDurationMs : measuredMs
  const logicalEndMs =
    options.automatic && reachedCountdownEnd
      ? nowMs - Math.max(0, measuredMs - focusMs)
      : nowMs
  const startMs = new Date(timer.startedAt).getTime()
  const endMs = Math.max(startMs + 1_000, logicalEndMs)
  const recordedAt = new Date(nowMs).toISOString()

  const notionSettings = draft.settings.notion
  const shouldSync =
    timer.autoSync &&
    notionSettings.autoSyncPomodoros &&
    notionSettings.tokenConfigured &&
    Boolean(notionSettings.databaseId)

  const entry: CalendarEntry = {
    id: crypto.randomUUID(),
    kind: 'pomodoro',
    source: 'local',
    title: timer.title,
    notes: '',
    startAt: timer.startedAt,
    endAt: new Date(endMs).toISOString(),
    focusMs,
    ...(plannedDurationMs === null ? {} : { plannedDurationMs }),
    timerMode: timer.mode,
    syncStatus: shouldSync ? 'pending' : 'local',
    ...(shouldSync ? { notionDatabaseId: notionSettings.databaseId } : {}),
    createdAt: recordedAt,
    updatedAt: recordedAt
  }

  draft.entries.push(entry)
  draft.activeTimer = null

  if (options.automatic && reachedCountdownEnd) {
    const completion: TimerCompletion = {
      id: crypto.randomUUID(),
      entryId: entry.id,
      timerId: timer.id,
      title: timer.title,
      focusMs,
      ...(plannedDurationMs === null ? {} : { plannedDurationMs }),
      completedAt: entry.endAt
    }
    draft.pendingTimerCompletion = completion
  }

  return { entry, shouldSync }
}
