import 'fake-indexeddb/auto'

import { Blob as NodeBlob } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createLibraryStore,
  deleteLibraryDatabase,
  LibraryQuotaExceededError,
} from '@/features/library/libraryStore'
import type { LibraryEntry } from '@/features/library/types'

const dbNames = new Set<string>()
const stores = new Set<ReturnType<typeof createLibraryStore>>()

function createTestStore(options: {
  dbName?: string
  quota?: StorageEstimate
  storageSafetyMarginBytes?: number
} = {}) {
  const dbName = options.dbName ?? `miru:test-library:${crypto.randomUUID()}`
  dbNames.add(dbName)

  let id = 0
  let tick = 0
  const store = createLibraryStore({
    dbName,
    createId: () => `doc-${++id}`,
    now: () => new Date(Date.UTC(2026, 4, 24, 10, 0, tick++)).toISOString(),
    estimateStorage: async () => options.quota ?? {},
    storageSafetyMarginBytes: options.storageSafetyMarginBytes ?? 0,
  })
  stores.add(store)
  return store
}

function createPdfBlob(content = '%PDF-1.7 fake'): Blob {
  return new NodeBlob([content], { type: 'application/pdf' }) as unknown as Blob
}

afterEach(async () => {
  await Promise.all([...stores].map(store => store.close()))
  stores.clear()
  await Promise.all([...dbNames].map(name => deleteLibraryDatabase(name)))
  dbNames.clear()
})

