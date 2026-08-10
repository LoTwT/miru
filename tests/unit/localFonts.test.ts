import 'fake-indexeddb/auto'

import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

import { forceCloseDatabase } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createLocalFontOption,
  createLocalFontStore,
  deleteLocalFontsDatabase,
  localFontHardLimitBytes,
  localFontSoftWarningBytes,
  localFontsDatabaseVersion,
  validateLocalFontFile,
} from '@/features/settings/localFonts'

const dbNames = new Set<string>()
const stores = new Set<ReturnType<typeof createLocalFontStore>>()

function createTestStore() {
  const dbName = `miru:test-local-fonts:${crypto.randomUUID()}`
  dbNames.add(dbName)

  let id = 0
  let tick = 0
  const store = createLocalFontStore({
    dbName,
    createId: () => `font-${++id}`,
    now: () => new Date(Date.UTC(2026, 4, 30, 10, 0, tick++)).toISOString(),
  })
  stores.add(store)
  return store
}

function createFontFile(name: string, size: number, type = 'font/woff2'): File {
  return new NodeFile([new Uint8Array(size)], name, { type }) as unknown as File
}

function createFontBlob(content = 'font'): Blob {
  return new NodeBlob([content], { type: 'font/woff2' }) as unknown as Blob
}

afterEach(async () => {
  await Promise.all([...stores].map(store => store.close()))
  stores.clear()
  await Promise.all([...dbNames].map(name => deleteLocalFontsDatabase(name)))
  dbNames.clear()
})

