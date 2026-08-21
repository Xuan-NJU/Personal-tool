import type {
  AppSnapshot,
  CalendarEntry,
  NotionDeletion,
  NotionSettingsInput,
  NotionTestInput,
  NotionTestResult
} from '../shared/types'
import { classifyNotionError, planNotionRetry } from './notion-retry'
import { AppStore } from './store'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const UNRESOLVED_DELETION_RETENTION_MS = 24 * 60 * 60_000
const NOTION_REQUEST_TIMEOUT_MS = 20_000
const NOTION_REQUEST_MAX_RETRIES = 2

function formatDurationMs(durationMs: number): string {
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))} 秒`
  return `${Math.max(1, Math.round(durationMs / 60_000))} 分钟`
}

interface NotionPropertySchema {
  id: string
  name: string
  type: string
}

interface NotionDatabase {
  id: string
  title?: Array<{ plain_text?: string }>
  properties: Record<string, NotionPropertySchema>
}

interface NotionPage {
  id: string
  created_time: string
  last_edited_time: string
  archived?: boolean
  properties: Record<string, unknown>
}

interface DatabaseInfo {
  id: string
  name: string
  titleProperty: string
  dateProperty: string
}

type NotionFetch = (input: string, init?: RequestInit) => Promise<Response>

class NotionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'NotionRequestError'
  }
}

class NotionConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotionConfigurationError'
  }
}

class NotionTransportError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'NotionTransportError'
  }
}

class DatabaseChangedDuringSyncError extends Error {
  constructor() {
    super('Notion 数据库已变更，已放弃本轮旧数据库的同步结果。')
    this.name = 'DatabaseChangedDuringSyncError'
  }
}

interface DeletionFlushResult {
  attemptedDeletionIds: Set<string>
  deletedPageIds: Set<string>
}

function deletionMatchesEntry(
  deletion: NotionDeletion,
  entry: CalendarEntry,
  databaseId: string
): boolean {
  if (deletion.databaseId !== databaseId || entry.notionDatabaseId !== databaseId) return false
  if (deletion.entryId === entry.id) return true
  if (deletion.notionPageId && entry.notionPageId) return deletion.notionPageId === entry.notionPageId
  return (
    !deletion.notionPageId &&
    deletion.title === entry.title &&
    deletion.startAt === entry.startAt &&
    deletion.endAt === entry.endAt
  )
}

function bindLegacyNotionData(snapshot: AppSnapshot, databaseId: string): void {
  if (!databaseId) return
  for (const entry of snapshot.entries) {
    if (
      !entry.notionDatabaseId &&
      (entry.source === 'notion' ||
        Boolean(entry.notionPageId) ||
        entry.syncStatus === 'pending' ||
        entry.syncStatus === 'error')
    ) {
      entry.notionDatabaseId = databaseId
    }
  }
  for (const deletion of snapshot.notionDeletions) {
    deletion.databaseId ??= databaseId
  }
}

function isNotionNotFound(error: unknown): boolean {
  return error instanceof NotionRequestError && error.status === 404
}

function isNotionAlreadyArchived(error: unknown): boolean {
  return (
    error instanceof NotionRequestError &&
    error.status === 400 &&
    /already archived|can't edit (?:a )?block that is archived|must unarchive/i.test(error.message)
  )
}

function pendingSyncMessage(snapshot: AppSnapshot, databaseId: string): string | undefined {
  const queuedEntryCount = snapshot.entries.filter(
    (entry) =>
      (entry.syncStatus === 'pending' || entry.syncStatus === 'error') &&
      (!entry.notionDatabaseId || entry.notionDatabaseId === databaseId)
  ).length
  const queuedDeletionCount = snapshot.notionDeletions.filter(
    (deletion) => !deletion.databaseId || deletion.databaseId === databaseId
  ).length
  const messages = [
    queuedEntryCount > 0 ? `${queuedEntryCount} 条记录暂未同步` : '',
    queuedDeletionCount > 0 ? `${queuedDeletionCount} 条删除操作等待同步` : ''
  ].filter(Boolean)
  return messages.length > 0 ? `${messages.join('；')}，将在稍后重试。` : undefined
}

function invalidatesNotionConnection(error: unknown): boolean {
  if (error instanceof NotionConfigurationError) return true
  const category = classifyNotionError(error).category
  return category === 'authentication' || category === 'permission' || category === 'configuration'
}

function hasVerifiedNotionConnection(snapshot: AppSnapshot): boolean {
  const notion = snapshot.settings.notion
  return Boolean(
    notion.connected ||
      (notion.databaseName && notion.titleProperty && notion.dateProperty && notion.lastSyncedAt)
  )
}

function normalizeNotionRequestError(error: unknown, fromRequest = false): Error {
  if (
    error instanceof NotionRequestError ||
    error instanceof NotionConfigurationError ||
    error instanceof NotionTransportError
  ) {
    return error
  }
  const classification = classifyNotionError(error)
  if (fromRequest && classification.category === 'timeout') {
    return new NotionTransportError('连接 Notion 超时，连接配置仍保留，应用将自动重试。', error)
  }
  if (fromRequest && classification.category === 'network') {
    return new NotionTransportError('暂时无法访问 Notion，连接配置仍保留，应用将自动重试。', error)
  }
  return error instanceof Error ? error : new Error('Notion 请求失败。')
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function notionError(status: number, payload: unknown): Error {
  const body = payload as { message?: string; code?: string }
  const suffix = body.message || body.code || `HTTP ${status}`
  if (status === 401) return new NotionRequestError(`Notion 密钥无效或已失效：${suffix}`, status, body.code)
  if (status === 403) {
    return new NotionRequestError(`该集成没有访问目标数据库的权限：${suffix}`, status, body.code)
  }
  if (status === 404) {
    return new NotionRequestError(
      `找不到数据库。请确认数据库 ID，并把数据库共享给该集成：${suffix}`,
      status,
      body.code
    )
  }
  if (status === 429) return new NotionRequestError('Notion 请求过于频繁，请稍后重试。', status, body.code)
  return new NotionRequestError(`Notion 同步失败：${suffix}`, status, body.code)
}

export function normalizeDatabaseId(input: string): string {
  const decoded = decodeURIComponent(input.trim())
  const match = decoded.match(/([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[/?#&]|$)/)
  const compact = (match?.[1] ?? decoded).replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) {
    throw new Error('请输入有效的 Notion 数据库链接或 32 位数据库 ID。')
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase()
}

export function inspectDatabase(database: NotionDatabase): DatabaseInfo {
  const properties = Object.entries(database?.properties ?? {})
  const titleProperty = properties.find(([, property]) => property.type === 'title')?.[0]
  const dateProperty = properties.find(([, property]) => property.type === 'date')?.[0]
  if (!titleProperty || !dateProperty) {
    throw new NotionConfigurationError('目标数据库需要至少包含一个标题属性和一个日期属性。')
  }
  const name = database.title?.map((item) => item.plain_text ?? '').join('').trim() || 'Notion 日历'
  return { id: database.id, name, titleProperty, dateProperty }
}

function textFromProperty(property: unknown, key: 'title' | 'rich_text'): string {
  const object = property as Record<string, unknown> | undefined
  const items = object?.[key] as Array<{ plain_text?: string }> | undefined
  return items?.map((item) => item.plain_text ?? '').join('').trim() ?? ''
}

export function notionPageToEntry(page: NotionPage, info: DatabaseInfo): CalendarEntry | null {
  if (page.archived) return null
  const dateProperty = page.properties[info.dateProperty] as
    | { date?: { start?: string; end?: string | null } | null }
    | undefined
  const start = dateProperty?.date?.start
  if (!start) return null
  const startMs = new Date(start).getTime()
  if (!Number.isFinite(startMs)) return null
  const suppliedEnd = dateProperty?.date?.end
  const endMs = suppliedEnd ? new Date(suppliedEnd).getTime() : startMs + 30 * 60_000
  const title = textFromProperty(page.properties[info.titleProperty], 'title') || 'Notion 事件'

  return {
    id: `notion-${page.id}`,
    kind: 'external',
    source: 'notion',
    title,
    notes: '',
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 30 * 60_000).toISOString(),
    syncStatus: 'synced',
    notionPageId: page.id,
    notionDatabaseId: info.id,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time
  }
}

export class NotionService {
  private databaseRevision = 0
  private settingsUpdatePromise: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: AppStore,
    private readonly fetcher: NotionFetch = (input, init) => globalThis.fetch(input, init)
  ) {}

  saveSettings(input: NotionSettingsInput): Promise<AppSnapshot> {
    // New syncs wait for this serialized update; a real token/database change
    // advances the revision inside saveSettingsNow and invalidates old requests.
    const operation = this.settingsUpdatePromise.then(() => this.saveSettingsNow(input))
    this.settingsUpdatePromise = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  async getSyncKey(): Promise<string> {
    await this.settingsUpdatePromise
    const snapshot = await this.store.getSnapshot()
    return `${this.databaseRevision}:${snapshot.settings.notion.databaseId}`
  }

  private async saveSettingsNow(input: NotionSettingsInput): Promise<AppSnapshot> {
    const databaseId = input.databaseId.trim() ? normalizeDatabaseId(input.databaseId) : ''
    const previous = await this.store.getSnapshot()
    const changedDatabase = previous.settings.notion.databaseId !== databaseId
    const changedToken = Boolean(input.token?.trim())
    const changedConnection = changedDatabase || changedToken
    if (changedConnection) this.databaseRevision += 1
    if (changedToken) await this.store.setNotionToken(input.token as string)

    const snapshot = await this.store.update((draft) => {
      const previousDatabaseId = draft.settings.notion.databaseId
      bindLegacyNotionData(draft, previousDatabaseId || databaseId)
      if (changedDatabase && previousDatabaseId) {
        draft.entries = draft.entries.filter(
          (entry) => !(entry.source === 'notion' && entry.notionDatabaseId === previousDatabaseId)
        )
        const now = new Date().toISOString()
        for (const entry of draft.entries) {
          if (
            entry.notionDatabaseId === previousDatabaseId &&
            (entry.syncStatus === 'pending' || entry.syncStatus === 'error')
          ) {
            entry.syncStatus = 'local'
            delete entry.lastSyncError
            entry.updatedAt = now
          }
        }
      }
      draft.settings.notion.databaseId = databaseId
      draft.settings.notion.autoSyncPomodoros = input.autoSyncPomodoros
      draft.settings.notion.autoSyncManual = input.autoSyncManual
      if (changedConnection) {
        draft.settings.notion.connected = false
        draft.settings.notion.databaseName = undefined
        draft.settings.notion.titleProperty = undefined
        draft.settings.notion.dateProperty = undefined
        draft.settings.notion.lastSyncedAt = undefined
        draft.settings.notion.lastError = undefined
      }
    })
    return snapshot
  }

  async testConnection(input: NotionTestInput): Promise<NotionTestResult> {
    await this.settingsUpdatePromise
    const suppliedToken = input.token?.trim()
    const testRevision = this.databaseRevision
    let token = suppliedToken
    try {
      token ||= await this.store.getNotionToken()
      if (!token) throw new NotionConfigurationError('请先输入 Notion Internal Integration Token。')
      const databaseId = normalizeDatabaseId(input.databaseId)
      const info = await this.fetchDatabase(token, databaseId)
      if (!suppliedToken) {
        if (this.databaseRevision !== testRevision) throw new DatabaseChangedDuringSyncError()
        await this.store.update((draft) => {
          if (this.databaseRevision !== testRevision || draft.settings.notion.databaseId !== databaseId) return
          const pendingMessage = pendingSyncMessage(draft, databaseId)
          Object.assign(draft.settings.notion, {
            connected: true,
            databaseName: info.name,
            titleProperty: info.titleProperty,
            dateProperty: info.dateProperty,
            lastError: pendingMessage
          })
        })
      }
      return {
        ok: true,
        message: `已连接“${info.name}”。`,
        databaseName: info.name,
        titleProperty: info.titleProperty,
        dateProperty: info.dateProperty
      }
    } catch (cause) {
      const error = normalizeNotionRequestError(cause)
      const message = error.message
      if (!suppliedToken) {
        await this.store.update((draft) => {
          let databaseId: string | undefined
          try {
            databaseId = normalizeDatabaseId(input.databaseId)
          } catch {
            databaseId = undefined
          }
          if (
            this.databaseRevision === testRevision &&
            databaseId &&
            draft.settings.notion.databaseId === databaseId
          ) {
            const verified = hasVerifiedNotionConnection(draft)
            if (invalidatesNotionConnection(error)) {
              draft.settings.notion.connected = false
              draft.settings.notion.databaseName = undefined
              draft.settings.notion.titleProperty = undefined
              draft.settings.notion.dateProperty = undefined
              draft.settings.notion.lastSyncedAt = undefined
            } else if (verified) {
              draft.settings.notion.connected = true
            }
            if (!token) draft.settings.notion.tokenConfigured = false
            draft.settings.notion.lastError = message
          }
        })
      }
      return { ok: false, message }
    }
  }

  async syncAll(): Promise<AppSnapshot> {
    await this.settingsUpdatePromise
    const syncRevision = this.databaseRevision
    const syncStartedAt = Date.now()
    const token = await this.store.getNotionToken()
    const before = await this.store.getSnapshot()
    const databaseId = before.settings.notion.databaseId

    try {
      if (!databaseId) throw new NotionConfigurationError('请先在设置中选择 Notion 日历数据库。')
      if (!token) throw new NotionConfigurationError('Notion 密钥不可用，请在设置中重新填写 Token。')
      await this.prepareDatabaseScope(databaseId, syncRevision)
      const info = await this.fetchDatabase(token, databaseId)
      await this.requireCurrentDatabase(databaseId, syncRevision)
      // Validate database access before consuming deletion intents. Notion may
      // report a page as 404 when permissions are missing, not only when deleted.
      const initialDeletionFlush = await this.flushPendingDeletions(token, databaseId, syncRevision)
      const remoteEntries = await this.pullEntries(token, databaseId, info)
      await this.requireCurrentDatabase(databaseId, syncRevision)
      await this.resolvePendingDeletionPageIds(
        remoteEntries,
        initialDeletionFlush.deletedPageIds,
        databaseId,
        syncRevision
      )
      await this.reconcilePendingEntries(
        remoteEntries,
        initialDeletionFlush.deletedPageIds,
        databaseId,
        syncRevision
      )
      await this.pushPendingEntries(
        token,
        databaseId,
        info,
        await this.requireCurrentDatabase(databaseId, syncRevision),
        syncRevision
      )

      await this.store.update((draft) => {
        this.assertCurrentDatabase(draft, databaseId, syncRevision)
        const activeDeletions = draft.notionDeletions.filter((deletion) => deletion.databaseId === databaseId)
        draft.entries = draft.entries.filter(
          (entry) =>
            entry.notionDatabaseId !== databaseId ||
            (!(entry.notionPageId && initialDeletionFlush.deletedPageIds.has(entry.notionPageId)) &&
              !activeDeletions.some((deletion) => deletionMatchesEntry(deletion, entry, databaseId)))
        )
        const byPageId = new Map(
          draft.entries
            .filter((entry) => entry.notionDatabaseId === databaseId && entry.notionPageId)
            .map((entry) => [entry.notionPageId as string, entry])
        )
        for (const remote of remoteEntries) {
          const pageId = remote.notionPageId
          if (
            !pageId ||
            initialDeletionFlush.deletedPageIds.has(pageId) ||
            activeDeletions.some((deletion) => deletionMatchesEntry(deletion, remote, databaseId))
          ) {
            continue
          }
          const existing = byPageId.get(pageId)
          if (!existing) {
            draft.entries.push(remote)
          } else if (existing.source === 'notion') {
            Object.assign(existing, remote)
          }
        }
      })

      await this.flushPendingDeletions(token, databaseId, syncRevision, {
        expireUnresolvedBefore: syncStartedAt - UNRESOLVED_DELETION_RETENTION_MS,
        skipDeletionIds: initialDeletionFlush.attemptedDeletionIds
      })

      return this.store.update((draft) => {
        this.assertCurrentDatabase(draft, databaseId, syncRevision)
        Object.assign(draft.settings.notion, {
          connected: true,
          databaseName: info.name,
          titleProperty: info.titleProperty,
          dateProperty: info.dateProperty,
          lastSyncedAt: new Date().toISOString(),
          lastError: pendingSyncMessage(draft, databaseId)
        })
      })
    } catch (cause) {
      const current = await this.store.getSnapshot()
      if (
        cause instanceof DatabaseChangedDuringSyncError ||
        this.databaseRevision !== syncRevision ||
        current.settings.notion.databaseId !== databaseId
      ) {
        return current
      }
      const error = normalizeNotionRequestError(cause)
      const message = error.message
      await this.store.update((draft) => {
        this.assertCurrentDatabase(draft, databaseId, syncRevision)
        const verified = hasVerifiedNotionConnection(draft)
        if (invalidatesNotionConnection(error)) {
          draft.settings.notion.connected = false
          draft.settings.notion.databaseName = undefined
          draft.settings.notion.titleProperty = undefined
          draft.settings.notion.dateProperty = undefined
          draft.settings.notion.lastSyncedAt = undefined
        } else if (verified) {
          draft.settings.notion.connected = true
        }
        if (!token) draft.settings.notion.tokenConfigured = false
        draft.settings.notion.lastError = message
      })
      throw error
    }
  }

  private assertCurrentDatabase(snapshot: AppSnapshot, databaseId: string, revision: number): void {
    if (this.databaseRevision !== revision || snapshot.settings.notion.databaseId !== databaseId) {
      throw new DatabaseChangedDuringSyncError()
    }
  }

  private async requireCurrentDatabase(databaseId: string, revision: number): Promise<AppSnapshot> {
    const snapshot = await this.store.getSnapshot()
    this.assertCurrentDatabase(snapshot, databaseId, revision)
    return snapshot
  }

  private async prepareDatabaseScope(databaseId: string, revision: number): Promise<void> {
    await this.store.update((draft) => {
      this.assertCurrentDatabase(draft, databaseId, revision)
      bindLegacyNotionData(draft, databaseId)
    })
  }

  async archivePage(pageId: string): Promise<void> {
    const token = await this.store.getNotionToken()
    if (!token) throw new Error('Notion 密钥不可用，无法删除已同步的记录。')
    await this.archivePageWithToken(token, pageId)
  }

  private async archivePageWithToken(token: string, pageId: string): Promise<void> {
    try {
      await this.request(token, `/pages/${pageId}`, { method: 'PATCH', body: { archived: true } })
    } catch (error) {
      // Archiving is idempotent: missing and already-archived pages both satisfy the deletion request.
      if (!isNotionNotFound(error) && !isNotionAlreadyArchived(error)) throw error
    }
  }

  private async flushPendingDeletions(
    token: string,
    databaseId: string,
    revision: number,
    options: { expireUnresolvedBefore?: number; skipDeletionIds?: ReadonlySet<string> } = {}
  ): Promise<DeletionFlushResult> {
    const attemptedDeletionIds = new Set<string>()
    const deletedPageIds = new Set<string>()
    const snapshot = await this.requireCurrentDatabase(databaseId, revision)

    for (const deletion of snapshot.notionDeletions) {
      if (deletion.databaseId !== databaseId) continue
      if (options.skipDeletionIds?.has(deletion.id)) continue
      const pageId = deletion.notionPageId
      if (!pageId) {
        const requestedAt = Date.parse(deletion.requestedAt)
        if (
          options.expireUnresolvedBefore !== undefined &&
          Number.isFinite(requestedAt) &&
          requestedAt <= options.expireUnresolvedBefore
        ) {
          await this.store.update((draft) => {
            this.assertCurrentDatabase(draft, databaseId, revision)
            const current = draft.notionDeletions.find((candidate) => candidate.id === deletion.id)
            if (current && current.databaseId === databaseId && !current.notionPageId) {
              draft.notionDeletions = draft.notionDeletions.filter((candidate) => candidate.id !== deletion.id)
            }
          })
        }
        continue
      }

      attemptedDeletionIds.add(deletion.id)
      const lastAttemptAt = new Date().toISOString()
      try {
        await this.requireCurrentDatabase(databaseId, revision)
        await this.archivePageWithToken(token, pageId)
        deletedPageIds.add(pageId)
        await this.store.update((draft) => {
          draft.notionDeletions = draft.notionDeletions.filter(
            (candidate) =>
              candidate.id !== deletion.id &&
              !(candidate.databaseId === databaseId && candidate.notionPageId === pageId)
          )
        })
      } catch (error) {
        if (error instanceof DatabaseChangedDuringSyncError) throw error
        const message = error instanceof Error ? error.message : 'Notion 删除同步失败。'
        await this.store.update((draft) => {
          const current = draft.notionDeletions.find((candidate) => candidate.id === deletion.id)
          if (current && current.databaseId === databaseId && current.notionPageId === pageId) {
            current.lastAttemptAt = lastAttemptAt
            current.lastError = message
          }
        })
      }
    }

    return { attemptedDeletionIds, deletedPageIds }
  }

  private async resolvePendingDeletionPageIds(
    remoteEntries: CalendarEntry[],
    excludedPageIds: ReadonlySet<string>,
    databaseId: string,
    revision: number
  ): Promise<void> {
    await this.store.update((draft) => {
      this.assertCurrentDatabase(draft, databaseId, revision)
      const claimed = new Set(
        draft.notionDeletions.flatMap((deletion) =>
          deletion.databaseId === databaseId && deletion.notionPageId ? [deletion.notionPageId] : []
        )
      )
      for (const deletion of draft.notionDeletions) {
        if (deletion.databaseId !== databaseId || deletion.notionPageId) continue
        const match = remoteEntries.find(
          (remote) =>
            remote.notionDatabaseId === databaseId &&
            remote.notionPageId &&
            !claimed.has(remote.notionPageId) &&
            !excludedPageIds.has(remote.notionPageId) &&
            deletionMatchesEntry(deletion, remote, databaseId)
        )
        if (match?.notionPageId) {
          deletion.notionPageId = match.notionPageId
          deletion.lastAttemptAt = undefined
          deletion.lastError = undefined
          claimed.add(match.notionPageId)
        }
      }
    })
  }

  private async fetchDatabase(token: string, databaseId: string): Promise<DatabaseInfo> {
    const response = await this.request(token, `/databases/${databaseId}`)
    return inspectDatabase(response as NotionDatabase)
  }

  private async pushPendingEntries(
    token: string,
    databaseId: string,
    info: DatabaseInfo,
    snapshot: AppSnapshot,
    revision: number
  ): Promise<void> {
    const pending = snapshot.entries.filter(
      (entry) =>
        entry.source === 'local' &&
        entry.notionDatabaseId === databaseId &&
        !entry.notionPageId &&
        ['pending', 'error'].includes(entry.syncStatus)
    )
    for (const [index, entry] of pending.entries()) {
      try {
        await this.requireCurrentDatabase(databaseId, revision)
        const focusDetails =
          entry.kind === 'pomodoro'
            ? [
                '由 Personal Tool 自动记录',
                `计时模式：${entry.timerMode === 'countup' ? '正向计时' : '倒计时'}`,
                entry.focusMs !== undefined ? `实际专注：${formatDurationMs(entry.focusMs)}` : '',
                entry.plannedDurationMs !== undefined
                  ? `计划时长：${formatDurationMs(entry.plannedDurationMs)}`
                  : ''
              ]
            : []
        const bodyText = [entry.notes, ...focusDetails].filter(Boolean).join('\n').slice(0, 2000)
        const payload = {
          parent: { database_id: databaseId },
          properties: {
            [info.titleProperty]: {
              title: [{ type: 'text', text: { content: entry.title.slice(0, 2000) } }]
            },
            [info.dateProperty]: {
              date: { start: entry.startAt, end: entry.endAt }
            }
          },
          children: bodyText
            ? [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: {
                    rich_text: [{ type: 'text', text: { content: bodyText } }]
                  }
                }
              ]
            : undefined
        }
        const page = (await this.request(token, '/pages', { method: 'POST', body: payload })) as NotionPage
        await this.store.update((draft) => {
          const databaseStillCurrent =
            this.databaseRevision === revision && draft.settings.notion.databaseId === databaseId
          const current = draft.entries.find(
            (candidate) => candidate.id === entry.id && candidate.notionDatabaseId === databaseId
          )
          const deletion = draft.notionDeletions.find(
            (candidate) =>
              candidate.entryId === entry.id &&
              (!candidate.databaseId || candidate.databaseId === databaseId)
          )
          if (current && !deletion) {
            current.notionPageId = page.id
            current.syncStatus = databaseStillCurrent ? 'synced' : 'local'
            current.lastSyncError = undefined
            current.updatedAt = new Date().toISOString()
          } else if (deletion) {
            deletion.databaseId ??= databaseId
            deletion.notionPageId = page.id
            deletion.lastAttemptAt = undefined
            deletion.lastError = undefined
          } else {
            // The entry was deleted while its POST was in flight. Queue a compensating archive
            // so the freshly-created Notion page cannot return on the next pull.
            draft.notionDeletions.push({
              id: crypto.randomUUID(),
              entryId: entry.id,
              notionPageId: page.id,
              databaseId,
              title: entry.title,
              startAt: entry.startAt,
              endAt: entry.endAt,
              requestedAt: new Date().toISOString()
            })
          }
        })
      } catch (error) {
        if (error instanceof DatabaseChangedDuringSyncError) throw error
        const message = error instanceof Error ? error.message : '上传失败。'
        await this.store.update((draft) => {
          const current = draft.entries.find(
            (candidate) => candidate.id === entry.id && candidate.notionDatabaseId === databaseId
          )
          if (
            current &&
            this.databaseRevision === revision &&
            draft.settings.notion.databaseId === databaseId
          ) {
            current.syncStatus = 'error'
            current.lastSyncError = message
          }
        })
      }
      if (index < pending.length - 1) await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }

  private async reconcilePendingEntries(
    remoteEntries: CalendarEntry[],
    excludedPageIds: ReadonlySet<string>,
    databaseId: string,
    revision: number
  ): Promise<void> {
    await this.store.update((draft) => {
      this.assertCurrentDatabase(draft, databaseId, revision)
      const claimed = new Set(
        draft.entries.flatMap((entry) =>
          entry.notionDatabaseId === databaseId && entry.notionPageId ? [entry.notionPageId] : []
        )
      )
      for (const local of draft.entries) {
        if (
          local.source !== 'local' ||
          local.notionDatabaseId !== databaseId ||
          local.notionPageId ||
          !['pending', 'error'].includes(local.syncStatus)
        ) {
          continue
        }
        const match = remoteEntries.find(
          (remote) =>
            remote.notionDatabaseId === databaseId &&
            remote.notionPageId &&
            !excludedPageIds.has(remote.notionPageId) &&
            !claimed.has(remote.notionPageId) &&
            !draft.notionDeletions.some((deletion) =>
              deletionMatchesEntry(deletion, remote, databaseId)
            ) &&
            remote.title === local.title &&
            remote.startAt === local.startAt &&
            remote.endAt === local.endAt
        )
        if (match?.notionPageId) {
          local.notionPageId = match.notionPageId
          local.notionDatabaseId = databaseId
          local.syncStatus = 'synced'
          local.lastSyncError = undefined
          claimed.add(match.notionPageId)
        }
      }
    })
  }

  private async pullEntries(token: string, databaseId: string, info: DatabaseInfo): Promise<CalendarEntry[]> {
    const result: CalendarEntry[] = []
    let cursor: string | undefined
    const seenCursors = new Set<string>()
    while (true) {
      const payload = (await this.request(token, `/databases/${databaseId}/query`, {
        method: 'POST',
        body: { page_size: 100, start_cursor: cursor }
      })) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null }
      for (const page of payload.results ?? []) {
        const entry = notionPageToEntry(page, info)
        if (entry) {
          entry.notionDatabaseId = databaseId
          result.push(entry)
        }
      }
      if (!payload.has_more || !payload.next_cursor) break
      if (seenCursors.has(payload.next_cursor)) {
        throw new Error('Notion 返回了重复的分页游标，同步已安全停止。')
      }
      seenCursors.add(payload.next_cursor)
      cursor = payload.next_cursor
    }
    return result
  }

  private async request(
    token: string,
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}
  ): Promise<unknown> {
    const method = options.method ?? 'GET'
    // Creating a page is not safely repeatable: a timeout may happen after Notion
    // committed the page, so POST /pages is reconciled on the next pull instead.
    const canRetry = method === 'GET' || method === 'PATCH' || path.endsWith('/query')
    let retryNumber = 0

    while (true) {
      try {
        const response = await this.fetcher(`${NOTION_API}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json'
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(NOTION_REQUEST_TIMEOUT_MS)
        })
        const payload = (await response.json().catch(() => ({}))) as unknown
        if (!response.ok) throw notionError(response.status, payload)
        return payload
      } catch (cause) {
        const error = normalizeNotionRequestError(cause, true)
        const retry = planNotionRetry(error, retryNumber, {
          maxRetries: canRetry ? NOTION_REQUEST_MAX_RETRIES : 0
        })
        if (!retry.shouldRetry) throw error
        await wait(retry.delayMs as number)
        retryNumber += 1
      }
    }
  }
}
