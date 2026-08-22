import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '../shared/types'
import { inspectDatabase, normalizeDatabaseId, notionPageToEntry, NotionService } from './notion'
import type { AppStore } from './store'

const DATABASE_A = '01234567-89ab-cdef-0123-456789abcdef'
const DATABASE_B = 'fedcba98-7654-3210-fedc-ba9876543210'

function createSnapshot(databaseId = 'database-1'): AppSnapshot {
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
        databaseId,
        connected: true,
        tokenConfigured: true,
        autoSyncPomodoros: true,
        autoSyncManual: true
      }
    }
  }
}

function createVerifiedSnapshot(databaseId = 'database-1'): AppSnapshot {
  const snapshot = createSnapshot(databaseId)
  Object.assign(snapshot.settings.notion, {
    connected: true,
    databaseName: 'Existing calendar',
    titleProperty: 'Name',
    dateProperty: 'When',
    lastSyncedAt: '2026-08-20T00:00:00.000Z',
    lastError: 'previous warning'
  })
  return snapshot
}

class MemoryStore {
  constructor(
    private snapshot: AppSnapshot,
    private token = 'secret-token'
  ) {}

  async getSnapshot(): Promise<AppSnapshot> {
    return structuredClone(this.snapshot)
  }

  async update(mutator: (draft: AppSnapshot) => void | Promise<void>): Promise<AppSnapshot> {
    const draft = structuredClone(this.snapshot)
    await mutator(draft)
    this.snapshot = draft
    return structuredClone(this.snapshot)
  }

  async getNotionToken(): Promise<string> {
    return this.token
  }

  async setNotionToken(token: string): Promise<void> {
    this.token = token
    await this.update((draft) => {
      draft.settings.notion.tokenConfigured = true
    })
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function databaseResponse(id = 'database-1'): Response {
  return jsonResponse({
    id,
    title: [{ plain_text: 'Calendar' }],
    properties: {
      Name: { id: 'title', name: 'Name', type: 'title' },
      When: { id: 'date', name: 'When', type: 'date' }
    }
  })
}

function notionPage(id: string, title = 'Meeting'): Record<string, unknown> {
  return {
    id,
    created_time: '2026-08-20T00:00:00.000Z',
    last_edited_time: '2026-08-20T01:00:00.000Z',
    properties: {
      Name: { title: [{ plain_text: title }] },
      When: { date: { start: '2026-08-20T02:00:00.000Z', end: '2026-08-20T03:00:00.000Z' } }
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Notion helpers', () => {
  it('extracts a database id from a Notion URL', () => {
    expect(normalizeDatabaseId('https://www.notion.so/team/Tasks-0123456789abcdef0123456789abcdef?v=abc')).toBe(
      '01234567-89ab-cdef-0123-456789abcdef'
    )
  })

  it('discovers the title and date properties', () => {
    const info = inspectDatabase({
      id: 'db',
      title: [{ plain_text: 'Focus log' }],
      properties: {
        Name: { id: 'title', name: 'Name', type: 'title' },
        When: { id: 'date', name: 'When', type: 'date' }
      }
    })
    expect(info).toMatchObject({ name: 'Focus log', titleProperty: 'Name', dateProperty: 'When' })
  })

  it('converts a dated Notion page into an external calendar entry', () => {
    const entry = notionPageToEntry(
      {
        id: 'page-1',
        created_time: '2026-08-20T00:00:00.000Z',
        last_edited_time: '2026-08-20T01:00:00.000Z',
        properties: {
          Name: { title: [{ plain_text: 'Meeting' }] },
          When: { date: { start: '2026-08-20T02:00:00.000Z', end: '2026-08-20T03:00:00.000Z' } }
        }
      },
      { id: 'db', name: 'Calendar', titleProperty: 'Name', dateProperty: 'When' }
    )
    expect(entry).toMatchObject({
      title: 'Meeting',
      kind: 'external',
      source: 'notion',
      notionDatabaseId: 'db'
    })
  })
})

describe('Notion connection failure policy', () => {
  it.each([
    ['network failure', () => { throw new TypeError('fetch failed') }, '暂时无法访问 Notion'],
    [
      'rate limit',
      () => jsonResponse({ code: 'rate_limited', message: 'slow down' }, 429),
      'Notion 请求过于频繁，请稍后重试。'
    ],
    [
      'server failure',
      () => jsonResponse({ code: 'internal_server_error', message: 'service unavailable' }, 500),
      'Notion 同步失败：service unavailable'
    ]
  ] as const)(
    'keeps an already verified connection after a temporary top-level %s',
    async (_label, failure, expectedMessage) => {
      vi.useFakeTimers()
      const memoryStore = new MemoryStore(createVerifiedSnapshot())
      const fetchMock = vi.fn(async () => failure())
      vi.stubGlobal('fetch', fetchMock)
      const operation = new NotionService(memoryStore as unknown as AppStore).syncAll()
      const rejected = expect(operation).rejects.toThrow(expectedMessage)

      await vi.runAllTimersAsync()
      await rejected

      const result = await memoryStore.getSnapshot()
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(result.settings.notion.connected).toBe(true)
      expect(result.settings.notion.databaseName).toBe('Existing calendar')
      expect(result.settings.notion.lastError).toContain(expectedMessage)
    }
  )

  it.each([
    [401, 'Notion 密钥无效或已失效'],
    [403, '该集成没有访问目标数据库的权限'],
    [404, '找不到数据库']
  ] as const)('invalidates the connection after HTTP %s', async (status, expectedMessage) => {
    const memoryStore = new MemoryStore(createVerifiedSnapshot())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code: 'configuration_error', message: 'invalid connection' }, status))
    )

    await expect(new NotionService(memoryStore as unknown as AppStore).syncAll()).rejects.toThrow(expectedMessage)

    const result = await memoryStore.getSnapshot()
    expect(result.settings.notion.connected).toBe(false)
    expect(result.settings.notion.databaseName).toBeUndefined()
    expect(result.settings.notion.titleProperty).toBeUndefined()
    expect(result.settings.notion.dateProperty).toBeUndefined()
    expect(result.settings.notion.lastSyncedAt).toBeUndefined()
    expect(result.settings.notion.lastError).toContain(expectedMessage)
  })

