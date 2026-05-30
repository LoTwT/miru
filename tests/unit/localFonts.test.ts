import 'fake-indexeddb/auto'

import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createLocalFontOption,
  createLocalFontStore,
  deleteLocalFontsDatabase,
  localFontHardLimitBytes,
  localFontSoftWarningBytes,
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
      schemaVersion: 1,
    })
    expect((await store.listFonts()).map(font => font.id)).toEqual(['font-1', 'font-2'])

    const renamed = await store.renameFont(second.id, '  Code Face  ')
    expect(renamed?.name).toBe('Code Face')
    expect((await store.listFonts()).map(font => font.name)).toEqual(['Quiet Serif', 'Code Face'])

    await store.deleteFont(first.id)
    expect(await store.countFonts()).toBe(1)
    expect((await store.listFonts()).map(font => font.id)).toEqual(['font-2'])
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
