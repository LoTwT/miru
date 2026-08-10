import 'fake-indexeddb/auto'

import { Blob as NodeBlob } from 'node:buffer'

import { forceCloseDatabase } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createLibraryStore,
  deleteLibraryDatabase,
  libraryDatabaseVersion,
  LibraryEntryNotFoundError,
  LibraryQuotaExceededError,
} from '@/features/library/libraryStore'
import type { LibraryEntry } from '@/features/library/types'

const dbNames = new Set<string>()
const stores = new Set<ReturnType<typeof createLibraryStore>>()

function createTestStore(options: {
  dbName?: string
  createId?: () => string
  estimateStorage?: () => Promise<StorageEstimate>
  quota?: StorageEstimate
  storageSafetyMarginBytes?: number
} = {}) {
  const dbName = options.dbName ?? `miru:test-library:${crypto.randomUUID()}`
  dbNames.add(dbName)

  let id = 0
  let tick = 0
  const store = createLibraryStore({
    dbName,
    createId: options.createId ?? (() => `doc-${++id}`),
    now: () => new Date(Date.UTC(2026, 4, 24, 10, 0, tick++)).toISOString(),
    estimateStorage: options.estimateStorage ?? (async () => options.quota ?? {}),
    storageSafetyMarginBytes: options.storageSafetyMarginBytes ?? 0,
  })
  stores.add(store)
  return store
}

function createPdfBlob(content = '%PDF-1.7 fake'): Blob {
  return new NodeBlob([content], { type: 'application/pdf' }) as unknown as Blob
}

function createStorageEstimateGate(estimate: StorageEstimate = {}) {
  let markEntered!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  return {
    entered,
    release,
    estimateStorage: async (): Promise<StorageEstimate> => {
      markEntered()
      await released
      return estimate
    },
  }
}

afterEach(async () => {
  await Promise.all([...stores].map(store => store.close()))
  stores.clear()
  await Promise.all([...dbNames].map(name => deleteLibraryDatabase(name)))
  dbNames.clear()
})