  it('invalidates the connection when the selected database schema is unusable', async () => {
    const memoryStore = new MemoryStore(createVerifiedSnapshot())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: 'database-1',
          title: [{ plain_text: 'Broken calendar' }],
          properties: { Name: { id: 'title', name: 'Name', type: 'title' } }
        })
      )
    )

    await expect(new NotionService(memoryStore as unknown as AppStore).syncAll()).rejects.toThrow(
      '目标数据库需要至少包含一个标题属性和一个日期属性。'
    )

    const result = await memoryStore.getSnapshot()
    expect(result.settings.notion.connected).toBe(false)
    expect(result.settings.notion.databaseName).toBeUndefined()
    expect(result.settings.notion.lastSyncedAt).toBeUndefined()
    expect(result.settings.notion.lastError).toContain('目标数据库需要至少包含一个标题属性和一个日期属性。')
  })
})

describe('Notion connection settings', () => {
  it('preserves connection metadata and lastError when only auto-sync preferences change', async () => {
    const memoryStore = new MemoryStore(createVerifiedSnapshot(DATABASE_A))
    const service = new NotionService(memoryStore as unknown as AppStore)

    const result = await service.saveSettings({
      databaseId: DATABASE_A,
      autoSyncPomodoros: false,
      autoSyncManual: false
    })

    expect(result.settings.notion).toMatchObject({
      connected: true,
      databaseName: 'Existing calendar',
      titleProperty: 'Name',
      dateProperty: 'When',
      lastSyncedAt: '2026-08-20T00:00:00.000Z',
      lastError: 'previous warning',
      autoSyncPomodoros: false,
      autoSyncManual: false
    })
  })

  it('clears connection metadata when the database changes', async () => {
    const memoryStore = new MemoryStore(createVerifiedSnapshot(DATABASE_A))
    const result = await new NotionService(memoryStore as unknown as AppStore).saveSettings({
      databaseId: DATABASE_B,
      autoSyncPomodoros: true,
      autoSyncManual: true
    })

    expect(result.settings.notion.databaseId).toBe(DATABASE_B)
    expect(result.settings.notion.connected).toBe(false)
    expect(result.settings.notion.databaseName).toBeUndefined()
    expect(result.settings.notion.titleProperty).toBeUndefined()
    expect(result.settings.notion.dateProperty).toBeUndefined()
    expect(result.settings.notion.lastSyncedAt).toBeUndefined()
    expect(result.settings.notion.lastError).toBeUndefined()
  })

  it('clears connection metadata when a replacement token is supplied', async () => {
    const memoryStore = new MemoryStore(createVerifiedSnapshot(DATABASE_A))
    const result = await new NotionService(memoryStore as unknown as AppStore).saveSettings({
      databaseId: DATABASE_A,
      token: 'replacement-token',
      autoSyncPomodoros: true,
      autoSyncManual: true
    })

    expect(await memoryStore.getNotionToken()).toBe('replacement-token')
    expect(result.settings.notion.connected).toBe(false)
    expect(result.settings.notion.databaseName).toBeUndefined()
    expect(result.settings.notion.titleProperty).toBeUndefined()
    expect(result.settings.notion.dateProperty).toBeUndefined()
    expect(result.settings.notion.lastSyncedAt).toBeUndefined()
    expect(result.settings.notion.lastError).toBeUndefined()
  })

  it('does not hide queued work after a successful connection test', async () => {
    const snapshot = createVerifiedSnapshot(DATABASE_A)
    snapshot.notionDeletions.push({
      id: 'queued-deletion',
      entryId: 'deleted-entry',
      notionPageId: 'deleted-page',
      databaseId: DATABASE_A,
      title: 'Deleted entry',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: '2026-08-21T00:00:00.000Z'
    })
    const memoryStore = new MemoryStore(snapshot)
    vi.stubGlobal('fetch', vi.fn(async () => databaseResponse(DATABASE_A)))

    const result = await new NotionService(memoryStore as unknown as AppStore).testConnection({
      databaseId: DATABASE_A
    })

    expect(result.ok).toBe(true)
    expect((await memoryStore.getSnapshot()).settings.notion.lastError).toContain('1 条删除操作等待同步')
  })
})

