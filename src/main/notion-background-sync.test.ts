import { describe, expect, it } from 'vitest'
import type { AppSnapshot, CalendarEntry, NotionDeletion } from '../shared/types'
import {
  NOTION_BACKGROUND_HEALTHCHECK_MS,
  shouldRunNotionBackgroundSync
} from './notion-background-sync'

const NOW = Date.parse('2026-08-21T06:00:00.000Z')
const DATABASE_ID = 'database-current'

function snapshot(overrides: Partial<AppSnapshot['settings']['notion']> = {}): AppSnapshot {
  return {
    version: 3,
    presets: [],
    activeTimer: null,
    pendingTimerCompletion: null,
    entries: [],
    todos: [],
    ideas: [],
    notionDeletions: [],
    settings: {
      reminders: {
        systemNotification: true,
        playSound: true,
        showWindow: true,
        flashTaskbar: true
      },
      notion: {
        databaseId: DATABASE_ID,
        connected: false,
        tokenConfigured: true,
        autoSyncPomodoros: true,
        autoSyncManual: true,
        ...overrides
      }
    }
  }
}

function entry(syncStatus: CalendarEntry['syncStatus'], notionDatabaseId?: string): CalendarEntry {
  return {
    id: `entry-${syncStatus}-${notionDatabaseId ?? 'legacy'}`,
    kind: 'manual',
    source: 'local',
    title: 'Entry',
    notes: '',
    startAt: '2026-08-21T01:00:00.000Z',
    endAt: '2026-08-21T02:00:00.000Z',
    syncStatus,
    ...(notionDatabaseId ? { notionDatabaseId } : {}),
    createdAt: '2026-08-21T01:00:00.000Z',
    updatedAt: '2026-08-21T01:00:00.000Z'
  }
}

function deletion(databaseId?: string): NotionDeletion {
  return {
    id: `deletion-${databaseId ?? 'legacy'}`,
    entryId: 'deleted-entry',
    ...(databaseId ? { databaseId } : {}),
    title: 'Deleted entry',
    startAt: '2026-08-21T01:00:00.000Z',
    endAt: '2026-08-21T02:00:00.000Z',
    requestedAt: '2026-08-21T03:00:00.000Z'
  }
}

describe('shouldRunNotionBackgroundSync', () => {
  it.each(['pending', 'error'] as const)('runs for a current-database %s entry', (syncStatus) => {
    const value = snapshot()
    value.entries.push(entry(syncStatus, DATABASE_ID))
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(true)
  })

  it('treats unbound queued entries and deletions as legacy data for the current database', () => {
    const withEntry = snapshot()
    withEntry.entries.push(entry('pending'))
    expect(shouldRunNotionBackgroundSync(withEntry, NOW)).toBe(true)

    const withDeletion = snapshot()
    withDeletion.notionDeletions.push(deletion())
    expect(shouldRunNotionBackgroundSync(withDeletion, NOW)).toBe(true)
  })

  it('runs for a deletion bound to the current database', () => {
    const value = snapshot()
    value.notionDeletions.push(deletion(DATABASE_ID))
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(true)
  })

  it('ignores queues that belong only to another database', () => {
    const value = snapshot()
    value.entries.push(entry('error', 'database-old'))
    value.notionDeletions.push(deletion('database-old'))
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(false)
  })

  it('retries an error for a connection that is still known to be connected', () => {
    const value = snapshot({
      connected: true,
      lastError: 'Notion 暂时不可达',
      lastSyncedAt: new Date(NOW - 30_000).toISOString()
    })
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(true)
  })

  it('runs a connected health check at five minutes, but not just before it', () => {
    const due = snapshot({
      connected: true,
      lastSyncedAt: new Date(NOW - NOTION_BACKGROUND_HEALTHCHECK_MS).toISOString()
    })
    const notDue = snapshot({
      connected: true,
      lastSyncedAt: new Date(NOW - NOTION_BACKGROUND_HEALTHCHECK_MS + 1).toISOString()
    })
    expect(shouldRunNotionBackgroundSync(due, NOW)).toBe(true)
    expect(shouldRunNotionBackgroundSync(notDue, NOW)).toBe(false)
  })

  it('treats a connected configuration with no valid sync timestamp as due', () => {
    expect(shouldRunNotionBackgroundSync(snapshot({ connected: true }), NOW)).toBe(true)
    expect(
      shouldRunNotionBackgroundSync(snapshot({ connected: true, lastSyncedAt: 'not-a-date' }), NOW)
    ).toBe(true)
  })

  it('runs for a legacy known connection even when its connected flag is false', () => {
    const value = snapshot({
      connected: false,
      databaseName: 'Research calendar',
      titleProperty: 'Name',
      dateProperty: 'When'
    })
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(true)
  })

  it('does not infer a legacy connection from incomplete metadata', () => {
    const value = snapshot({
      connected: false,
      databaseName: 'Research calendar',
      titleProperty: 'Name'
    })
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(false)
  })

  it('requires both a configured token and a non-empty database id', () => {
    const withoutToken = snapshot({ tokenConfigured: false, connected: true })
    withoutToken.entries.push(entry('pending', DATABASE_ID))
    expect(shouldRunNotionBackgroundSync(withoutToken, NOW)).toBe(false)

    const withoutDatabase = snapshot({ databaseId: '   ', connected: true })
    withoutDatabase.notionDeletions.push(deletion())
    expect(shouldRunNotionBackgroundSync(withoutDatabase, NOW)).toBe(false)
  })

  it('stays idle for a healthy recent connection with no current work', () => {
    const value = snapshot({
      connected: true,
      lastSyncedAt: new Date(NOW - 60_000).toISOString()
    })
    value.entries.push(entry('synced', DATABASE_ID), entry('local', DATABASE_ID))
    expect(shouldRunNotionBackgroundSync(value, NOW)).toBe(false)
  })
})
