import type { AppSnapshot, NotionSettings } from '../shared/types'

export const NOTION_BACKGROUND_HEALTHCHECK_MS = 5 * 60_000

function belongsToDatabase(boundDatabaseId: string | undefined, currentDatabaseId: string): boolean {
  return !boundDatabaseId || boundDatabaseId === currentDatabaseId
}

function hasKnownLegacyConnection(settings: NotionSettings): boolean {
  return (
    !settings.connected &&
    Boolean(settings.databaseName?.trim()) &&
    Boolean(settings.titleProperty?.trim()) &&
    Boolean(settings.dateProperty?.trim())
  )
}

function healthCheckIsDue(settings: NotionSettings, nowMs: number): boolean {
  if (!settings.connected) return false
  const lastSyncedAt = settings.lastSyncedAt ? Date.parse(settings.lastSyncedAt) : Number.NaN
  if (!Number.isFinite(lastSyncedAt)) return true
  if (!Number.isFinite(nowMs)) return false
  return nowMs - lastSyncedAt >= NOTION_BACKGROUND_HEALTHCHECK_MS
}

/**
 * Decides whether the main process should start a background Notion sync.
 *
 * Unbound records are legacy data and are treated as belonging to the currently
 * configured database. `nowMs` is injected so the decision remains pure and
 * deterministic.
 */
export function shouldRunNotionBackgroundSync(snapshot: AppSnapshot, nowMs: number): boolean {
  const settings = snapshot.settings.notion
  const databaseId = settings.databaseId.trim()
  if (!settings.tokenConfigured || !databaseId) return false

  const hasQueuedEntries = snapshot.entries.some(
    (entry) =>
      (entry.syncStatus === 'pending' || entry.syncStatus === 'error') &&
      belongsToDatabase(entry.notionDatabaseId, databaseId)
  )
  const hasQueuedDeletions = snapshot.notionDeletions.some((deletion) =>
    belongsToDatabase(deletion.databaseId, databaseId)
  )
  const shouldRetryConnectedError = settings.connected && Boolean(settings.lastError?.trim())

  return (
    hasQueuedEntries ||
    hasQueuedDeletions ||
    shouldRetryConnectedError ||
    healthCheckIsDue(settings, nowMs) ||
    hasKnownLegacyConnection(settings)
  )
}
