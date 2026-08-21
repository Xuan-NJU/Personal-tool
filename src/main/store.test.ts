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
        version: 3,
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
})
