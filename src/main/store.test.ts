import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => ''
  }
}))

import { AppStore, UnsupportedDataVersionError } from './store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AppStore data version handling', () => {
  it('rejects a future data version without renaming or overwriting its file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-tool-store-'))
    temporaryDirectories.push(directory)
    const dataFile = join(directory, 'personal-tool-data.json')
    const original = JSON.stringify(
      {
        version: 4,
        futureFeature: { preserved: true },
        todos: [{ id: 'future-todo', futureField: 'keep me' }]
      },
      null,
      2
    )
    await writeFile(dataFile, original, 'utf8')

    await expect(new AppStore(directory).initialize()).rejects.toBeInstanceOf(UnsupportedDataVersionError)

    expect(await readFile(dataFile, 'utf8')).toBe(original)
    expect((await readdir(directory)).filter((name) => name.includes('.corrupt-'))).toEqual([])
  })

  it('migrates version 2 data with reliable reminder defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-tool-store-'))
    temporaryDirectories.push(directory)
    const dataFile = join(directory, 'personal-tool-data.json')
    await writeFile(
      dataFile,
      JSON.stringify({
        version: 2,
        presets: [],
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
      }),
      'utf8'
    )

    const store = new AppStore(directory)
    await store.initialize()
    const migrated = await store.getSnapshot()

    expect(migrated.version).toBe(3)
    expect(migrated.pendingTimerCompletion).toBeNull()
    expect(migrated.settings.reminders).toEqual({
      systemNotification: true,
      playSound: true,
      showWindow: true,
      flashTaskbar: true
    })
    expect(JSON.parse(await readFile(dataFile, 'utf8'))).toMatchObject({
      version: 3,
      pendingTimerCompletion: null,
      settings: { reminders: migrated.settings.reminders }
    })
  })
})
