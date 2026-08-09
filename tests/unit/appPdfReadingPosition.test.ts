import 'fake-indexeddb/auto'

import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import App from '@/App.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { createLibraryStore, deleteLibraryDatabase } from '@/features/library/libraryStore'
import type {
  LibraryEntry,
  OpenMarkdownDocumentResult,
  OpenPdfDocumentResult,
  PdfReadingPosition,
} from '@/features/library/types'
import { readerBookmarksStorageKey } from '@/features/reader/bookmarks'
import type { ReaderDocument } from '@/types/reader'

const libraryStoreMocks = vi.hoisted(() => ({
  addMarkdownDocument: vi.fn(),
  addPdfDocument: vi.fn(),
  clearLibrary: vi.fn(),
  close: vi.fn(),
  countStoreEntries: vi.fn(),
  deleteEntry: vi.fn(),
  findMarkdownEntryByUrl: vi.fn(),
  getReadingPosition: vi.fn(),
  isMarkdownContentChanged: vi.fn(),
  listEntries: vi.fn(),
  markOpened: vi.fn(),
  openMarkdownDocument: vi.fn(),
  openPdfDocument: vi.fn(),
  saveReadingPosition: vi.fn(),
  updateEntry: vi.fn(),
}))
const pdfJsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}))
const libraryEntriesById = new Map<string, LibraryEntry>()

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  TextLayer: class {},
  getDocument: pdfJsMocks.getDocument,
  setLayerDimensions: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: '/pdf.worker.test.mjs',
}))

vi.mock('@/features/library/lazyLibraryStore', () => ({
  createLazyLibraryStore: () => libraryStoreMocks,
  isLibraryQuotaExceededError: (reason: unknown) =>
    reason instanceof Error && reason.name === 'LibraryQuotaExceededError',
}))

vi.mock('@/features/reader/useRenderedMarkdown', async () => {
  const { shallowRef } = await import('vue')

  return {
    useRenderedMarkdown: () => ({
      error: shallowRef(null),
      html: shallowRef(''),
      isRendering: shallowRef(false),
    }),
  }
})

vi.mock('@/lib/theme/fonts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/theme/fonts')>(),
  loadDefaultReadingFonts: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/components/ReaderSurface.vue', async () => {
  const { defineComponent, h } = await import('vue')

  return {
    default: defineComponent({
      name: 'ReaderSurfaceStub',
      props: {
        document: {
          required: true,
          type: Object,
        },
      },
      setup(props, { expose }) {
        expose({
          clearSearch: vi.fn(),
          focus: vi.fn(),
          getBookmarkSnippet: vi.fn(() => ''),
          goToSearchMatch: vi.fn(),
          scrollToHeading: vi.fn(),
        })
        return () => {
          const document = props.document as ReaderDocument
          return h('article', { 'data-testid': 'reader-surface-stub' }, [
            h('h1', { 'data-testid': 'reader-document-title' }, document.label),
            h('p', { 'data-testid': 'reader-document-body' }, document.markdown),
          ])
        }
      },
    }),
  }
})

