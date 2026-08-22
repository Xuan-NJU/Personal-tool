import { describe, expect, it } from 'vitest'
import type { AppSnapshot, TimerSession } from '../shared/types'
import { completeActiveTimer } from './timer-completion'

const START = '2026-08-21T00:00:00.000Z'
const PLANNED_MS = 25 * 60_000

function timer(overrides: Partial<TimerSession> = {}): TimerSession {
  return {
    id: 'timer-1',
    mode: 'countdown',
    status: 'running',
    title: 'Deep work',
    plannedDurationMs: PLANNED_MS,
    startedAt: START,
    runningSince: START,
    accumulatedMs: 0,
    autoSync: true,
    ...overrides
  }
}

function snapshot(activeTimer: TimerSession | null = timer()): AppSnapshot {
  return {
    version: 3,
    presets: [],
    activeTimer,
    pendingTimerCompletion: null,
    entries: [],
    todos: [],
    ideas: [],
    notionDeletions: [],
    settings: {
      notion: {
        databaseId: 'database-1',
        connected: true,
        tokenConfigured: true,
        autoSyncPomodoros: true,
        autoSyncManual: true
      },
      reminders: {
        systemNotification: true,
        playSound: true,
        showWindow: false,
        flashTaskbar: true
      }
    }
  }
}

describe('completeActiveTimer', () => {
  it('completes an overdue countdown at its logical deadline and queues one completion', () => {
    const draft = snapshot()
    const nowMs = Date.parse('2026-08-21T00:30:00.000Z')

    const result = completeActiveTimer(draft, {
      automatic: true,
      nowMs,
      expectedTimerId: 'timer-1'
    })

    expect(result).not.toBeNull()
    expect(result?.shouldSync).toBe(true)
    expect(result?.entry).toMatchObject({
      kind: 'pomodoro',
      source: 'local',
      title: 'Deep work',
      startAt: START,
      endAt: '2026-08-21T00:25:00.000Z',
      focusMs: PLANNED_MS,
      plannedDurationMs: PLANNED_MS,
      timerMode: 'countdown',
      syncStatus: 'pending',
      notionDatabaseId: 'database-1',
      createdAt: '2026-08-21T00:30:00.000Z',
      updatedAt: '2026-08-21T00:30:00.000Z'
    })
    expect(draft.activeTimer).toBeNull()
    expect(draft.entries).toEqual([result?.entry])
    expect(draft.pendingTimerCompletion).toMatchObject({
      entryId: result?.entry.id,
      timerId: 'timer-1',
      title: 'Deep work',
      focusMs: PLANNED_MS,
      plannedDurationMs: PLANNED_MS,
      completedAt: '2026-08-21T00:25:00.000Z'
    })
  })

  it('uses accumulated focus time to truncate a delayed completion after a pause', () => {
    const draft = snapshot(
      timer({
        accumulatedMs: 10 * 60_000,
        runningSince: '2026-08-21T01:00:00.000Z'
      })
    )

    const result = completeActiveTimer(draft, {
      automatic: true,
      nowMs: Date.parse('2026-08-21T01:20:00.000Z')
    })

    expect(result?.entry.endAt).toBe('2026-08-21T01:15:00.000Z')
    expect(result?.entry.focusMs).toBe(PLANNED_MS)
    expect(draft.pendingTimerCompletion?.completedAt).toBe('2026-08-21T01:15:00.000Z')
  })

  it('is idempotent after the active timer has been completed', () => {
    const draft = snapshot()
    const options = { automatic: true, nowMs: Date.parse('2026-08-21T00:25:00.000Z') }

    const first = completeActiveTimer(draft, options)
    const completion = structuredClone(draft.pendingTimerCompletion)
    const second = completeActiveTimer(draft, options)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(draft.entries).toHaveLength(1)
    expect(draft.pendingTimerCompletion).toEqual(completion)
  })

  it.each([
    ['not yet due', timer(), Date.parse('2026-08-21T00:24:59.999Z'), undefined],
    [
      'paused',
      timer({ status: 'paused', runningSince: null, accumulatedMs: PLANNED_MS }),
      Date.parse('2026-08-21T00:30:00.000Z'),
      undefined
    ],
    [
      'count-up',
      timer({ mode: 'countup', plannedDurationMs: null }),
      Date.parse('2026-08-21T01:00:00.000Z'),
      undefined
    ],
    ['stale timer id', timer(), Date.parse('2026-08-21T00:30:00.000Z'), 'timer-old']
  ] as const)('does not automatically complete when the timer is %s', (_label, activeTimer, nowMs, expectedTimerId) => {
    const draft = snapshot(activeTimer)
    const before = structuredClone(draft)

    const result = completeActiveTimer(draft, { automatic: true, nowMs, expectedTimerId })

    expect(result).toBeNull()
    expect(draft).toEqual(before)
  })

  it('does nothing when there is no active timer', () => {
    const draft = snapshot(null)
    const before = structuredClone(draft)

    expect(completeActiveTimer(draft, { automatic: true, nowMs: Date.now() })).toBeNull()
    expect(draft).toEqual(before)
  })

  it('manually completes a countdown without creating or replacing a pending completion', () => {
    const draft = snapshot()
    draft.pendingTimerCompletion = {
      id: 'existing-completion',
      entryId: 'existing-entry',
      timerId: 'existing-timer',
      title: 'Earlier session',
      focusMs: 60_000,
      completedAt: '2026-08-20T00:01:00.000Z'
    }
    draft.settings.notion.autoSyncPomodoros = false

    const result = completeActiveTimer(draft, {
      automatic: false,
      nowMs: Date.parse('2026-08-21T00:10:00.000Z')
    })

    expect(result?.shouldSync).toBe(false)
    expect(result?.entry).toMatchObject({
      endAt: '2026-08-21T00:10:00.000Z',
      focusMs: 10 * 60_000,
      syncStatus: 'local'
    })
    expect(result?.entry).not.toHaveProperty('notionDatabaseId')
    expect(draft.pendingTimerCompletion?.id).toBe('existing-completion')
  })

  it('manually completes a count-up timer using its measured duration', () => {
    const draft = snapshot(timer({ mode: 'countup', plannedDurationMs: null, autoSync: false }))

    const result = completeActiveTimer(draft, {
      automatic: false,
      nowMs: Date.parse('2026-08-21T01:00:00.000Z')
    })

    expect(result?.entry).toMatchObject({
      endAt: '2026-08-21T01:00:00.000Z',
      focusMs: 60 * 60_000,
      timerMode: 'countup',
      syncStatus: 'local'
    })
    expect(result?.entry).not.toHaveProperty('plannedDurationMs')
    expect(draft.pendingTimerCompletion).toBeNull()
  })
})
