import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSnapshot } from '../shared/types'

const DATA_VERSION = 2

export class UnsupportedDataVersionError extends Error {
  constructor(readonly dataVersion: number) {
    super(`数据文件来自更新版本（v${dataVersion}），当前应用无法安全打开。请使用更新版本的 Personal Tool。`)
    this.name = 'UnsupportedDataVersionError'
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function defaultSnapshot(): AppSnapshot {
  const now = nowIso()
  return {
    version: DATA_VERSION,
    presets: [
      {
        id: crypto.randomUUID(),
        name: '标准番茄',
        durationSeconds: 25 * 60,
        isDefault: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: crypto.randomUUID(),
        name: '深度工作',
        durationSeconds: 45 * 60,
        isDefault: false,
        createdAt: now,
        updatedAt: now
      },
      {
        id: crypto.randomUUID(),
        name: '长时专注',
        durationSeconds: 60 * 60,
        isDefault: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    activeTimer: null,
    entries: [],
    todos: [],
    ideas: [],
    notionDeletions: [],
    settings: {
      notion: {
        databaseId: '',
        connected: false,
        tokenConfigured: false,
        autoSyncPomodoros: true,
        autoSyncManual: true
      }
    }
  }
}

function normalizeSnapshot(value: Partial<AppSnapshot>): AppSnapshot {
  const defaults = defaultSnapshot()
  const presets = Array.isArray(value.presets) && value.presets.length > 0 ? value.presets : defaults.presets
  const entries = Array.isArray(value.entries) ? value.entries : []
  const todos = Array.isArray(value.todos) ? value.todos : []
  const ideas = Array.isArray(value.ideas) ? value.ideas : []
  const notionDeletions = Array.isArray(value.notionDeletions) ? value.notionDeletions : []
  const notion = value.settings?.notion

  return {
    version: DATA_VERSION,
    presets,
    activeTimer: value.activeTimer ?? null,
    entries,
    todos,
    ideas,
    notionDeletions,
    settings: {
      notion: {
        ...defaults.settings.notion,
        ...notion
      }
    }
  }
}

export class AppStore {
  private readonly dataFile: string
  private readonly secureFile: string
  private data: AppSnapshot = defaultSnapshot()
  private queue: Promise<void> = Promise.resolve()

  constructor(directory = app.getPath('userData')) {
    this.dataFile = join(directory, 'personal-tool-data.json')
    this.secureFile = join(directory, 'personal-tool-secure.json')
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.dataFile), { recursive: true })
    let shouldPersist = false
    try {
      const raw = await readFile(this.dataFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppSnapshot>
      if (typeof parsed.version === 'number' && parsed.version > DATA_VERSION) {
        throw new UnsupportedDataVersionError(parsed.version)
      }
      const normalized = normalizeSnapshot(parsed)
      this.data = normalized
      shouldPersist =
        parsed.version !== DATA_VERSION ||
        !Array.isArray(parsed.todos) ||
        !Array.isArray(parsed.ideas) ||
        !Array.isArray(parsed.notionDeletions)
    } catch (error) {
      if (error instanceof UnsupportedDataVersionError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const backup = `${this.dataFile}.corrupt-${Date.now()}`
        await rename(this.dataFile, backup).catch(() => undefined)
      }
      this.data = defaultSnapshot()
      shouldPersist = true
    }

    if (shouldPersist) await this.persist()
    this.data.settings.notion.tokenConfigured = Boolean(await this.readEncryptedToken())
  }

  async getSnapshot(): Promise<AppSnapshot> {
    await this.queue
    return structuredClone(this.data)
  }

  async update(mutator: (draft: AppSnapshot) => void | Promise<void>): Promise<AppSnapshot> {
    let result: AppSnapshot | undefined
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.data)
      await mutator(draft)
      draft.version = DATA_VERSION
      await this.persist(draft)
      this.data = draft
      result = structuredClone(draft)
    })
    this.queue = operation.catch(() => undefined)
    await operation
    return result as AppSnapshot
  }

  async setNotionToken(token: string): Promise<void> {
    const trimmed = token.trim()
    if (!trimmed) return
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储暂不可用，Notion 密钥未被保存。')
    }
    const encrypted = safeStorage.encryptString(trimmed).toString('base64')
    await this.atomicWrite(this.secureFile, JSON.stringify({ notionToken: encrypted }))
    await this.update((draft) => {
      draft.settings.notion.tokenConfigured = true
    })
  }

  async getNotionToken(): Promise<string | undefined> {
    const encrypted = await this.readEncryptedToken()
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return undefined
    }
  }

  private async readEncryptedToken(): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.secureFile, 'utf8')) as { notionToken?: string }
      return parsed.notionToken
    } catch {
      return undefined
    }
  }

  private async persist(snapshot = this.data): Promise<void> {
    await this.atomicWrite(this.dataFile, JSON.stringify(snapshot, null, 2))
  }

  private async atomicWrite(path: string, contents: string): Promise<void> {
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, contents, 'utf8')
    await rename(temporary, path)
  }
}
