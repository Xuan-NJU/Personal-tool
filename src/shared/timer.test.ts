import { describe, expect, it } from 'vitest'
import { elapsedMs, isTimerDue, remainingMs } from './timer'
import type { TimerSession } from './types'

function timer(overrides: Partial<TimerSession> = {}): TimerSession {
  return {
    id: 'timer-1',
    mode: 'countdown',
    status: 'running',
    title: 'Deep work',
    plannedDurationMs: 25 * 60_000,
    startedAt: '2026-08-20T00:00:00.000Z',
    runningSince: '2026-08-20T00:05:00.000Z',
    accumulatedMs: 5 * 60_000,
    autoSync: true,
    ...overrides
  }
}

describe('timer calculations', () => {
  it('derives elapsed time from persisted timestamps', () => {
    expect(elapsedMs(timer(), Date.parse('2026-08-20T00:10:00.000Z'))).toBe(10 * 60_000)
  })

  it('does not advance while paused', () => {
    const paused = timer({ status: 'paused', runningSince: null, accumulatedMs: 8_000 })
    expect(elapsedMs(paused, Date.parse('2026-08-21T00:00:00.000Z'))).toBe(8_000)
  })

  it('clamps countdown at zero and reports due', () => {
    const due = timer({ plannedDurationMs: 60_000, accumulatedMs: 50_000 })
    const now = Date.parse('2026-08-20T00:05:11.000Z')
    expect(remainingMs(due, now)).toBe(0)
    expect(isTimerDue(due, now)).toBe(true)
  })

  it('has no remaining value in count-up mode', () => {
    expect(remainingMs(timer({ mode: 'countup', plannedDurationMs: null }))).toBeNull()
  })
})