describe('local font store', () => {
  it('retries opening the same store after an IndexedDB open failure', async () => {
    const dbName = `miru:test-local-fonts:${crypto.randomUUID()}`
    dbNames.add(dbName)
    const incompatibleDb = await openDB(dbName, localFontsDatabaseVersion + 1, {
      upgrade(db) {
        db.createObjectStore('future')
      },
    })
    incompatibleDb.close()
    const store = createLocalFontStore({ dbName })

    try {
      await expect(store.listFonts()).rejects.toMatchObject({ name: 'VersionError' })
      await deleteLocalFontsDatabase(dbName)

      await expect(store.listFonts()).resolves.toEqual([])
    }
    finally {
      await store.close().catch(() => undefined)
    }
  })

  it('closes cleanly after an IndexedDB open failure and allows the store to reopen', async () => {
    const dbName = `miru:test-local-fonts:${crypto.randomUUID()}`
    dbNames.add(dbName)
    const incompatibleDb = await openDB(dbName, localFontsDatabaseVersion + 1, {
      upgrade(db) {
        db.createObjectStore('future')
      },
    })
    incompatibleDb.close()
    const store = createLocalFontStore({ dbName })

    try {
      await expect(store.listFonts()).rejects.toMatchObject({ name: 'VersionError' })
      await expect(store.close()).resolves.toBeUndefined()
      await deleteLocalFontsDatabase(dbName)

      await expect(store.listFonts()).resolves.toEqual([])
    }
    finally {
      await store.close().catch(() => undefined)
    }
  })

  it('reopens the same store after its IndexedDB connection is terminated', async () => {
    const store = createTestStore()
    const openSpy = vi.spyOn(indexedDB, 'open')

    try {
      const record = await store.addFont({
        file: createFontBlob('survives-termination'),
        fileName: 'Survives Termination.woff2',
        mimeType: 'font/woff2',
        name: 'Survives Termination',
      })
      expect(openSpy).toHaveBeenCalledTimes(1)
      const firstOpenRequest = openSpy.mock.results[0]?.value
      expect(firstOpenRequest).toBeDefined()

      forceCloseDatabase(
        firstOpenRequest!.result as unknown as Parameters<typeof forceCloseDatabase>[0],
      )

      await expect(store.getFont(record.id)).resolves.toMatchObject({
        id: record.id,
        name: 'Survives Termination',
        blob: expect.anything(),
      })
      expect(openSpy).toHaveBeenCalledTimes(2)
    }
    finally {
      openSpy.mockRestore()
    }
  })

  it('keeps a newer opening cached when close waits for an older opening', async () => {
    const dbName = `miru:test-local-fonts:${crypto.randomUUID()}`
    dbNames.add(dbName)
    const legacyDb = await openDB(dbName, 1, {
      upgrade(db) {
        const fonts = db.createObjectStore('fonts', { keyPath: 'id' })
        fonts.createIndex('name', 'name')
        fonts.createIndex('createdAt', 'createdAt')
      },
    })
    const store = createLocalFontStore({ dbName })
    const openSpy = vi.spyOn(indexedDB, 'open')

    try {
      const olderList = store.listFonts()
      const closing = store.close()
      const newerList = store.listFonts()
      legacyDb.close()

      await expect(olderList).resolves.toEqual([])
      await expect(closing).resolves.toBeUndefined()
      await expect(newerList).resolves.toEqual([])
      expect(openSpy).toHaveBeenCalledTimes(2)

      await expect(store.listFonts()).resolves.toEqual([])
      expect(openSpy).toHaveBeenCalledTimes(2)
    }
    finally {
      legacyDb.close()
      await store.close().catch(() => undefined)
      openSpy.mockRestore()
    }
  })

  it('validates supported local font files with soft and hard size limits', () => {
    expect(validateLocalFontFile(createFontFile('quiet.woff2', 64))).toEqual({ ok: true })
    expect(validateLocalFontFile(createFontFile('large.otf', localFontSoftWarningBytes + 1, 'font/otf')))
      .toEqual({ ok: true, warning: '字体较大,加载和本地存储可能变慢。' })
    expect(validateLocalFontFile(createFontFile('huge.ttf', localFontHardLimitBytes + 1, 'font/ttf')))
      .toEqual({ ok: false, error: '字体超过 25MB,请换一个更小的文件。' })
    expect(validateLocalFontFile(createFontFile('not-font.txt', 64, 'text/plain')))
      .toEqual({ ok: false, error: '只支持 .woff2 / .ttf / .otf 字体文件。' })
    expect(validateLocalFontFile(createFontFile('image.woff2', 64, 'image/png')))
      .toEqual({ ok: false, error: '这个文件看起来不像字体文件。' })
  })

  it('persists, renames, lists, and deletes local font records', async () => {
    const store = createTestStore()
    const first = await store.addFont({
      file: createFontBlob('one'),
      fileName: 'Quiet Serif.woff2',
      mimeType: 'font/woff2',
      name: 'Quiet Serif',
    })
    const second = await store.addFont({
      file: createFontBlob('two'),
      fileName: 'Mono.otf',
      mimeType: 'font/otf',
      name: 'Mono',
    })

    expect(first).toMatchObject({
      id: 'font-1',
      name: 'Quiet Serif',
      fileName: 'Quiet Serif.woff2',
      byteSize: 3,
      schemaVersion: 2,
    })
    const listed = await store.listFonts()

    expect(listed.map(font => font.id)).toEqual(['font-1', 'font-2'])
    expect(listed[0]).not.toHaveProperty('blob')
    expect(await store.getFont(first.id)).toMatchObject({
      id: first.id,
      blob: expect.anything(),
    })

    const renamed = await store.renameFont(second.id, '  Code Face  ')
    expect(renamed?.name).toBe('Code Face')
    expect(renamed).not.toHaveProperty('blob')
    expect((await store.listFonts()).map(font => font.name)).toEqual(['Quiet Serif', 'Code Face'])
    expect((await store.getFont(second.id))?.name).toBe('Code Face')

    await store.deleteFont(first.id)
    expect(await store.countFonts()).toBe(1)
    expect((await store.listFonts()).map(font => font.id)).toEqual(['font-2'])
    expect(await store.getFont(first.id)).toBeNull()
  })

  it('migrates v1 blob records into v2 metadata and body stores', async () => {
    const dbName = `miru:test-local-fonts:${crypto.randomUUID()}`
    dbNames.add(dbName)
    const legacyBlob = createFontBlob('legacy-font-data')
    const legacyDb = await openDB(dbName, 1, {
      upgrade(db) {
        const fonts = db.createObjectStore('fonts', { keyPath: 'id' })
        fonts.createIndex('name', 'name')
        fonts.createIndex('createdAt', 'createdAt')
      },
    })
    await legacyDb.add('fonts', {
      id: 'font-legacy',
      name: 'Legacy Serif',
      fileName: 'Legacy Serif.woff2',
      mimeType: 'font/woff2',
      byteSize: legacyBlob.size,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      blob: legacyBlob,
      schemaVersion: 1,
    })
    legacyDb.close()

    const store = createLocalFontStore({ dbName })
    stores.add(store)
    const listed = await store.listFonts()
    const migrated = await store.getFont('font-legacy')

    expect(listed).toEqual([expect.objectContaining({
      id: 'font-legacy',
      name: 'Legacy Serif',
      schemaVersion: 2,
    })])
    expect(listed[0]).not.toHaveProperty('blob')
    expect(migrated).toMatchObject({
      id: 'font-legacy',
      schemaVersion: 2,
      blob: expect.anything(),
    })
    expect(migrated?.blob.size).toBe(legacyBlob.size)
  })

  it('builds an uploaded font stack with the existing CJK fallback chain', async () => {
    const store = createTestStore()
    const record = await store.addFont({
      file: createFontBlob('font-data'),
      fileName: 'Latin Only.woff2',
      mimeType: 'font/woff2',
      name: 'Latin Only',
    })
    const option = createLocalFontOption(record)

    expect(option.familyId).toBe('local:font-1')
    expect(option.fontFaceFamily).toBe('MiruLocalFont-font-1')
    expect(option.fontStack).toContain('"MiruLocalFont-font-1"')
    expect(option.fontStack).toContain('"Songti SC"')
    expect(option.fontStack).toContain('"Noto Serif CJK SC"')
  })
})