describe('App document activation and PDF reading position ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of Object.values(libraryStoreMocks)) {
      mock.mockReset()
    }
    libraryEntriesById.clear()
    libraryStoreMocks.markOpened.mockImplementation(async (id: string) => libraryEntriesById.get(id) ?? null)
    pdfJsMocks.getDocument.mockReset()
    localStorage.clear()
    stubAppRuntime()
    pdfJsMocks.getDocument.mockImplementation(() => createPdfLoadingTask(5))
  })

  afterEach(() => {
    document.body.replaceChildren()
    document.documentElement.removeAttribute('style')
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  })

  test('keeps the latest selected Markdown document active when an earlier open finishes later', async () => {
    const earlierEntry = createMarkdownEntry('earlier-a', 'Earlier A')
    const latestEntry = createMarkdownEntry('latest-b', 'Latest B')
    const earlierOpen = createDeferred<OpenMarkdownDocumentResult | null>()
    const latestOpen = createDeferred<OpenMarkdownDocumentResult | null>()

    libraryStoreMocks.listEntries.mockResolvedValue([earlierEntry, latestEntry])
    libraryStoreMocks.openMarkdownDocument.mockImplementation((id: string) =>
      id === earlierEntry.id ? earlierOpen.promise : latestOpen.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, earlierEntry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledWith(
        earlierEntry.id,
        expect.anything(),
      ))

      await openLibraryEntry(mounted.host, latestEntry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledWith(
        latestEntry.id,
        expect.anything(),
      ))

      latestOpen.resolve(createOpenMarkdownDocument(latestEntry, '# Latest body'))
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe('Latest B')
        expect(readerBody(mounted.host)).toBe('# Latest body')
      })

      earlierOpen.resolve(createOpenMarkdownDocument(earlierEntry, '# Earlier body'))
      await flushSettledWork()

      expect(readerTitle(mounted.host)).toBe('Latest B')
      expect(readerBody(mounted.host)).toBe('# Latest body')
      expect(markedLibraryEntryIds()).toContain(latestEntry.id)
      expect(markedLibraryEntryIds()).not.toContain(earlierEntry.id)
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps a later Markdown selection active when an earlier PDF open finishes last', async () => {
    const earlierEntry = createPdfEntry('earlier-pdf', 'Earlier PDF')
    const latestEntry = createMarkdownEntry('latest-markdown', 'Latest Markdown')
    const earlierOpen = createDeferred<OpenPdfDocumentResult | null>()
    const latestOpen = createDeferred<OpenMarkdownDocumentResult | null>()

    libraryStoreMocks.listEntries.mockResolvedValue([earlierEntry, latestEntry])
    libraryStoreMocks.openPdfDocument.mockReturnValue(earlierOpen.promise)
    libraryStoreMocks.openMarkdownDocument.mockReturnValue(latestOpen.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, earlierEntry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.openPdfDocument).toHaveBeenCalled())

      await openLibraryEntry(mounted.host, latestEntry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalled())

      latestOpen.resolve(createOpenMarkdownDocument(latestEntry, '# Latest cross-type body'))
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('Latest Markdown'))

      earlierOpen.resolve(createOpenPdfDocument(earlierEntry))
      await flushSettledWork()

      expect(readerTitle(mounted.host)).toBe('Latest Markdown')
      expect(readerBody(mounted.host)).toBe('# Latest cross-type body')
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps a pasted document active when an earlier library open finishes last', async () => {
    const earlierEntry = createMarkdownEntry('earlier-library', 'Earlier Library')
    const latestEntry = createMarkdownEntry('latest-paste', 'Latest Paste')
    const earlierOpen = createDeferred<OpenMarkdownDocumentResult | null>()

    libraryStoreMocks.listEntries.mockResolvedValue([earlierEntry, latestEntry])
    libraryStoreMocks.openMarkdownDocument.mockReturnValue(earlierOpen.promise)
    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(latestEntry)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, earlierEntry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalled())

      dispatchPaste(mounted.host, '# Latest pasted body')
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe('Latest Paste')
        expect(readerBody(mounted.host)).toBe('# Latest pasted body')
      })

      earlierOpen.resolve(createOpenMarkdownDocument(earlierEntry, '# Earlier library body'))
      await flushSettledWork()

      expect(readerTitle(mounted.host)).toBe('Latest Paste')
      expect(readerBody(mounted.host)).toBe('# Latest pasted body')
      expect(markedLibraryEntryIds()).not.toContain(earlierEntry.id)
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps a later library selection active when an earlier paste finishes last', async () => {
    const earlierEntry = createMarkdownEntry('earlier-paste', 'Earlier Paste')
    const latestEntry = createMarkdownEntry('latest-library', 'Latest Library')
    const earlierAdd = createDeferred<LibraryEntry>()

    libraryStoreMocks.listEntries.mockResolvedValue([latestEntry])
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(earlierAdd.promise)
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
      createOpenMarkdownDocument(latestEntry, '# Latest library body'),
    )
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Earlier pasted body')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, latestEntry.title, '打开')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('Latest Library'))

      earlierAdd.resolve(earlierEntry)
      await flushSettledWork()

      expect(readerTitle(mounted.host)).toBe('Latest Library')
      expect(readerBody(mounted.host)).toBe('# Latest library body')
      expect(markedLibraryEntryIds()).toContain(latestEntry.id)
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps an unrelated pending import durable when a library entry is deleted', async () => {
    const existingEntry = createMarkdownEntry('existing-delete', 'Existing delete')
    const pendingEntry = createMarkdownEntry('pending-import', 'Pending import')
    const pendingAdd = createDeferred<LibraryEntry>()

    libraryStoreMocks.listEntries.mockResolvedValue([existingEntry])
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(pendingAdd.promise)
    libraryStoreMocks.deleteEntry.mockResolvedValue(undefined)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Pending import')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())
      const mutation = libraryStoreMocks.addMarkdownDocument.mock.calls[0]?.[1] as { signal?: AbortSignal }

      await showLibrary(mounted.host)
      await clickLibraryEntryAction(mounted.host, existingEntry.title, '删除')
      click(mounted.host, '.library-dialog__danger')
      await vi.waitFor(() => expect(libraryStoreMocks.deleteEntry).toHaveBeenCalledWith(existingEntry.id))

      expect(mutation.signal?.aborted).toBe(false)
    }
    finally {
      pendingAdd.resolve(pendingEntry)
      mounted.unmount()
      await flushSettledWork()
    }
  })

  test('keeps the sample active when a pending library open finishes afterward', async () => {
    const earlierEntry = createMarkdownEntry('earlier-sample', 'Earlier Sample')
    const earlierOpen = createDeferred<OpenMarkdownDocumentResult | null>()

    libraryStoreMocks.listEntries.mockResolvedValue([earlierEntry])
    libraryStoreMocks.openMarkdownDocument.mockReturnValue(earlierOpen.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, earlierEntry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalled())

      click(mounted.host, '[data-testid="library-sample-entry"] .library-entry__open')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))

      earlierOpen.resolve(createOpenMarkdownDocument(earlierEntry, '# Earlier library body'))
      await flushSettledWork()

      expect(readerTitle(mounted.host)).toBe('miru sample')
      expect(readerBody(mounted.host)).toBe(sampleMarkdown)
    }
    finally {
      mounted.unmount()
    }
  })

  test('does not enter the library after a later reset becomes active', async () => {
    const currentEntry = createMarkdownEntry('current-before-library', 'Current before library')
    const pendingEntries = createDeferred<LibraryEntry[]>()

    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(currentEntry)
    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([currentEntry])
      .mockReturnValueOnce(pendingEntries.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Current before library')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('Current before library'))

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2))

      click(mounted.host, '[data-testid="floating-affordance-button"]')
      await clickButtonWithText(mounted.host, '清空当前')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))

      pendingEntries.resolve([currentEntry])
      await flushSettledWork()

      expect(mounted.host.querySelector('[data-testid="library-view"]')).toBeNull()
      expect(readerTitle(mounted.host)).toBe('miru sample')
      expect(readerBody(mounted.host)).toBe(sampleMarkdown)
    }
    finally {
      mounted.unmount()
    }
  })

  test('aborts a pending URL fetch when entering the library', async () => {
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })

    vi.stubGlobal('fetch', fetchMock)
    libraryStoreMocks.listEntries.mockResolvedValue([])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, 'https://example.com/pending.md')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(requestSignal?.aborted).toBe(false)

      await showLibrary(mounted.host)

      expect(requestSignal?.aborted).toBe(true)
    }
    finally {
      mounted.unmount()
    }
  })

  test.each(['delete', 'clear'] as const)(
    'does not reactivate a pending document after a library %s',
    async action => {
      const earlierEntry = createMarkdownEntry(`earlier-${action}`, `Earlier ${action}`)
      const earlierOpen = createDeferred<OpenMarkdownDocumentResult | null>()

      libraryStoreMocks.listEntries
        .mockResolvedValueOnce([earlierEntry])
        .mockResolvedValue([])
      libraryStoreMocks.openMarkdownDocument.mockReturnValue(earlierOpen.promise)
      libraryStoreMocks.deleteEntry.mockResolvedValue(undefined)
      libraryStoreMocks.clearLibrary.mockResolvedValue(undefined)
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp()

      try {
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, earlierEntry.title, '打开')
        await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalled())

        if (action === 'delete') {
          await clickLibraryEntryAction(mounted.host, earlierEntry.title, '删除')
          click(mounted.host, '.library-dialog__danger')
          await vi.waitFor(() => expect(libraryStoreMocks.deleteEntry).toHaveBeenCalledWith(earlierEntry.id))
        }
        else {
          click(mounted.host, '[data-testid="library-management-button"]')
          await vi.waitFor(() => expect(
            mounted.host.querySelector('[data-testid="library-clear-button"]'),
          ).not.toBeNull())
          click(mounted.host, '[data-testid="library-clear-button"]')
          await vi.waitFor(() => expect(
            mounted.host.querySelector('.library-dialog__danger'),
          ).not.toBeNull())
          click(mounted.host, '.library-dialog__danger')
          await vi.waitFor(() => expect(libraryStoreMocks.clearLibrary).toHaveBeenCalled())
        }

        earlierOpen.resolve(createOpenMarkdownDocument(earlierEntry, '# Deleted body'))
        await flushSettledWork()

        expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull()
        click(mounted.host, '[data-testid="library-open-button"]')
        await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))
        expect(readerBody(mounted.host)).toBe(sampleMarkdown)
        expect(markedLibraryEntryIds()).not.toContain(earlierEntry.id)
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test.each(['delete', 'clear'] as const)(
    'reconciles the library after a pending %s is superseded by the add menu',
    async action => {
      const entry = createMarkdownEntry(`stale-list-${action}`, `Stale list ${action}`)
      const mutation = createDeferred<void>()

      libraryStoreMocks.listEntries
        .mockResolvedValueOnce([entry])
        .mockResolvedValue([])
      libraryStoreMocks.deleteEntry.mockReturnValue(mutation.promise)
      libraryStoreMocks.clearLibrary.mockReturnValue(mutation.promise)
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp()

      try {
        await showLibrary(mounted.host)

        if (action === 'delete') {
          await clickLibraryEntryAction(mounted.host, entry.title, '删除')
          click(mounted.host, '.library-dialog__danger')
          await vi.waitFor(() => expect(libraryStoreMocks.deleteEntry).toHaveBeenCalledWith(entry.id))
        }
        else {
          click(mounted.host, '[data-testid="library-management-button"]')
          await vi.waitFor(() => expect(
            mounted.host.querySelector('[data-testid="library-clear-button"]'),
          ).not.toBeNull())
          click(mounted.host, '[data-testid="library-clear-button"]')
          await vi.waitFor(() => expect(
            mounted.host.querySelector('.library-dialog__danger'),
          ).not.toBeNull())
          click(mounted.host, '.library-dialog__danger')
          await vi.waitFor(() => expect(libraryStoreMocks.clearLibrary).toHaveBeenCalled())
        }

        click(mounted.host, '[data-testid="library-add-button"]')
        mutation.resolve(undefined)
        await flushSettledWork()

        expect(mounted.host.querySelectorAll('[data-testid="library-entry"]')).toHaveLength(0)
        expect(mounted.host.querySelector('[data-testid="library-empty"]')).not.toBeNull()
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test('does not let a stale guarded refresh suppress deletion reconciliation', async () => {
    const entry = createMarkdownEntry('refresh-race', 'Refresh race')
    const deletion = createDeferred<void>()
    const open = createDeferred<OpenMarkdownDocumentResult | null>()
    const deletionRefresh = createDeferred<LibraryEntry[]>()
    const staleOpenRefresh = createDeferred<LibraryEntry[]>()

    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([entry])
      .mockReturnValueOnce(deletionRefresh.promise)
      .mockReturnValueOnce(staleOpenRefresh.promise)
    libraryStoreMocks.deleteEntry.mockReturnValue(deletion.promise)
    libraryStoreMocks.openMarkdownDocument.mockReturnValue(open.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await clickLibraryEntryAction(mounted.host, entry.title, '删除')
      click(mounted.host, '.library-dialog__danger')
      await vi.waitFor(() => expect(libraryStoreMocks.deleteEntry).toHaveBeenCalledWith(entry.id))

      await clickLibraryEntryAction(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalled())

      deletion.resolve(undefined)
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2))
      open.resolve(null)
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(3))

      click(mounted.host, '[data-testid="library-add-button"]')
      staleOpenRefresh.resolve([])
      deletionRefresh.resolve([])
      await flushSettledWork()

      expect(mounted.host.querySelectorAll('[data-testid="library-entry"]')).toHaveLength(0)
      expect(mounted.host.querySelector('[data-testid="library-empty"]')).not.toBeNull()
    }
    finally {
      mounted.unmount()
    }
  })

  test.each(['delete', 'clear'] as const)(
    'falls back to the sample when a pending PDF %s is superseded by return to reading',
    async action => {
      const entry = createPdfEntry(`active-pdf-${action}`, `Active PDF ${action}`)
      const opened = createOpenPdfDocument(entry)
      const mutation = createDeferred<void>()
      let visibleEntries = [entry]

      libraryStoreMocks.listEntries.mockImplementation(async () => visibleEntries)
      libraryStoreMocks.openPdfDocument.mockResolvedValue(opened)
      libraryStoreMocks.deleteEntry.mockReturnValue(mutation.promise)
      libraryStoreMocks.clearLibrary.mockReturnValue(mutation.promise)
      libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
        ...position,
        updatedAt: '2026-08-09T00:00:01.000Z',
      }))
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp()

      try {
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, entry.title)
        await vi.waitFor(() => {
          expect(mounted.host.querySelector('[data-testid="library-view"]')).toBeNull()
          expect(mounted.host.textContent).toContain(entry.title)
        })
        await showLibrary(mounted.host)

        if (action === 'delete') {
          await clickLibraryEntryAction(mounted.host, entry.title, '删除')
          click(mounted.host, '.library-dialog__danger')
          await vi.waitFor(() => expect(libraryStoreMocks.deleteEntry).toHaveBeenCalledWith(entry.id))
        }
        else {
          click(mounted.host, '[data-testid="library-management-button"]')
          await vi.waitFor(() => expect(
            mounted.host.querySelector('[data-testid="library-clear-button"]'),
          ).not.toBeNull())
          click(mounted.host, '[data-testid="library-clear-button"]')
          await vi.waitFor(() => expect(
            mounted.host.querySelector('.library-dialog__danger'),
          ).not.toBeNull())
          click(mounted.host, '.library-dialog__danger')
          await vi.waitFor(() => expect(libraryStoreMocks.clearLibrary).toHaveBeenCalled())
        }

        click(mounted.host, '[data-testid="library-open-button"]')
        visibleEntries = []
        mutation.resolve(undefined)
        await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))

        expect(readerBody(mounted.host)).toBe(sampleMarkdown)
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test('does not apply a completed save to a PDF opened while that save was pending', async () => {
    const slowEntry = createPdfEntry('slow-a', 'Slow A')
    const fastEntry = createPdfEntry('fast-b', 'Fast B')
    const slowPosition = createPdfPosition(slowEntry.id, 3)
    const slowOpened = createOpenPdfDocument(slowEntry, slowPosition)
    const fastOpened = createOpenPdfDocument(fastEntry)
    const openedDocuments = new Map<string, OpenPdfDocumentResult>([
      [slowEntry.id, slowOpened],
      [fastEntry.id, fastOpened],
    ])
    const slowSave = createDeferred<PdfReadingPosition>()
    const fastRead = createDeferred<ArrayBuffer>()

    vi.spyOn(slowOpened.blob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(5).buffer)
    const fastBlobRead = vi.spyOn(fastOpened.blob, 'arrayBuffer')
      .mockImplementation(() => fastRead.promise)

    libraryStoreMocks.listEntries.mockResolvedValue([slowEntry, fastEntry])
    libraryStoreMocks.openPdfDocument.mockImplementation(async (id: string) =>
      openedDocuments.get(id) ?? null)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async (position) => {
      if (position.documentId === slowEntry.id) {
        return slowSave.promise
      }

      return {
        ...position,
        updatedAt: '2026-08-08T00:00:01.000Z',
      }
    })
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalled())
      await flushSettledWork()
      await openLibraryEntry(mounted.host, slowEntry.title)
      await vi.waitFor(() => {
        expect(mounted.host.textContent).toContain('Slow A')
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(expect.objectContaining({
          documentId: slowEntry.id,
          pageNumber: 3,
          type: 'pdf',
        }))
      })

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull())
      await openLibraryEntry(mounted.host, fastEntry.title)
      await vi.waitFor(() => {
        expect(mounted.host.textContent).toContain('Fast B')
        expect(fastBlobRead).toHaveBeenCalledOnce()
      })
      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalledWith(expect.objectContaining({
        documentId: fastEntry.id,
      }))

      slowSave.resolve({
        ...slowPosition,
        updatedAt: '2026-08-08T00:00:03.000Z',
      })
      await flushSettledWork()

      expect(mounted.host.textContent).toContain('Fast B')
      click(mounted.host, '[data-testid="floating-affordance-button"]')
      await clickButtonWithText(mounted.host, '书签此处')

      const bookmarks = JSON.parse(localStorage.getItem(readerBookmarksStorageKey) ?? '[]')
      expect(bookmarks).toEqual([
        expect.objectContaining({
          documentKey: `library:${fastEntry.id}`,
          documentTitle: fastEntry.title,
          kind: 'pdf-page',
          target: { pageNumber: 1 },
        }),
      ])
    }
    finally {
      mounted.unmount()
      fastRead.resolve(Uint8Array.of(5).buffer)
      await flushSettledWork()
    }
  })

  test('does not apply a save from an earlier activation of the same PDF', async () => {
    const entry = createPdfEntry('same-pdf', 'Same PDF')
    const stalePosition = createPdfPosition(entry.id, 3)
    const firstOpen = createOpenPdfDocument(entry, stalePosition)
    const secondOpen = createOpenPdfDocument(entry)
    const staleSave = createDeferred<PdfReadingPosition>()
    const secondRead = createDeferred<ArrayBuffer>()

    vi.spyOn(firstOpen.blob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(5).buffer)
    const secondBlobRead = vi.spyOn(secondOpen.blob, 'arrayBuffer')
      .mockImplementation(() => secondRead.promise)
    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openPdfDocument
      .mockResolvedValueOnce(firstOpen)
      .mockResolvedValueOnce(secondOpen)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async (position) => {
      if (position.pageNumber === stalePosition.pageNumber) {
        return staleSave.promise
      }

      return {
        ...position,
        updatedAt: '2026-08-08T00:00:01.000Z',
      }
    })
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull())
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 3 }),
      ))

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull())
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => {
        expect(mounted.host.textContent).toContain(entry.title)
        expect(secondBlobRead).toHaveBeenCalledOnce()
      })
      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 1 }),
      )

      staleSave.resolve({
        ...stalePosition,
        updatedAt: '2026-08-08T00:00:03.000Z',
      })
      await flushSettledWork()

      await bookmarkCurrentPdf(mounted.host)
      expect(readBookmarks()).toEqual([
        expect.objectContaining({
          documentKey: `library:${entry.id}`,
          kind: 'pdf-page',
          target: { pageNumber: 1 },
        }),
      ])
    }
    finally {
      mounted.unmount()
      secondRead.resolve(Uint8Array.of(5).buffer)
      await flushSettledWork()
    }
  })

  test('keeps the newest position when an earlier save finishes later in the same activation', async () => {
    const entry = createPdfEntry('same-activation', 'Same activation')
    const stalePosition = createPdfPosition(entry.id, 3)
    const opened = createOpenPdfDocument(entry, stalePosition)
    const staleSave = createDeferred<PdfReadingPosition>()

    vi.spyOn(opened.blob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(5).buffer)
    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openPdfDocument.mockResolvedValue(opened)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async (position) => {
      if (position.pageNumber === stalePosition.pageNumber) {
        return staleSave.promise
      }

      return {
        ...position,
        updatedAt: '2026-08-08T00:00:01.000Z',
      }
    })
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull())
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 3 }),
      ))

      await vi.waitFor(() => {
        const nextPage = mounted.host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')
        expect(nextPage?.disabled).toBe(false)
      })
      click(mounted.host, '[aria-label="下一页"]')
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 4 }),
      ))
      await flushSettledWork()

      staleSave.resolve({
        ...stalePosition,
        updatedAt: '2026-08-08T00:00:03.000Z',
      })
      await flushSettledWork()

      await bookmarkCurrentPdf(mounted.host)
      expect(readBookmarks()).toEqual([
        expect.objectContaining({
          documentKey: `library:${entry.id}`,
          kind: 'pdf-page',
          target: { pageNumber: 4 },
        }),
      ])
    }
    finally {
      mounted.unmount()
    }
  })

  test('preserves the latest pending position when returning to a PDF from the library', async () => {
    const entry = createPdfEntry('return-to-pdf', 'Return to PDF')
    const currentPosition = createPdfPosition(entry.id, 2)
    const stalePosition = createPdfPosition(entry.id, 3)
    const opened = createOpenPdfDocument(entry, currentPosition)
    const staleSave = createDeferred<PdfReadingPosition>()
    const returnRead = createDeferred<ArrayBuffer>()
    const blobRead = vi.spyOn(opened.blob, 'arrayBuffer')
      .mockResolvedValueOnce(Uint8Array.of(5).buffer)
      .mockImplementation(() => returnRead.promise)

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openPdfDocument.mockResolvedValue(opened)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async (position) => {
      if (position.pageNumber === stalePosition.pageNumber) {
        return staleSave.promise
      }

      return {
        ...position,
        updatedAt: '2026-08-09T00:00:01.000Z',
      }
    })
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull())
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 2 }),
      ))

      click(mounted.host, '[aria-label="下一页"]')
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 3 }),
      ))

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull())
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => {
        expect(mounted.host.textContent).toContain(entry.title)
        expect(blobRead).toHaveBeenCalledTimes(2)
      })

      await bookmarkCurrentPdf(mounted.host)
      expect(readBookmarks()).toEqual([
        expect.objectContaining({
          documentKey: `library:${entry.id}`,
          kind: 'pdf-page',
          target: { pageNumber: 3 },
        }),
      ])

      staleSave.resolve({
        ...stalePosition,
        updatedAt: '2026-08-09T00:00:03.000Z',
      })
      await flushSettledWork()
    }
    finally {
      mounted.unmount()
      returnRead.resolve(Uint8Array.of(5).buffer)
      await flushSettledWork()
    }
  })
})