describe('Notion request retry boundaries', () => {
  it('retries a transient database GET and then completes synchronization', async () => {
    vi.useFakeTimers()
    const memoryStore = new MemoryStore(createSnapshot())
    let databaseRequests = 0
    let queryRequests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/databases/database-1')) {
          databaseRequests += 1
          if (databaseRequests === 1) throw new TypeError('temporary network failure')
          return databaseResponse()
        }
        if (url.endsWith('/databases/database-1/query')) {
          queryRequests += 1
          return jsonResponse({ results: [], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const operation = new NotionService(memoryStore as unknown as AppStore).syncAll()
    await vi.runAllTimersAsync()
    const result = await operation

    expect(databaseRequests).toBe(2)
    expect(queryRequests).toBe(1)
    expect(result.settings.notion.connected).toBe(true)
    expect(result.settings.notion.lastError).toBeUndefined()
  })

  it('retries a transient database query and then completes synchronization', async () => {
    vi.useFakeTimers()
    const memoryStore = new MemoryStore(createSnapshot())
    let queryRequests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          queryRequests += 1
          if (queryRequests === 1) {
            return jsonResponse({ code: 'internal_server_error', message: 'retry query' }, 500)
          }
          return jsonResponse({ results: [], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const operation = new NotionService(memoryStore as unknown as AppStore).syncAll()
    await vi.runAllTimersAsync()
    const result = await operation

    expect(queryRequests).toBe(2)
    expect(result.settings.notion.connected).toBe(true)
    expect(result.settings.notion.lastError).toBeUndefined()
  })

  it('does not replay POST /pages after a network failure', async () => {
    const snapshot = createSnapshot()
    snapshot.entries.push({
      id: 'pending-post',
      kind: 'manual',
      source: 'local',
      title: 'Pending upload',
      notes: '',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      syncStatus: 'pending',
      notionDatabaseId: 'database-1',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z'
    })
    const memoryStore = new MemoryStore(snapshot)
    let postRequests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          return jsonResponse({ results: [], has_more: false })
        }
        if (url.endsWith('/pages') && init?.method === 'POST') {
          postRequests += 1
          throw new TypeError('connection reset after request write')
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await new NotionService(memoryStore as unknown as AppStore).syncAll()

    expect(postRequests).toBe(1)
    expect(result.entries[0]).toMatchObject({
      id: 'pending-post',
      syncStatus: 'error',
      lastSyncError: '暂时无法访问 Notion，连接配置仍保留，应用将自动重试。'
    })
    expect(result.settings.notion.connected).toBe(true)
    expect(result.settings.notion.lastError).toContain('1 条记录暂未同步')
  })
})

describe('Notion deletion synchronization', () => {
  it('keeps deletion intents when database access cannot be verified', async () => {
    const snapshot = createVerifiedSnapshot()
    snapshot.notionDeletions.push({
      id: 'deletion-without-access',
      entryId: 'entry-without-access',
      notionPageId: 'page-without-access',
      databaseId: 'database-1',
      title: 'Protected meeting',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: '2026-08-21T00:00:00.000Z'
    })
    const requestedUrls: string[] = []
    const memoryStore = new MemoryStore(snapshot)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input))
        return jsonResponse({ code: 'object_not_found', message: 'Database is not shared.' }, 404)
      })
    )

    await expect(new NotionService(memoryStore as unknown as AppStore).syncAll()).rejects.toThrow('找不到数据库')

    expect(requestedUrls.some((url) => url.includes('/pages/page-without-access'))).toBe(false)
    expect((await memoryStore.getSnapshot()).notionDeletions).toHaveLength(1)
  })

  it('treats a missing page as already deleted and prevents a stale pull from restoring it', async () => {
    const snapshot = createSnapshot()
    snapshot.notionDeletions.push({
      id: 'deletion-1',
      entryId: 'notion-page-1',
      notionPageId: 'page-1',
      title: 'Meeting',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: '2026-08-21T00:00:00.000Z'
    })
    const memoryStore = new MemoryStore(snapshot)
    const archivedPages: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/pages/page-1') && init?.method === 'PATCH') {
          archivedPages.push('page-1')
          return jsonResponse({ code: 'object_not_found', message: 'Could not find page.' }, 404)
        }
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          return jsonResponse({ results: [notionPage('page-1')], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const service = new NotionService(memoryStore as unknown as AppStore)
    const result = await service.syncAll()

    expect(archivedPages).toEqual(['page-1'])
    expect(result.notionDeletions).toEqual([])
    expect(result.entries).toEqual([])
  })

  it('treats Notion\'s already-archived validation response as an idempotent success', async () => {
    const snapshot = createSnapshot()
    snapshot.notionDeletions.push({
      id: 'deletion-archived',
      entryId: 'entry-archived',
      notionPageId: 'page-archived',
      title: 'Archived meeting',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: '2026-08-21T00:00:00.000Z'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/pages/page-archived') && init?.method === 'PATCH') {
          return jsonResponse(
            {
              code: 'validation_error',
              message: "Can't edit block that is archived. You must unarchive the block before editing."
            },
            400
          )
        }
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          return jsonResponse({ results: [], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await new NotionService(new MemoryStore(snapshot) as unknown as AppStore).syncAll()

    expect(result.notionDeletions).toEqual([])
    expect(result.settings.notion.lastError).toBeUndefined()
  })

  it('queues and archives the page created after its local entry was deleted in flight', async () => {
    const snapshot = createSnapshot()
    snapshot.entries.push({
      id: 'entry-1',
      kind: 'manual',
      source: 'local',
      title: 'Meeting',
      notes: '',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      syncStatus: 'pending',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z'
    })
    const memoryStore = new MemoryStore(snapshot)
    const archivedPages: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          return jsonResponse({ results: [], has_more: false })
        }
        if (url.endsWith('/pages') && init?.method === 'POST') {
          await memoryStore.update((draft) => {
            const entry = draft.entries.find((candidate) => candidate.id === 'entry-1')
            if (!entry) throw new Error('Missing fixture entry')
            draft.entries = draft.entries.filter((candidate) => candidate.id !== entry.id)
            draft.notionDeletions.push({
              id: 'deletion-1',
              entryId: entry.id,
              title: entry.title,
              startAt: entry.startAt,
              endAt: entry.endAt,
              requestedAt: '2026-08-21T00:00:00.000Z'
            })
          })
          return jsonResponse(notionPage('created-page'))
        }
        if (url.endsWith('/pages/created-page') && init?.method === 'PATCH') {
          archivedPages.push('created-page')
          return jsonResponse({ id: 'created-page', archived: true })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const service = new NotionService(memoryStore as unknown as AppStore)
    const result = await service.syncAll()

    expect(archivedPages).toEqual(['created-page'])
    expect(result.entries).toEqual([])
    expect(result.notionDeletions).toEqual([])
  })

  it('keeps a failed archive in the durable queue for a later retry', async () => {
    vi.useFakeTimers()
    const snapshot = createSnapshot()
    snapshot.notionDeletions.push({
      id: 'deletion-1',
      entryId: 'entry-1',
      notionPageId: 'page-1',
      title: 'Meeting',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: '2026-08-21T00:00:00.000Z'
    })
    const memoryStore = new MemoryStore(snapshot)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/pages/page-1') && init?.method === 'PATCH') {
          throw new TypeError('network unavailable')
        }
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          return jsonResponse({ results: [notionPage('page-1')], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const service = new NotionService(memoryStore as unknown as AppStore)
    const operation = service.syncAll()
    await vi.runAllTimersAsync()
    const result = await operation

    expect(result.entries).toEqual([])
    expect(result.notionDeletions).toHaveLength(1)
    expect(result.notionDeletions[0]).toMatchObject({
      id: 'deletion-1',
      lastError: '暂时无法访问 Notion，连接配置仍保留，应用将自动重试。'
    })
    expect(result.notionDeletions[0]?.lastAttemptAt).toBeTruthy()
    expect(result.settings.notion.lastError).toContain('1 条删除操作等待同步')
  })

  it('continues pulling after five full Notion result pages', async () => {
    const memoryStore = new MemoryStore(createSnapshot())
    let queryCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          queryCount += 1
          return jsonResponse({
            results: [],
            has_more: queryCount <= 5,
            next_cursor: queryCount <= 5 ? `cursor-${queryCount}` : null
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const service = new NotionService(memoryStore as unknown as AppStore)
    await service.syncAll()

    expect(queryCount).toBe(6)
  })

  it('retains an unresolved deletion after an ambiguous POST timeout, then resolves and archives it', async () => {
    const snapshot = createSnapshot()
    snapshot.entries.push({
      id: 'entry-ambiguous',
      kind: 'manual',
      source: 'local',
      title: 'Meeting',
      notes: '',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      syncStatus: 'pending',
      notionDatabaseId: 'database-1',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z'
    })
    const memoryStore = new MemoryStore(snapshot)
    const archivedPages: string[] = []
    let phase: 'timeout' | 'recover' = 'timeout'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/databases/database-1')) return databaseResponse()
        if (url.endsWith('/databases/database-1/query')) {
          return jsonResponse({
            results: phase === 'recover' ? [notionPage('uncertain-page')] : [],
            has_more: false
          })
        }
        if (url.endsWith('/pages') && init?.method === 'POST' && phase === 'timeout') {
          await memoryStore.update((draft) => {
            const entry = draft.entries.find((candidate) => candidate.id === 'entry-ambiguous')
            if (!entry) throw new Error('Missing fixture entry')
            draft.entries = draft.entries.filter((candidate) => candidate.id !== entry.id)
            draft.notionDeletions.push({
              id: 'deletion-ambiguous',
              entryId: entry.id,
              databaseId: 'database-1',
              title: entry.title,
              startAt: entry.startAt,
              endAt: entry.endAt,
              requestedAt: new Date().toISOString()
            })
          })
          throw new TypeError('request timed out after the remote commit')
        }
        if (url.endsWith('/pages/uncertain-page') && init?.method === 'PATCH') {
          archivedPages.push('uncertain-page')
          return jsonResponse({ id: 'uncertain-page', archived: true })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const service = new NotionService(memoryStore as unknown as AppStore)
    const afterTimeout = await service.syncAll()
    expect(afterTimeout.entries).toEqual([])
    expect(afterTimeout.notionDeletions).toMatchObject([
      { id: 'deletion-ambiguous', databaseId: 'database-1' }
    ])
    expect(afterTimeout.notionDeletions[0]).not.toHaveProperty('notionPageId')

    phase = 'recover'
    const afterRecovery = await service.syncAll()
    expect(archivedPages).toEqual(['uncertain-page'])
    expect(afterRecovery.entries).toEqual([])
    expect(afterRecovery.notionDeletions).toEqual([])
  })
})

describe('Notion database isolation', () => {
  it('cleans up the old remote view and localizes its queued entries when switching databases', async () => {
    const snapshot = createSnapshot(DATABASE_A)
    snapshot.entries.push(
      {
        id: 'remote-old',
        kind: 'external',
        source: 'notion',
        title: 'Old remote',
        notes: '',
        startAt: '2026-08-20T02:00:00.000Z',
        endAt: '2026-08-20T03:00:00.000Z',
        syncStatus: 'synced',
        notionPageId: 'remote-page',
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z'
      },
      {
        id: 'pending-old',
        kind: 'manual',
        source: 'local',
        title: 'Pending old',
        notes: '',
        startAt: '2026-08-20T04:00:00.000Z',
        endAt: '2026-08-20T05:00:00.000Z',
        syncStatus: 'pending',
        notionDatabaseId: DATABASE_A,
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z'
      },
      {
        id: 'error-old',
        kind: 'manual',
        source: 'local',
        title: 'Error old',
        notes: '',
        startAt: '2026-08-20T06:00:00.000Z',
        endAt: '2026-08-20T07:00:00.000Z',
        syncStatus: 'error',
        notionPageId: 'historical-page',
        notionDatabaseId: DATABASE_A,
        lastSyncError: 'old error',
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z'
      }
    )
    snapshot.notionDeletions.push({
      id: 'legacy-deletion',
      entryId: 'deleted-old',
      notionPageId: 'deleted-page',
      title: 'Deleted old',
      startAt: '2026-08-20T08:00:00.000Z',
      endAt: '2026-08-20T09:00:00.000Z',
      requestedAt: '2026-08-20T10:00:00.000Z'
    })
    const service = new NotionService(new MemoryStore(snapshot) as unknown as AppStore)

    const result = await service.saveSettings({
      databaseId: DATABASE_B,
      autoSyncPomodoros: true,
      autoSyncManual: true
    })

    expect(result.settings.notion.databaseId).toBe(DATABASE_B)
    expect(result.entries.some((entry) => entry.id === 'remote-old')).toBe(false)
    expect(result.entries.find((entry) => entry.id === 'pending-old')).toMatchObject({
      syncStatus: 'local',
      notionDatabaseId: DATABASE_A
    })
    expect(result.entries.find((entry) => entry.id === 'error-old')).toMatchObject({
      syncStatus: 'local',
      notionPageId: 'historical-page',
      notionDatabaseId: DATABASE_A
    })
    expect(result.entries.find((entry) => entry.id === 'error-old')).not.toHaveProperty('lastSyncError')
    expect(result.notionDeletions[0]).toMatchObject({ databaseId: DATABASE_A })
  })

  it('does not archive a deletion that belongs to another database', async () => {
    const snapshot = createSnapshot(DATABASE_B)
    snapshot.notionDeletions.push({
      id: 'old-database-deletion',
      entryId: 'old-entry',
      notionPageId: 'old-page',
      databaseId: DATABASE_A,
      title: 'Old entry',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: '2026-08-20T04:00:00.000Z'
    }, {
      id: 'old-database-fingerprint',
      entryId: 'old-unresolved-entry',
      databaseId: DATABASE_A,
      title: 'Meeting',
      startAt: '2026-08-20T02:00:00.000Z',
      endAt: '2026-08-20T03:00:00.000Z',
      requestedAt: new Date().toISOString()
    })
    const memoryStore = new MemoryStore(snapshot)
    const requestedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        requestedUrls.push(url)
        if (url.endsWith(`/databases/${DATABASE_B}`)) return databaseResponse(DATABASE_B)
        if (url.endsWith(`/databases/${DATABASE_B}/query`)) {
          return jsonResponse({ results: [notionPage('new-database-page')], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const service = new NotionService(memoryStore as unknown as AppStore)
    const result = await service.syncAll()

    expect(requestedUrls.some((url) => url.includes('/pages/old-page'))).toBe(false)
    expect(result.notionDeletions).toHaveLength(2)
    expect(result.notionDeletions[0]).toMatchObject({ databaseId: DATABASE_A })
    expect(result.notionDeletions[1]).not.toHaveProperty('notionPageId')
    expect(result.entries).toMatchObject([
      { notionPageId: 'new-database-page', notionDatabaseId: DATABASE_B }
    ])
  })

  it('discards an old database pull if settings change before merge', async () => {
    const memoryStore = new MemoryStore(createSnapshot(DATABASE_A))
    const requestedUrls: string[] = []
    const service = new NotionService(memoryStore as unknown as AppStore)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        requestedUrls.push(url)
        if (url.endsWith(`/databases/${DATABASE_A}`)) return databaseResponse(DATABASE_A)
        if (url.endsWith(`/databases/${DATABASE_A}/query`)) {
          await service.saveSettings({
            databaseId: DATABASE_B,
            autoSyncPomodoros: true,
            autoSyncManual: true
          })
          return jsonResponse({ results: [notionPage('stale-page', 'Stale remote')], has_more: false })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await service.syncAll()

    expect(result.settings.notion.databaseId).toBe(DATABASE_B)
    expect(result.settings.notion.databaseName).toBeUndefined()
    expect(result.entries).toEqual([])
    expect(requestedUrls.some((url) => url.includes(`/databases/${DATABASE_B}`))).toBe(false)
  })
})
