import type {
  AppSnapshot,
  CalendarEntry,
  NotionSettingsInput,
  NotionTestInput,
  NotionTestResult
} from '../shared/types'
import { AppStore } from './store'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

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

function notionError(status: number, payload: unknown): Error {
  const body = payload as { message?: string; code?: string }
  const suffix = body.message || body.code || `HTTP ${status}`
  if (status === 401) return new Error(`Notion 密钥无效或已失效：${suffix}`)
  if (status === 403) return new Error(`该集成没有访问目标数据库的权限：${suffix}`)
  if (status === 404) return new Error(`找不到数据库。请确认数据库 ID，并把数据库共享给该集成：${suffix}`)
  if (status === 429) return new Error('Notion 请求过于频繁，请稍后重试。')
  return new Error(`Notion 同步失败：${suffix}`)
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
  const properties = Object.entries(database.properties)
  const titleProperty = properties.find(([, property]) => property.type === 'title')?.[0]
  const dateProperty = properties.find(([, property]) => property.type === 'date')?.[0]
  if (!titleProperty || !dateProperty) {
    throw new Error('目标数据库需要至少包含一个标题属性和一个日期属性。')
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
    createdAt: page.created_time,
    updatedAt: page.last_edited_time
  }
}

export class NotionService {
  constructor(private readonly store: AppStore) {}

  async saveSettings(input: NotionSettingsInput): Promise<AppSnapshot> {
    const databaseId = input.databaseId.trim() ? normalizeDatabaseId(input.databaseId) : ''
    if (input.token?.trim()) await this.store.setNotionToken(input.token)
    return this.store.update((draft) => {
      const changedDatabase = draft.settings.notion.databaseId !== databaseId
      draft.settings.notion.databaseId = databaseId
      draft.settings.notion.autoSyncPomodoros = input.autoSyncPomodoros
      draft.settings.notion.autoSyncManual = input.autoSyncManual
      if (changedDatabase) {
        draft.settings.notion.connected = false
        draft.settings.notion.databaseName = undefined
        draft.settings.notion.titleProperty = undefined
        draft.settings.notion.dateProperty = undefined
      }
      draft.settings.notion.lastError = undefined
    })
  }