describe('library activation persistence contract', () => {
  test('keeps read-only opens unmarked until the active document is committed', async () => {
    await withLibraryStore(async (store) => {
      const entry = await store.addMarkdownDocument({
        markdown: '# Read-only open',
        source: { kind: 'paste' },
      })

      const opened = await store.openMarkdownDocument(entry.id, { markOpened: false })
      expect(opened?.entry.lastOpenedAt).toBe(entry.lastOpenedAt)
      expect((await store.listEntries())[0]?.lastOpenedAt).toBe(entry.lastOpenedAt)

      const marked = await store.markOpened(entry.id)
      expect(marked?.lastOpenedAt).not.toBe(entry.lastOpenedAt)
      expect((await store.listEntries())[0]?.lastOpenedAt).toBe(marked?.lastOpenedAt)
    })
  })

  test.each(['delete', 'clear'] as const)(
    'does not recreate a read snapshot after %s',
    async action => {
      await withLibraryStore(async (store) => {
        const entry = await store.addMarkdownDocument({
          markdown: `# ${action} snapshot`,
          source: { kind: 'paste' },
        })
        expect(await store.openMarkdownDocument(entry.id, { markOpened: false })).not.toBeNull()

        if (action === 'delete') {
          await store.deleteEntry(entry.id)
        }
        else {
          await store.clearLibrary()
        }

        expect(await store.markOpened(entry.id)).toBeNull()
        expect(await store.countStoreEntries()).toEqual({
          entries: 0,
          markdownBodies: 0,
          pdfBodies: 0,
          positions: 0,
        })
      })
    },
  )

  test('cancels an import that has not committed before the library is cleared', async () => {
    const estimateStarted = createDeferred<void>()
    const estimateResult = createDeferred<StorageEstimate>()
    const controller = new AbortController()

    await withLibraryStore(async (store) => {
      const pendingAdd = store.addMarkdownDocument({
        markdown: '# Pending import',
        source: { kind: 'paste' },
      }, { signal: controller.signal })

      await estimateStarted.promise
      controller.abort()
      await store.clearLibrary()
      estimateResult.resolve({ quota: 1024 * 1024, usage: 0 })

      await expect(pendingAdd).rejects.toMatchObject({ name: 'AbortError' })
      expect(await store.countStoreEntries()).toEqual({
        entries: 0,
        markdownBodies: 0,
        pdfBodies: 0,
        positions: 0,
      })
    }, {
      estimateStorage: () => {
        estimateStarted.resolve(undefined)
        return estimateResult.promise
      },
    })
  })

  test('does not mark a stale URL update as opened', async () => {
    await withLibraryStore(async (store) => {
      const source = {
        domain: 'example.com',
        inputUrl: 'https://example.com/note.md',
        kind: 'url' as const,
        requestUrl: 'https://example.com/note.md',
      }
      const entry = await store.addMarkdownDocument({
        markdown: '# Original',
        source,
      })

      const updated = await store.addMarkdownDocument({
        markdown: '# Updated',
        source,
      }, { markOpened: false })

      expect(updated.lastOpenedAt).toBe(entry.lastOpenedAt)
      expect((await store.openMarkdownDocument(entry.id, { markOpened: false }))?.markdown).toBe('# Updated')
    })
  })

  test('keeps unopened imports behind documents that were actually opened', async () => {
    await withLibraryStore(async (store) => {
      const opened = await store.addMarkdownDocument({
        markdown: '# Opened first',
        source: { kind: 'paste' },
      })
      const unopened = await store.addMarkdownDocument({
        markdown: '# Unopened later',
        source: { kind: 'paste' },
      }, { markOpened: false })

      expect((await store.listEntries()).map(entry => entry.id)).toEqual([opened.id, unopened.id])
    })
  })

  test('aborts an older delayed URL update before it can overwrite a newer update', async () => {
    const estimateStarted = createDeferred<void>()
    const estimateResult = createDeferred<StorageEstimate>()
    const olderController = new AbortController()
    let estimateCallCount = 0

    await withLibraryStore(async (store) => {
      const source = {
        domain: 'example.com',
        inputUrl: 'https://example.com/latest.md',
        kind: 'url' as const,
        requestUrl: 'https://example.com/latest.md',
      }
      const entry = await store.addMarkdownDocument({
        markdown: '# Original body',
        source,
      })
      const olderUpdate = store.addMarkdownDocument({
        markdown: `# Older request\n\n${'x'.repeat(100)}`,
        source,
      }, {
        markOpened: false,
        signal: olderController.signal,
      })

      await estimateStarted.promise
      const newer = await store.addMarkdownDocument({
        markdown: '# Newer',
        source,
      }, { markOpened: false })
      olderController.abort()
      estimateResult.resolve({ quota: 1024 * 1024, usage: 0 })

      await expect(olderUpdate).rejects.toMatchObject({ name: 'AbortError' })
      expect(newer.id).toBe(entry.id)
      expect((await store.openMarkdownDocument(entry.id, { markOpened: false }))?.markdown).toBe('# Newer')
    }, {
      estimateStorage: async () => {
        estimateCallCount += 1
        if (estimateCallCount === 1) {
          return { quota: 1024 * 1024, usage: 0 }
        }

        estimateStarted.resolve(undefined)
        return estimateResult.promise
      },
    })
  })

  test.each(['delete', 'clear'] as const)(
    'does not recreate an orphan reading position during %s',
    async action => {
      await withLibraryStore(async (store) => {
        const entry = await store.addMarkdownDocument({
          markdown: `# Position ${action}`,
          source: { kind: 'paste' },
        })

        const destructive = action === 'delete'
          ? store.deleteEntry(entry.id)
          : store.clearLibrary()
        const save = store.saveReadingPosition({
          activeHeadingId: null,
          documentId: entry.id,
          scrollY: 120,
          type: 'markdown',
        })
        await Promise.all([destructive, save])

        expect(await store.countStoreEntries()).toEqual({
          entries: 0,
          markdownBodies: 0,
          pdfBodies: 0,
          positions: 0,
        })
      })
    },
  )
})