describe('local library store', () => {
  it('retries opening the same store after an IndexedDB open failure', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    dbNames.add(dbName)
    const incompatibleDb = await openDB(dbName, libraryDatabaseVersion + 1, {
      upgrade(db) {
        db.createObjectStore('future')
      },
    })
    incompatibleDb.close()
    const store = createLibraryStore({ dbName })

    try {
      await expect(store.listEntries()).rejects.toMatchObject({ name: 'VersionError' })
      await deleteLibraryDatabase(dbName)

      await expect(store.listEntries()).resolves.toEqual([])
    }
    finally {
      await store.close().catch(() => undefined)
    }
  })

  it('closes cleanly after an IndexedDB open failure and allows the store to reopen', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    dbNames.add(dbName)
    const incompatibleDb = await openDB(dbName, libraryDatabaseVersion + 1, {
      upgrade(db) {
        db.createObjectStore('future')
      },
    })
    incompatibleDb.close()
    const store = createLibraryStore({ dbName })

    try {
      await expect(store.listEntries()).rejects.toMatchObject({ name: 'VersionError' })
      await expect(store.close()).resolves.toBeUndefined()
      await deleteLibraryDatabase(dbName)

      await expect(store.listEntries()).resolves.toEqual([])
    }
    finally {
      await store.close().catch(() => undefined)
    }
  })

  it('reopens the same store after its IndexedDB connection is terminated', async () => {
    const store = createTestStore()
    const openSpy = vi.spyOn(indexedDB, 'open')

    try {
      const entry = await store.addMarkdownDocument({
        markdown: '# Survives termination',
        source: { kind: 'paste' },
      })
      expect(openSpy).toHaveBeenCalledTimes(1)
      const firstOpenRequest = openSpy.mock.results[0]?.value
      expect(firstOpenRequest).toBeDefined()

      forceCloseDatabase(
        firstOpenRequest!.result as unknown as Parameters<typeof forceCloseDatabase>[0],
      )

      await expect(store.openMarkdownDocument(entry.id, { markOpened: false })).resolves.toMatchObject({
        entry: { id: entry.id },
        markdown: '# Survives termination',
      })
      expect(openSpy).toHaveBeenCalledTimes(2)
    }
    finally {
      openSpy.mockRestore()
    }
  })

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

  it('updates an existing URL-imported Markdown entry instead of duplicating it', async () => {
    const store = createTestStore()
    const source = {
      kind: 'url' as const,
      inputUrl: 'https://example.com/docs/fresh-note.md',
      requestUrl: 'https://example.com/docs/fresh-note.md',
      domain: 'example.com',
    }

    const first = await store.addMarkdownDocument({
      markdown: '# Fresh note\n\nOld content.',
      source,
      label: source.inputUrl,
    })
    await expect(store.findMarkdownEntryByUrl(source)).resolves.toMatchObject({ id: first.id })
    await store.saveReadingPosition({
      documentId: first.id,
      type: 'markdown',
      scrollY: 420,
      activeHeadingId: 'fresh-note',
    })

    const updated = await store.addMarkdownDocument({
      markdown: '# Fresh note\n\nUpdated content.',
      source,
      label: source.inputUrl,
    })

    expect(updated.id).toBe(first.id)
    expect(updated.createdAt).toBe(first.createdAt)
    expect(updated.updatedAt).not.toBe(first.updatedAt)
    expect(updated.byteSize).toBe(new TextEncoder().encode('# Fresh note\n\nUpdated content.').byteLength)
    expect(await store.listEntries()).toHaveLength(1)
    expect(await store.getReadingPosition(first.id)).toBeNull()

    const opened = await store.openMarkdownDocument(first.id)
    expect(opened?.markdown).toBe('# Fresh note\n\nUpdated content.')
    expect(opened?.position).toBeNull()
    expect(await store.countStoreEntries()).toEqual({
      entries: 1,
      markdownBodies: 1,
      pdfBodies: 0,
      positions: 0,
    })
  })

  it('preserves canonical metadata while removing legacy URL duplicates and positions', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    const store = createTestStore({ dbName })
    const source = {
      kind: 'url' as const,
      inputUrl: 'https://example.com/docs/canonical.md',
      requestUrl: 'https://cdn.example.com/docs/canonical.md',
      domain: 'example.com',
    }
    const original = await store.addMarkdownDocument({
      markdown: '# Original canonical body',
      source,
    })
    const canonical = await store.updateEntry(original.id, {
      title: 'My pinned title',
      pinned: true,
    })
    await store.saveReadingPosition({
      documentId: canonical.id,
      type: 'markdown',
      scrollY: 180,
      activeHeadingId: 'original-canonical-body',
    })

    const duplicateId = 'legacy-duplicate'
    const duplicate: LibraryEntry = {
      ...original,
      id: duplicateId,
      source: {
        ...source,
        inputUrl: source.requestUrl,
        domain: 'cdn.example.com',
      },
      createdAt: '2026-05-24T10:00:20.000Z',
      updatedAt: '2026-05-24T10:00:20.000Z',
      lastOpenedAt: '2026-05-24T10:00:20.000Z',
    }
    const db = await openDB(dbName, libraryDatabaseVersion)
    const seedTx = db.transaction(['entries', 'markdownBodies', 'positions'], 'readwrite')
    await Promise.all([
      seedTx.objectStore('entries').put(duplicate),
      seedTx.objectStore('markdownBodies').put({
        documentId: duplicateId,
        markdown: '# Legacy duplicate body',
      }),
      seedTx.objectStore('positions').put({
        documentId: duplicateId,
        type: 'markdown',
        scrollY: 640,
        activeHeadingId: 'legacy-duplicate-body',
        updatedAt: '2026-05-24T10:00:20.000Z',
      }),
      seedTx.done,
    ])
    db.close()

    const updated = await store.addMarkdownDocument({
      markdown: '# Refreshed canonical body',
      source: duplicate.source,
    }, { markOpened: false })

    expect(updated).toMatchObject({
      id: canonical.id,
      title: canonical.title,
      pinned: true,
      createdAt: canonical.createdAt,
      lastOpenedAt: canonical.lastOpenedAt,
      source: duplicate.source,
    })
    const opened = await store.openMarkdownDocument(canonical.id, { markOpened: false })
    expect(opened?.markdown).toBe('# Refreshed canonical body')
    expect(opened?.position).toBeNull()
    await expect(store.openMarkdownDocument(duplicateId, { markOpened: false })).resolves.toBeNull()
    await expect(store.countStoreEntries()).resolves.toEqual({
      entries: 1,
      markdownBodies: 1,
      pdfBodies: 0,
      positions: 0,
    })
  })

  it.each([
    {
      label: 'identical URLs',
      firstSource: {
        kind: 'url' as const,
        inputUrl: 'https://example.com/docs/shared.md',
        requestUrl: 'https://example.com/docs/shared.md',
        domain: 'example.com',
      },
      secondSource: {
        kind: 'url' as const,
        inputUrl: 'https://example.com/docs/shared.md',
        requestUrl: 'https://example.com/docs/shared.md',
        domain: 'example.com',
      },
    },
    {
      label: 'different inputs with the same request URL',
      firstSource: {
        kind: 'url' as const,
        inputUrl: 'https://github.com/example/project/blob/main/README.md',
        requestUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
        domain: 'raw.githubusercontent.com',
      },
      secondSource: {
        kind: 'url' as const,
        inputUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
        requestUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
        domain: 'raw.githubusercontent.com',
      },
    },
    {
      label: 'same input with different request URLs',
      firstSource: {
        kind: 'url' as const,
        inputUrl: 'https://example.com/latest',
        requestUrl: 'https://cdn-a.example.com/releases/note.md',
        domain: 'example.com',
      },
      secondSource: {
        kind: 'url' as const,
        inputUrl: 'https://example.com/latest',
        requestUrl: 'https://cdn-b.example.com/releases/note.md',
        domain: 'example.com',
      },
    },
  ])('atomically upserts concurrent first URL imports: $label', async ({ firstSource, secondSource }) => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    const firstEstimate = createStorageEstimateGate()
    const secondEstimate = createStorageEstimateGate()
    const firstStore = createTestStore({
      dbName,
      createId: () => 'first-tab-document',
      estimateStorage: firstEstimate.estimateStorage,
    })
    const secondStore = createTestStore({
      dbName,
      createId: () => 'second-tab-document',
      estimateStorage: secondEstimate.estimateStorage,
    })

    const firstImport = firstStore.addMarkdownDocument({
      markdown: '# First response\n\nWritten by the first tab.',
      source: firstSource,
      label: firstSource.inputUrl,
    })
    await firstEstimate.entered
    const secondImport = secondStore.addMarkdownDocument({
      markdown: '# Second response\n\nWritten by the second tab.',
      source: secondSource,
      label: secondSource.inputUrl,
    })
    await secondEstimate.entered

    const [firstEntry, secondEntry] = await (async () => {
      try {
        firstEstimate.release()
        const firstEntry = await firstImport
        secondEstimate.release()
        const secondEntry = await secondImport
        return [firstEntry, secondEntry] as const
      }
      finally {
        firstEstimate.release()
        secondEstimate.release()
        await Promise.allSettled([firstImport, secondImport])
      }
    })()

    expect(secondEntry.id).toBe(firstEntry.id)
    await expect(firstStore.listEntries()).resolves.toEqual([
      expect.objectContaining({
        id: firstEntry.id,
        source: secondSource,
        title: 'Second response',
      }),
    ])
    await expect(firstStore.countStoreEntries()).resolves.toEqual({
      entries: 1,
      markdownBodies: 1,
      pdfBodies: 0,
      positions: 0,
    })

    const opened = await firstStore.openMarkdownDocument(firstEntry.id, { markOpened: false })
    expect(opened?.markdown).toBe('# Second response\n\nWritten by the second tab.')
    await expect(firstStore.findMarkdownEntryByUrl(firstSource)).resolves.toMatchObject({ id: firstEntry.id })
    await expect(secondStore.findMarkdownEntryByUrl(secondSource)).resolves.toMatchObject({ id: firstEntry.id })
  })

  it('refreshes a stale quota snapshot before applying a concurrent growing URL update', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    const firstEstimate = createStorageEstimateGate({ usage: 0, quota: 1000 })
    const secondInitialEstimate = createStorageEstimateGate({ usage: 0, quota: 1000 })
    let secondEstimateCalls = 0
    const firstStore = createTestStore({
      dbName,
      createId: () => 'first-quota-document',
      estimateStorage: firstEstimate.estimateStorage,
      storageSafetyMarginBytes: 100,
    })
    const secondStore = createTestStore({
      dbName,
      createId: () => 'second-quota-document',
      estimateStorage: async () => {
        secondEstimateCalls += 1
        if (secondEstimateCalls === 1) {
          return await secondInitialEstimate.estimateStorage()
        }
        return { usage: 800, quota: 1000 }
      },
      storageSafetyMarginBytes: 100,
    })
    const source = {
      kind: 'url' as const,
      inputUrl: 'https://example.com/docs/quota-race.md',
      requestUrl: 'https://example.com/docs/quota-race.md',
      domain: 'example.com',
    }
    const firstMarkdown = 'a'.repeat(800)
    const secondMarkdown = 'b'.repeat(950)
    const firstImport = firstStore.addMarkdownDocument({ markdown: firstMarkdown, source })
    await firstEstimate.entered
    const secondImport = secondStore.addMarkdownDocument({ markdown: secondMarkdown, source })
    await secondInitialEstimate.entered

    try {
      firstEstimate.release()
      const firstEntry = await firstImport
      secondInitialEstimate.release()
      await expect(secondImport).rejects.toBeInstanceOf(LibraryQuotaExceededError)

      expect(secondEstimateCalls).toBe(2)
      const opened = await firstStore.openMarkdownDocument(firstEntry.id, { markOpened: false })
      expect(opened?.markdown).toBe(firstMarkdown)
      await expect(firstStore.countStoreEntries()).resolves.toEqual({
        entries: 1,
        markdownBodies: 1,
        pdfBodies: 0,
        positions: 0,
      })
    }
    finally {
      firstEstimate.release()
      secondInitialEstimate.release()
      await Promise.allSettled([firstImport, secondImport])
    }
  })

  it('does not recreate an existing URL entry deleted while its update is waiting for storage', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    const updateEstimate = createStorageEstimateGate()
    let estimateCalls = 0
    const updatingStore = createTestStore({
      dbName,
      estimateStorage: async () => {
        estimateCalls += 1
        return estimateCalls === 1 ? {} : updateEstimate.estimateStorage()
      },
    })
    const deletingStore = createTestStore({ dbName })
    const source = {
      kind: 'url' as const,
      inputUrl: 'https://example.com/docs/deleted.md',
      requestUrl: 'https://example.com/docs/deleted.md',
      domain: 'example.com',
    }
    const original = await updatingStore.addMarkdownDocument({
      markdown: '# Deleted while refreshing',
      source,
    })
    const pendingUpdate = updatingStore.addMarkdownDocument({
      markdown: `# Deleted while refreshing\n\n${'new content '.repeat(20)}`,
      source,
    })
    await updateEstimate.entered

    try {
      await deletingStore.deleteEntry(original.id)
      updateEstimate.release()
      await expect(pendingUpdate).rejects.toBeInstanceOf(LibraryEntryNotFoundError)
    }
    finally {
      updateEstimate.release()
      await Promise.allSettled([pendingUpdate])
    }

    await expect(updatingStore.countStoreEntries()).resolves.toEqual({
      entries: 0,
      markdownBodies: 0,
      pdfBodies: 0,
      positions: 0,
    })
  })

  it('rolls back a growing URL update that exceeds the transaction-time storage budget', async () => {
    let estimateCalls = 0
    const store = createTestStore({
      estimateStorage: async () => {
        estimateCalls += 1
        return estimateCalls === 1
          ? { usage: 0, quota: 1024 * 1024 }
          : { usage: 950, quota: 1000 }
      },
      storageSafetyMarginBytes: 0,
    })
    const source = {
      kind: 'url' as const,
      inputUrl: 'https://example.com/docs/quota.md',
      requestUrl: 'https://example.com/docs/quota.md',
      domain: 'example.com',
    }
    const originalMarkdown = '# Stored URL body'
    const original = await store.addMarkdownDocument({ markdown: originalMarkdown, source })
    await store.saveReadingPosition({
      documentId: original.id,
      type: 'markdown',
      scrollY: 275,
      activeHeadingId: 'stored-url-body',
    })

    await expect(store.addMarkdownDocument({
      markdown: `# Oversized replacement\n\n${'x'.repeat(100)}`,
      source,
    })).rejects.toBeInstanceOf(LibraryQuotaExceededError)

    const opened = await store.openMarkdownDocument(original.id, { markOpened: false })
    expect(opened?.entry).toEqual(original)
    expect(opened?.markdown).toBe(originalMarkdown)
    expect(opened?.position).toMatchObject({
      scrollY: 275,
      activeHeadingId: 'stored-url-body',
    })
    await expect(store.countStoreEntries()).resolves.toEqual({
      entries: 1,
      markdownBodies: 1,
      pdfBodies: 0,
      positions: 1,
    })
  })

  it('stores PDF entries as portable bytes without hydrating bodies into the bookshelf list', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    const store = createTestStore({ dbName })
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

    const db = await openDB(dbName, libraryDatabaseVersion)
    const storedBody = await db.get('pdfBodies', entry.id)
    db.close()
    expect(storedBody).toMatchObject({
      documentId: entry.id,
      mimeType: 'application/pdf',
      byteSize: blob.size,
      schemaVersion: 2,
    })
    expect(Object.prototype.toString.call(storedBody.bytes)).toBe('[object ArrayBuffer]')
    expect(storedBody.bytes.byteLength).toBe(blob.size)
    expect(storedBody).not.toHaveProperty('blob')

    const opened = await store.openPdfDocument(entry.id)
    expect(opened?.blob.size).toBe(blob.size)
    expect(opened?.blob.type).toBe('application/pdf')
    expect(await opened?.blob.text()).toBe('%PDF-1.7 fake')
  })

  it('opens legacy Blob-backed PDF bodies without discarding local documents', async () => {
    const dbName = `miru:test-library:${crypto.randomUUID()}`
    const store = createTestStore({ dbName })
    const entry = await store.addPdfDocument({
      blob: createPdfBlob('current body'),
      source: { kind: 'file', fileName: 'Archive.pdf', mimeType: 'application/pdf' },
    })
    const legacyBlob = createPdfBlob('legacy body')
    const db = await openDB(dbName, libraryDatabaseVersion)
    await db.put('pdfBodies', {
      documentId: entry.id,
      blob: legacyBlob,
      mimeType: 'application/pdf',
      byteSize: legacyBlob.size,
    })
    db.close()

    const opened = await store.openPdfDocument(entry.id)
    expect(opened?.blob.type).toBe('application/pdf')
    expect(await opened?.blob.text()).toBe('legacy body')
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
      viewMode: 'scroll',
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
      viewMode: 'scroll',
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
      viewMode: 'paged',
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
