import { describe, expect, it } from 'vitest'
import type { TimerSession } from '../shared/types'
import { timerDisplaySeconds, type UiTimerSession } from './model'

function uiTimer(rawOverrides: Partial<TimerSession> = {}): UiTimerSession {
  const raw: TimerSession = {
    id: 'timer-1',
    mode: 'countdown',
    status: 'running',
    title: 'Focus',
    plannedDurationMs: 1_000,
    startedAt: '2026-08-22T00:00:00.000Z',
    runningSince: '2026-08-22T00:00:00.000Z',
    accumulatedMs: 0,
    autoSync: false,
    ...rawOverrides
  }
  return {
    raw,
    id: raw.id,
    title: raw.title,
    mode: raw.mode,
    status: raw.status,
    durationSeconds: raw.plannedDurationMs === null ? undefined : raw.plannedDurationMs / 1_000,
    startedAt: Date.parse(raw.startedAt),
    autoSync: raw.autoSync
  }
}

describe('timerDisplaySeconds', () => {
  it('does not show 00:00 before a countdown is actually due', () => {
    const timer = uiTimer()

    expect(timerDisplaySeconds(timer, Date.parse('2026-08-22T00:00:00.999Z'))).toBe(1)
    expect(timerDisplaySeconds(timer, Date.parse('2026-08-22T00:00:01.000Z'))).toBe(0)
  })

  it('continues to floor elapsed time for a count-up timer', () => {
    const timer = uiTimer({ mode: 'countup', plannedDurationMs: null })

    expect(timerDisplaySeconds(timer, Date.parse('2026-08-22T00:00:01.999Z'))).toBe(1)
  })
})
