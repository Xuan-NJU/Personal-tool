import type { TimerSession } from './types'

export function elapsedMs(timer: TimerSession, nowMs = Date.now()): number {
  const currentRun =
    timer.status === 'running' && timer.runningSince
      ? Math.max(0, nowMs - new Date(timer.runningSince).getTime())
      : 0
  return Math.max(0, timer.accumulatedMs + currentRun)
}

export function remainingMs(timer: TimerSession, nowMs = Date.now()): number | null {
  if (timer.mode !== 'countdown' || timer.plannedDurationMs === null) return null
  return Math.max(0, timer.plannedDurationMs - elapsedMs(timer, nowMs))
}

export function isTimerDue(timer: TimerSession, nowMs = Date.now()): boolean {
  const remaining = remainingMs(timer, nowMs)
  return timer.status === 'running' && remaining !== null && remaining <= 0
}