async function withLibraryStore(
  run: (store: ReturnType<typeof createLibraryStore>) => Promise<void>,
  options: { estimateStorage?: () => Promise<StorageEstimate> } = {},
): Promise<void> {
  const dbName = `miru:test-activation:${crypto.randomUUID()}`
  let tick = 0
  const store = createLibraryStore({
    dbName,
    estimateStorage: options.estimateStorage ?? (async () => ({ quota: 1024 * 1024, usage: 0 })),
    now: () => new Date(Date.UTC(2026, 7, 9, 0, 0, tick++)).toISOString(),
    storageSafetyMarginBytes: 0,
  })

  try {
    await run(store)
  }
  finally {
    await store.close()
    await deleteLibraryDatabase(dbName)
  }
}

function mountApp() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(App)
  let isMounted = true
  app.mount(host)

  return {
    host,
    unmount() {
      if (isMounted) {
        app.unmount()
        isMounted = false
      }
      host.remove()
    },
  }
}

function click(host: HTMLElement, selector: string): void {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button).not.toBeNull()
  button?.click()
}

async function showLibrary(host: HTMLElement): Promise<void> {
  click(host, '[data-testid="library-open-button"]')
  await vi.waitFor(() => expect(host.querySelector('[data-testid="library-view"]')).not.toBeNull())
}