  async testConnection(input: NotionTestInput): Promise<NotionTestResult> {
    try {
      const token = input.token?.trim() || (await this.store.getNotionToken())
      if (!token) throw new Error('请先输入 Notion Internal Integration Token。')
      const databaseId = normalizeDatabaseId(input.databaseId)
      const info = await this.fetchDatabase(token, databaseId)
      if (!input.token?.trim()) {
        await this.store.update((draft) => {
          if (draft.settings.notion.databaseId !== databaseId) return
          Object.assign(draft.settings.notion, {
            connected: true,
            databaseName: info.name,
            titleProperty: info.titleProperty,
            dateProperty: info.dateProperty,
            lastError: undefined
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接测试失败。'
      if (!input.token?.trim()) {
        await this.store.update((draft) => {
          let databaseId: string | undefined
          try {
            databaseId = normalizeDatabaseId(input.databaseId)
          } catch {
            databaseId = undefined
          }
          if (databaseId && draft.settings.notion.databaseId === databaseId) {
            draft.settings.notion.connected = false
            draft.settings.notion.lastError = message
          }
        })
      }
      return { ok: false, message }
    }
  }

  async syncAll(): Promise<AppSnapshot> {
    const token = await this.store.getNotionToken()
    const before = await this.store.getSnapshot()
    const databaseId = before.settings.notion.databaseId
    if (!token || !databaseId) throw new Error('请先在设置中连接 Notion 日历数据库。')

    try {
      const info = await this.fetchDatabase(token, databaseId)
      const remoteEntries = await this.pullEntries(token, databaseId, info)
      await this.reconcilePendingEntries(remoteEntries)
      await this.pushPendingEntries(token, databaseId, info, await this.store.getSnapshot())
      const afterPush = await this.store.getSnapshot()
      const failedCount = afterPush.entries.filter((entry) => entry.syncStatus === 'error').length
      return this.store.update((draft) => {
        const byPageId = new Map(
          draft.entries.filter((entry) => entry.notionPageId).map((entry) => [entry.notionPageId as string, entry])
        )
        for (const remote of remoteEntries) {
          const existing = byPageId.get(remote.notionPageId as string)
          if (!existing) {
            draft.entries.push(remote)
          } else if (existing.source === 'notion') {
            Object.assign(existing, remote)
          }
        }
        Object.assign(draft.settings.notion, {
          connected: true,
          databaseName: info.name,
          titleProperty: info.titleProperty,
          dateProperty: info.dateProperty,
          lastSyncedAt: new Date().toISOString(),
          lastError: failedCount > 0 ? `有 ${failedCount} 条记录暂未同步，将在稍后重试。` : undefined
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notion 同步失败。'
      await this.store.update((draft) => {
        draft.settings.notion.connected = false
        draft.settings.notion.lastError = message
      })
      throw error
    }
  }

  async archivePage(pageId: string): Promise<void> {
    const token = await this.store.getNotionToken()
    if (!token) throw new Error('Notion 密钥不可用，无法删除已同步的记录。')
    await this.request(token, `/pages/${pageId}`, { method: 'PATCH', body: { archived: true } })
  }

  private async fetchDatabase(token: string, databaseId: string): Promise<DatabaseInfo> {
    const response = await this.request(token, `/databases/${databaseId}`)
    return inspectDatabase(response as NotionDatabase)
  }

  private async pushPendingEntries(
    token: string,
    databaseId: string,
    info: DatabaseInfo,
    snapshot: AppSnapshot
  ): Promise<void> {
    const pending = snapshot.entries.filter(
      (entry) => entry.source === 'local' && !entry.notionPageId && ['pending', 'error'].includes(entry.syncStatus)
    )
    for (const [index, entry] of pending.entries()) {
      try {
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
          const current = draft.entries.find((candidate) => candidate.id === entry.id)
          if (current) {
            current.notionPageId = page.id
            current.syncStatus = 'synced'
            current.lastSyncError = undefined
            current.updatedAt = new Date().toISOString()
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '上传失败。'
        await this.store.update((draft) => {
          const current = draft.entries.find((candidate) => candidate.id === entry.id)
          if (current) {
            current.syncStatus = 'error'
            current.lastSyncError = message
          }
        })
      }
      if (index < pending.length - 1) await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }

  private async reconcilePendingEntries(remoteEntries: CalendarEntry[]): Promise<void> {
    await this.store.update((draft) => {
      const claimed = new Set(
        draft.entries.flatMap((entry) => (entry.notionPageId ? [entry.notionPageId] : []))
      )
      for (const local of draft.entries) {
        if (
          local.source !== 'local' ||
          local.notionPageId ||
          !['pending', 'error'].includes(local.syncStatus)
        ) {
          continue
        }
        const match = remoteEntries.find(
          (remote) =>
            remote.notionPageId &&
            !claimed.has(remote.notionPageId) &&
            remote.title === local.title &&
            remote.startAt === local.startAt &&
            remote.endAt === local.endAt
        )
        if (match?.notionPageId) {
          local.notionPageId = match.notionPageId
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
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const payload = (await this.request(token, `/databases/${databaseId}/query`, {
        method: 'POST',
        body: { page_size: 100, start_cursor: cursor }
      })) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null }
      for (const page of payload.results ?? []) {
        const entry = notionPageToEntry(page, info)
        if (entry) result.push(entry)
      }
      if (!payload.has_more || !payload.next_cursor) break
      cursor = payload.next_cursor
    }
    return result
  }

  private async request(
    token: string,
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}
  ): Promise<unknown> {
    const response = await fetch(`${NOTION_API}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20_000)
    })
    const payload = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) throw notionError(response.status, payload)
    return payload
  }
}