describe('local library store', () => {
  it('stores Markdown entries and bodies separately, then opens through the Markdown path', async () => {
    const store = createTestStore()
    const entry = await store.addMarkdownDocument({
      markdown: '# Quiet notes\n\nRead slowly.',
      source: { kind: 'paste' },
      label: 'paste',
    })

    expect(entry).toMatchObject({
      id: 'doc-1',
      type: 'markdown',
      title: 'Quiet notes',
      sortTitle: 'quiet notes',
      source: { kind: 'paste' },
      pinned: false,
      schemaVersion: 1,
    })
    expect((entry as LibraryEntry & { markdown?: string }).markdown).toBeUndefined()

    const opened = await store.openMarkdownDocument(entry.id)
    expect(opened?.markdown).toBe('# Quiet notes\n\nRead slowly.')
    expect(opened?.entry.lastOpenedAt).not.toBe(entry.lastOpenedAt)
    expect(await store.countStoreEntries()).toEqual({
      entries: 1,
      markdownBodies: 1,
      pdfBodies: 0,
      positions: 0,
    })
  })

  it('derives URL-imported Markdown titles without exposing full URLs as display titles', async () => {
    const store = createTestStore()

    const titledEntry = await store.addMarkdownDocument({
      markdown: '---\ntitle: "Quiet URL Note"\n---\n\n# Ignored H1\n\nRead slowly.',
      source: {
        kind: 'url',
        inputUrl: 'https://example.com/docs/ignored.md',
        requestUrl: 'https://example.com/docs/ignored.md',
        domain: 'example.com',
      },
      label: 'https://example.com/docs/ignored.md',
    })

    const fallbackEntry = await store.addMarkdownDocument({
      markdown: 'No heading here.\n\nJust text.',
      source: {
        kind: 'url',
        inputUrl: 'https://example.com/guides/getting-started.markdown',
        requestUrl: 'https://example.com/guides/getting-started.markdown',
        domain: 'example.com',
      },
      label: 'https://example.com/guides/getting-started.markdown',
    })

    expect(titledEntry.title).toBe('Quiet URL Note')
    expect(titledEntry.source).toMatchObject({
      kind: 'url',
      inputUrl: 'https://example.com/docs/ignored.md',
    })
    expect(fallbackEntry.title).toBe('getting-started')
  })

  it('stores PDF entries as blobs without hydrating blobs into the bookshelf list', async () => {
    const store = createTestStore()
    const blob = createPdfBlob()
    const entry = await store.addPdfDocument({
      blob,
      source: { kind: 'file', fileName: 'Daily Paper.pdf', mimeType: 'application/pdf' },
    })

    expect(entry).toMatchObject({
      id: 'doc-1',
      type: 'pdf',
      title: 'Daily Paper',
      source: { kind: 'file', fileName: 'Daily Paper.pdf', mimeType: 'application/pdf' },
      byteSize: blob.size,
    })
    expect((entry as LibraryEntry & { blob?: Blob }).blob).toBeUndefined()

    const list = await store.listEntries()
    expect(list).toHaveLength(1)
    expect((list[0] as LibraryEntry & { blob?: Blob }).blob).toBeUndefined()

    const opened = await store.openPdfDocument(entry.id)
    expect(opened?.blob.size).toBe(blob.size)
    expect(opened?.blob.type).toBe('application/pdf')
  })

  it('updates title and pin state while keeping pinned documents above sorted rows', async () => {
    const store = createTestStore()
    const alpha = await store.addMarkdownDocument({ markdown: 'Alpha', source: { kind: 'paste' } })
    const beta = await store.addMarkdownDocument({ markdown: 'Beta', source: { kind: 'paste' } })

    await store.updateEntry(beta.id, { title: 'Pinned Beta', pinned: true })

    const sorted = await store.listEntries('title')
    expect(sorted.map(entry => entry.title)).toEqual(['Pinned Beta', 'Alpha'])
    expect(sorted[0]?.pinned).toBe(true)

    await store.updateEntry(alpha.id, { title: '  Renamed Alpha  ' })
    const renamed = await store.openMarkdownDocument(alpha.id)
    expect(renamed?.entry.title).toBe('Renamed Alpha')
  })

  it('saves and restores Markdown and PDF reading positions', async () => {
    const store = createTestStore()
    const markdown = await store.addMarkdownDocument({ markdown: '# One', source: { kind: 'paste' } })
    const pdf = await store.addPdfDocument({
      blob: createPdfBlob('pdf'),
      source: { kind: 'file', fileName: 'paper.pdf', mimeType: 'application/pdf' },
    })

    await store.saveReadingPosition({
      documentId: markdown.id,
      type: 'markdown',
      scrollY: 420,
      activeHeadingId: 'one',
    })
    await store.saveReadingPosition({
      documentId: pdf.id,
      type: 'pdf',
      pageNumber: 7,
      scaleMode: 'custom',
      scale: 1.25,
    })

    expect(await store.getReadingPosition(markdown.id)).toMatchObject({
      type: 'markdown',
      scrollY: 420,
      activeHeadingId: 'one',
    })
    expect((await store.openPdfDocument(pdf.id))?.position).toMatchObject({
      type: 'pdf',
      pageNumber: 7,
      scaleMode: 'custom',
      scale: 1.25,
    })
  })

  it('true-deletes one document body/blob and its reading position', async () => {
    const store = createTestStore()
    const markdown = await store.addMarkdownDocument({ markdown: '# Delete me', source: { kind: 'paste' } })
    const pdf = await store.addPdfDocument({
      blob: createPdfBlob('pdf'),
      source: { kind: 'file', fileName: 'keep.pdf', mimeType: 'application/pdf' },
    })
    await store.saveReadingPosition({
      documentId: markdown.id,
      type: 'markdown',
      scrollY: 100,
      activeHeadingId: null,
    })

    await store.deleteEntry(markdown.id)

    expect(await store.openMarkdownDocument(markdown.id)).toBeNull()
    expect(await store.openPdfDocument(pdf.id)).not.toBeNull()
    expect(await store.countStoreEntries()).toEqual({
      entries: 1,
      markdownBodies: 0,
      pdfBodies: 1,
      positions: 0,
    })
  })

  it('clears all library content while leaving unrelated storage outside the database alone', async () => {
    const store = createTestStore()
    const markdown = await store.addMarkdownDocument({ markdown: '# A', source: { kind: 'paste' } })
    const pdf = await store.addPdfDocument({
      blob: createPdfBlob('pdf'),
      source: { kind: 'file', fileName: 'b.pdf', mimeType: 'application/pdf' },
    })
    await store.saveReadingPosition({
      documentId: markdown.id,
      type: 'markdown',
      scrollY: 1,
      activeHeadingId: null,
    })
    await store.saveReadingPosition({
      documentId: pdf.id,
      type: 'pdf',
      pageNumber: 2,
      scaleMode: 'fit-width',
      scale: null,
    })

    await store.clearLibrary()

    expect(await store.listEntries()).toEqual([])
    expect(await store.countStoreEntries()).toEqual({
      entries: 0,
      markdownBodies: 0,
      pdfBodies: 0,
      positions: 0,
    })
  })

  it('rejects imports that exceed the available storage budget without creating partial rows', async () => {
    const store = createTestStore({
      quota: { usage: 950, quota: 1000 },
      storageSafetyMarginBytes: 0,
    })

    await expect(store.addMarkdownDocument({
      markdown: 'This text is intentionally longer than fifty bytes so quota rejects it.',
      source: { kind: 'paste' },
    })).rejects.toBeInstanceOf(LibraryQuotaExceededError)

    expect(await store.countStoreEntries()).toEqual({
      entries: 0,
      markdownBodies: 0,
      pdfBodies: 0,
      positions: 0,
    })
  })
})