async function openLibraryEntry(host: HTMLElement, title: string, action = '看原件'): Promise<void> {
  await clickLibraryEntryAction(host, title, action)
}

async function clickLibraryEntryAction(host: HTMLElement, title: string, action: string): Promise<void> {
  let openButton: HTMLButtonElement | undefined
  await vi.waitFor(() => {
    const entry = [...host.querySelectorAll<HTMLElement>('[data-testid="library-entry"]')]
      .find(candidate => candidate.textContent?.includes(title))
    openButton = [...(entry?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => button.textContent?.trim() === action)
    expect(openButton).toBeDefined()
  })
  openButton?.click()
}

function dispatchPaste(host: HTMLElement, markdown: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => type === 'text/plain' ? markdown : '',
    },
  })
  host.querySelector('main')?.dispatchEvent(event)
}

function readerTitle(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="reader-document-title"]')?.textContent ?? undefined
}

function readerBody(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="reader-document-body"]')?.textContent ?? undefined
}

function markedLibraryEntryIds(): string[] {
  return libraryStoreMocks.markOpened.mock.calls.map(([id]) => id as string)
}

async function clickButtonWithText(host: HTMLElement, text: string): Promise<void> {
  let button: HTMLButtonElement | undefined
  await vi.waitFor(() => {
    button = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(candidate => candidate.textContent?.includes(text))
    expect(button).toBeDefined()
  })
  button?.click()
}

async function bookmarkCurrentPdf(host: HTMLElement): Promise<void> {
  click(host, '[data-testid="floating-affordance-button"]')
  await clickButtonWithText(host, '书签此处')
}

function readBookmarks(): unknown[] {
  return JSON.parse(localStorage.getItem(readerBookmarksStorageKey) ?? '[]')
}

function stubAppRuntime(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  vi.stubGlobal('matchMedia', (media: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
    writable: true,
  })
}

class ResizeObserverStub {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

class IntersectionObserverStub {
  disconnect(): void {}

  observe(): void {}

  unobserve(): void {}
}

function createMarkdownEntry(id: string, title: string): LibraryEntry {
  const entry: LibraryEntry = {
    byteSize: 1,
    createdAt: '2026-08-08T00:00:00.000Z',
    id,
    lastOpenedAt: null,
    pinned: false,
    schemaVersion: 1,
    sortTitle: title.toLocaleLowerCase(),
    source: { kind: 'paste' },
    title,
    type: 'markdown',
    updatedAt: '2026-08-08T00:00:00.000Z',
  }
  libraryEntriesById.set(entry.id, entry)
  return entry
}

function createPdfEntry(id: string, title: string): LibraryEntry {
  const entry: LibraryEntry = {
    byteSize: 1,
    createdAt: '2026-08-08T00:00:00.000Z',
    id,
    lastOpenedAt: null,
    pinned: false,
    schemaVersion: 1,
    sortTitle: title.toLocaleLowerCase(),
    source: {
      fileName: `${title}.pdf`,
      kind: 'file',
      mimeType: 'application/pdf',
    },
    title,
    type: 'pdf',
    updatedAt: '2026-08-08T00:00:00.000Z',
  }
  libraryEntriesById.set(entry.id, entry)
  return entry
}

function createOpenMarkdownDocument(
  entry: LibraryEntry,
  markdown: string,
): OpenMarkdownDocumentResult {
  return {
    entry,
    markdown,
    position: null,
  }
}

function createOpenPdfDocument(
  entry: LibraryEntry,
  position: PdfReadingPosition | null = null,
): OpenPdfDocumentResult {
  return {
    blob: new Blob([Uint8Array.of(1)], { type: 'application/pdf' }),
    entry,
    position,
  }
}

function createPdfPosition(documentId: string, pageNumber: number): PdfReadingPosition {
  return {
    documentId,
    pageNumber,
    scale: null,
    scaleMode: 'fit-width',
    type: 'pdf',
    updatedAt: '2026-08-08T00:00:00.000Z',
    viewMode: 'paged',
  }
}

function createPdfLoadingTask(numPages: number) {
  const page = createPdfPage()
  const loadingTask = {
    destroy: vi.fn().mockResolvedValue(undefined),
    promise: Promise.resolve<unknown>(undefined),
  }
  const pdfDocument = {
    getPage: vi.fn().mockResolvedValue(page),
    loadingTask,
    numPages,
  }
  loadingTask.promise = Promise.resolve(pdfDocument)
  return loadingTask
}

function createPdfPage() {
  const renderTask = {
    cancel: vi.fn(),
    promise: Promise.resolve(),
  }
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      height: 792 * scale,
      scale,
      width: 612 * scale,
    }),
    render: vi.fn(() => renderTask),
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

async function flushSettledWork(): Promise<void> {
  await Promise.resolve()
  await nextTick()
  await new Promise<void>(resolve => window.setTimeout(resolve, 0))
  await nextTick()
}
