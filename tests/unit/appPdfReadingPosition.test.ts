import 'fake-indexeddb/auto'

import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import App from '@/App.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { createLibraryStore, deleteLibraryDatabase } from '@/features/library/libraryStore'
import type {
  LibraryEntry,
  LibrarySortMode,
  MarkdownReadingPosition,
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

  test.each(['markdown', 'pdf'] as const)(
    'keeps a %s library entry available for retry after its body read fails',
    async entryType => {
      const entry = entryType === 'markdown'
        ? createMarkdownEntry('retry-markdown-read', 'Retry Markdown read')
        : createPdfEntry('retry-pdf-read', 'Retry PDF read')
      const readError = new Error(`${entryType} body read failed`)
      const appErrors: unknown[] = []

      libraryStoreMocks.listEntries.mockResolvedValue([entry])
      if (entryType === 'markdown') {
        libraryStoreMocks.openMarkdownDocument
          .mockRejectedValueOnce(readError)
          .mockResolvedValue(createOpenMarkdownDocument(entry, '# Retry Markdown read\n\nRecovered.'))
      }
      else {
        libraryStoreMocks.openPdfDocument
          .mockRejectedValueOnce(readError)
          .mockResolvedValue(createOpenPdfDocument(entry))
      }
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp(error => appErrors.push(error))

      try {
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, entry.title, entryType === 'markdown' ? '打开' : '看原件')
        await vi.waitFor(() => expect(
          entryType === 'markdown'
            ? libraryStoreMocks.openMarkdownDocument
            : libraryStoreMocks.openPdfDocument,
        ).toHaveBeenCalledTimes(1))
        await flushSettledWork()

        expect(mounted.host.querySelector('[data-testid="library-view"]')).not.toBeNull()
        expect(hasLibraryEntry(mounted.host, entry.title)).toBe(true)
        expect(libraryViewStatus(mounted.host)).toContain('暂时无法打开')
        expect(libraryViewStatus(mounted.host)).toContain('请稍后重试')
        expect(libraryStoreMocks.markOpened).not.toHaveBeenCalled()
        expect(appErrors).toEqual([])

        await openLibraryEntry(mounted.host, entry.title, entryType === 'markdown' ? '打开' : '看原件')
        if (entryType === 'markdown') {
          await vi.waitFor(() => {
            expect(readerTitle(mounted.host)).toBe(entry.title)
            expect(readerBody(mounted.host)).toContain('Recovered.')
          })
        }
        else {
          await vi.waitFor(() => {
            expect(mounted.host.querySelector('[data-testid="pdf-viewer"]')).not.toBeNull()
            expect(mounted.host.textContent).toContain(entry.title)
          })
        }

        expect(appErrors).toEqual([])
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test.each(['markdown', 'pdf'] as const)(
    'opens a %s library entry when only its recent-open metadata update fails',
    async entryType => {
      const entry = entryType === 'markdown'
        ? createMarkdownEntry('metadata-markdown-read', 'Metadata Markdown read')
        : createPdfEntry('metadata-pdf-read', 'Metadata PDF read')
      const appErrors: unknown[] = []

      libraryStoreMocks.listEntries.mockResolvedValue([entry])
      libraryStoreMocks.markOpened.mockRejectedValueOnce(new Error('recent-open metadata update failed'))
      if (entryType === 'markdown') {
        libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
          createOpenMarkdownDocument(entry, '# Metadata Markdown read\n\nReadable.'),
        )
      }
      else {
        libraryStoreMocks.openPdfDocument.mockResolvedValue(createOpenPdfDocument(entry))
      }
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp(error => appErrors.push(error))

      try {
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, entry.title, entryType === 'markdown' ? '打开' : '看原件')
        await vi.waitFor(() => expect(libraryStoreMocks.markOpened).toHaveBeenCalledWith(
          entry.id,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ))

        if (entryType === 'markdown') {
          await vi.waitFor(() => {
            expect(readerTitle(mounted.host)).toBe(entry.title)
            expect(readerBody(mounted.host)).toContain('Readable.')
          })
        }
        else {
          await vi.waitFor(() => {
            expect(mounted.host.querySelector('[data-testid="pdf-viewer"]')).not.toBeNull()
            expect(mounted.host.textContent).toContain(entry.title)
          })
        }

        await vi.waitFor(() => expect(
          mounted.host.querySelector('.app-shell__live-status')?.textContent,
        ).toContain('最近打开时间暂时无法更新'))
        expect(mounted.host.querySelector('[data-testid="library-view"]')).toBeNull()
        expect(appErrors).toEqual([])
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test('ignores a stale library read failure after a newer document activates', async () => {
    const earlierEntry = createMarkdownEntry('stale-read-earlier', 'Stale read earlier')
    const latestEntry = createMarkdownEntry('stale-read-latest', 'Stale read latest')
    const earlierRead = createDeferred<OpenMarkdownDocumentResult | null>()
    const appErrors: unknown[] = []

    libraryStoreMocks.listEntries.mockResolvedValue([earlierEntry, latestEntry])
    libraryStoreMocks.openMarkdownDocument.mockImplementation(id => id === earlierEntry.id
      ? earlierRead.promise
      : Promise.resolve(createOpenMarkdownDocument(latestEntry, '# Stale read latest\n\nCurrent.')))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, earlierEntry.title, '打开')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledWith(
        earlierEntry.id,
        expect.anything(),
      ))

      await openLibraryEntry(mounted.host, latestEntry.title, '打开')
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe(latestEntry.title)
        expect(readerBody(mounted.host)).toContain('Current.')
      })

      earlierRead.reject(new Error('stale body read failed'))
      await flushSettledWork()

      expect(readerTitle(mounted.host)).toBe(latestEntry.title)
      expect(readerBody(mounted.host)).toContain('Current.')
      expect(markedLibraryEntryIds()).toContain(latestEntry.id)
      expect(markedLibraryEntryIds()).not.toContain(earlierEntry.id)
      expect(appErrors).toEqual([])
    }
    finally {
      earlierRead.resolve(null)
      mounted.unmount()
    }
  })

  test('keeps an existing URL conflict retryable after its library read fails', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/retry-existing.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/retry-existing.md',
    }
    const entry = createMarkdownEntry('retry-existing-url', 'Retry existing URL')
    const appErrors: unknown[] = []
    entry.source = source

    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument
      .mockRejectedValueOnce(new Error('existing URL body read failed'))
      .mockResolvedValue(createOpenMarkdownDocument(entry, '# Retry existing URL\n\nRecovered existing body.'))
    libraryStoreMocks.markOpened.mockRejectedValueOnce(new Error('existing URL metadata update failed'))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Retry existing URL\n\nFetched body.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp(error => appErrors.push(error))

    try {
      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())

      await clickButtonWithText(mounted.host, '打开已有')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="url-import-conflict"]')).not.toBeNull()
        expect(
          mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
        ).toContain('暂时无法打开')
      })
      expect(appErrors).toEqual([])

      await clickButtonWithText(mounted.host, '打开已有')
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe(entry.title)
        expect(readerBody(mounted.host)).toContain('Recovered existing body.')
      })
      expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledTimes(2)
      expect(mounted.host.querySelector('.app-shell__live-status')?.textContent)
        .toContain('最近打开时间暂时无法更新')
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  test('does not restore an existing URL conflict after its library entry is removed', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/missing-existing.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/missing-existing.md',
    }
    const entry = createMarkdownEntry('missing-existing-url', 'Missing existing URL')
    const appErrors: unknown[] = []
    entry.source = source

    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.listEntries.mockResolvedValue([])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(null)
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Missing existing URL\n\nFetched body.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp(error => appErrors.push(error))

    try {
      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())

      await clickButtonWithText(mounted.host, '打开已有')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
      ).toContain('已经不在文库中'))

      expect(mounted.host.querySelector('[data-testid="url-import-conflict"]')).toBeNull()
      expect(
        mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
      ).not.toContain('暂时无法打开')
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps an unchanged URL update retryable after its committed body read fails', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/retry-unchanged.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/retry-unchanged.md',
    }
    const entry = createMarkdownEntry('retry-unchanged-url', 'Retry unchanged URL')
    const appErrors: unknown[] = []
    entry.source = source

    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(false)
    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument
      .mockRejectedValueOnce(new Error('unchanged URL body read failed'))
      .mockResolvedValue(createOpenMarkdownDocument(entry, '# Retry unchanged URL\n\nRecovered unchanged body.'))
    libraryStoreMocks.markOpened.mockRejectedValueOnce(new Error('unchanged URL metadata update failed'))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Retry unchanged URL\n\nSame fetched body.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp(error => appErrors.push(error))

    try {
      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())

      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="url-import-conflict"]')).not.toBeNull()
        expect(
          mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
        ).toContain('暂时无法打开')
      })
      expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalledTimes(1)
      expect(appErrors).toEqual([])

      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe(entry.title)
        expect(readerBody(mounted.host)).toContain('Recovered unchanged body.')
      })
      expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalledTimes(2)
      expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledTimes(2)
      expect(mounted.host.querySelector('.app-shell__live-status')?.textContent)
        .toContain('最近打开时间暂时无法更新')
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  test('does not restore an unchanged URL conflict after its updated entry is removed', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/missing-unchanged.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/missing-unchanged.md',
    }
    const entry = createMarkdownEntry('missing-unchanged-url', 'Missing unchanged URL')
    const appErrors: unknown[] = []
    entry.source = source

    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(false)
    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries.mockResolvedValue([])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(null)
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Missing unchanged URL\n\nSame fetched body.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp(error => appErrors.push(error))

    try {
      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())

      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
      ).toContain('已经不在文库中'))

      expect(mounted.host.querySelector('[data-testid="url-import-conflict"]')).toBeNull()
      expect(
        mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
      ).not.toContain('暂时无法打开')
      expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalledOnce()
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  test('activates changed URL content without rereading the committed library body', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/updated-in-memory.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/updated-in-memory.md',
    }
    const entry = createMarkdownEntry('updated-in-memory-url', 'Updated in-memory URL')
    const appErrors: unknown[] = []
    entry.source = source

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument
      .mockResolvedValueOnce(createOpenMarkdownDocument(entry, '# Updated in-memory URL\n\nOriginal body.'))
      .mockRejectedValue(new Error('committed body reread failed'))
    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(true)
    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Updated in-memory URL\n\nUpdated body.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original body.'))
      libraryStoreMocks.markOpened.mockRejectedValueOnce(new Error('changed URL metadata update failed'))

      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())
      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe(entry.title)
        expect(readerBody(mounted.host)).toContain('Updated body.')
      })

      expect(libraryStoreMocks.openMarkdownDocument).toHaveBeenCalledTimes(1)
      expect(mounted.host.querySelector('.app-shell__live-status')?.textContent)
        .toContain('最近打开时间暂时无法更新')
      expect(appErrors).toEqual([])

      libraryStoreMocks.saveReadingPosition.mockClear()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubGlobal('scrollY', 360)
      window.dispatchEvent(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(450)
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: entry.id,
          scrollY: 360,
          type: 'markdown',
        }),
      ))
    }
    finally {
      if (vi.isFakeTimers()) {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      mounted.unmount()
    }
  })

  test('keeps an imported Markdown document active when the library refresh fails', async () => {
    const entry = createMarkdownEntry('markdown-refresh-failure', 'Markdown refresh failure')

    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries
      .mockRejectedValueOnce(new Error('library refresh failed'))
      .mockResolvedValue([entry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Markdown refresh failure')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(entry.title))
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="floating-affordance-menu"]')).toBeNull()
        expect(mounted.host.querySelector('.app-shell__live-status')?.textContent).toContain('文档已加载')
      })
      await flushSettledWork()

      expect(readerBody(mounted.host)).toBe('# Markdown refresh failure')
      expect(mounted.host.querySelector('[data-testid="floating-affordance-menu"]')).toBeNull()
      expect(mounted.host.textContent).not.toContain('无法加入文库。当前文档没有被替换')

      await showLibrary(mounted.host)
      await vi.waitFor(() => {
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
        expect(hasLibraryEntry(mounted.host, entry.title)).toBe(true)
        expect(libraryViewStatus(mounted.host)).toBeUndefined()
      })
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps an imported PDF active when the library refresh fails', async () => {
    const entry = createPdfEntry('pdf-refresh-failure', 'PDF refresh failure')

    libraryStoreMocks.addPdfDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries
      .mockRejectedValueOnce(new Error('library refresh failed'))
      .mockResolvedValue([entry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await dispatchFile(mounted.host, new File([Uint8Array.of(1)], 'PDF refresh failure.pdf', {
        type: 'application/pdf',
      }))
      await vi.waitFor(() => expect(libraryStoreMocks.addPdfDocument).toHaveBeenCalled())
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="pdf-viewer"]')).not.toBeNull()
        expect(mounted.host.querySelector('.app-shell__live-status')?.textContent).toContain('PDF 已加入文库')
      })
      await flushSettledWork()

      expect(mounted.host.querySelector('[data-testid="floating-affordance-menu"]')).toBeNull()
      expect(mounted.host.textContent).not.toContain('无法加入 PDF。当前文档没有被替换')

      await showLibrary(mounted.host)
      await vi.waitFor(() => {
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
        expect(hasLibraryEntry(mounted.host, entry.title)).toBe(true)
        expect(libraryViewStatus(mounted.host)).toBeUndefined()
      })
    }
    finally {
      mounted.unmount()
    }
  })

  test.each(['markdown', 'pdf'] as const)(
    'keeps the metadata warning after an imported %s document activates',
    async entryType => {
      const entry = entryType === 'markdown'
        ? createMarkdownEntry('markdown-metadata-failure', 'Markdown metadata failure')
        : createPdfEntry('pdf-metadata-failure', 'PDF metadata failure')

      if (entryType === 'markdown') {
        libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
      }
      else {
        libraryStoreMocks.addPdfDocument.mockResolvedValue(entry)
      }
      libraryStoreMocks.listEntries.mockResolvedValue([entry])
      libraryStoreMocks.markOpened.mockRejectedValueOnce(new Error(`${entryType} metadata update failed`))
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp()

      try {
        if (entryType === 'markdown') {
          dispatchPaste(mounted.host, '# Markdown metadata failure')
          await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(entry.title))
        }
        else {
          await dispatchFile(mounted.host, new File([Uint8Array.of(1)], 'PDF metadata failure.pdf', {
            type: 'application/pdf',
          }))
          await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="pdf-viewer"]')).not.toBeNull())
        }
        await vi.waitFor(() => expect(
          mounted.host.querySelector('.app-shell__live-status')?.textContent,
        ).toContain('最近打开时间暂时无法更新'))

        expect(mounted.host.textContent).toContain(entry.title)
        expect(mounted.host.querySelector('[data-testid="floating-affordance-menu"]')).toBeNull()
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test.each(['markdown', 'pdf'] as const)(
    'keeps the input surface recoverable when an imported %s entry is removed before activation',
    async entryType => {
      const entry = entryType === 'markdown'
        ? createMarkdownEntry('removed-imported-markdown', 'Removed imported Markdown')
        : createPdfEntry('removed-imported-pdf', 'Removed imported PDF')
      const appErrors: unknown[] = []

      if (entryType === 'markdown') {
        libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
      }
      else {
        libraryStoreMocks.addPdfDocument.mockResolvedValue(entry)
      }
      libraryStoreMocks.markOpened.mockResolvedValueOnce(null)
      libraryStoreMocks.listEntries.mockResolvedValue([])
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp(error => appErrors.push(error))

      try {
        if (entryType === 'markdown') {
          dispatchPaste(mounted.host, '# Removed imported Markdown')
        }
        else {
          await dispatchFile(mounted.host, new File([Uint8Array.of(1)], 'Removed imported PDF.pdf', {
            type: 'application/pdf',
          }))
        }

        await vi.waitFor(() => expect(libraryStoreMocks.markOpened).toHaveBeenCalledOnce())
        await vi.waitFor(() => expect(
          mounted.host.querySelector('[data-testid="floating-affordance-menu"] [role="status"]')?.textContent,
        ).toContain('已经不在文库中'))

        expect(readerTitle(mounted.host)).toBe('miru sample')
        expect(mounted.host.querySelector('[data-testid="url-import-conflict"]')).toBeNull()
        expect(appErrors).toEqual([])
      }
      finally {
        mounted.unmount()
      }
    },
  )

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

  test('recovers when pending import reconciliation cannot refresh the library', async () => {
    const pendingEntry = createMarkdownEntry('pending-library-import', 'Pending library import')
    const pendingAdd = createDeferred<LibraryEntry>()

    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('library refresh failed'))
      .mockResolvedValue([pendingEntry])
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(pendingAdd.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Pending library import')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

      await showLibrary(mounted.host)
      expect(mounted.host.querySelectorAll('[data-testid="library-entry"]')).toHaveLength(0)

      pendingAdd.resolve(pendingEntry)
      await vi.waitFor(() => {
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
        expect(libraryViewStatus(mounted.host)).toContain('文库暂时无法刷新')
      })

      expect(mounted.host.querySelectorAll('[data-testid="library-entry"]')).toHaveLength(0)

      changeLibrarySort(mounted.host, 'title')

      await vi.waitFor(() => {
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(3)
        expect(mounted.host.textContent).toContain(pendingEntry.title)
      })
      expect(mounted.host.querySelector('[data-testid="library-view"] [role="status"]')).toBeNull()
    }
    finally {
      mounted.unmount()
    }
  })

  test('reconciles a pending durable PDF import after entering the library', async () => {
    const pendingEntry = createPdfEntry('pending-library-pdf', 'Pending library PDF')
    const pendingAdd = createDeferred<LibraryEntry>()
    let visibleEntries: LibraryEntry[] = []

    libraryStoreMocks.listEntries.mockImplementation(async () => visibleEntries)
    libraryStoreMocks.addPdfDocument.mockReturnValue(pendingAdd.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await dispatchFile(mounted.host, new File([Uint8Array.of(1)], 'Pending library PDF.pdf', {
        type: 'application/pdf',
      }))
      await vi.waitFor(() => expect(libraryStoreMocks.addPdfDocument).toHaveBeenCalled())

      await showLibrary(mounted.host)
      expect(mounted.host.querySelectorAll('[data-testid="library-entry"]')).toHaveLength(0)

      visibleEntries = [pendingEntry]
      pendingAdd.resolve(pendingEntry)
      await vi.waitFor(() => {
        expect(mounted.host.textContent).toContain(pendingEntry.title)
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
      })
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

  test('returns to the sample when preserving the active Markdown position fails', async () => {
    const currentEntry = createMarkdownEntry('sample-save-failure', 'Sample save failure')

    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(currentEntry)
    libraryStoreMocks.listEntries.mockResolvedValue([currentEntry])
    libraryStoreMocks.saveReadingPosition.mockRejectedValue(new Error('position save failed'))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Sample save failure')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(currentEntry.title))

      click(mounted.host, '[data-testid="floating-affordance-button"]')
      await clickButtonWithText(mounted.host, '清空当前')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))

      expect(readerBody(mounted.host)).toBe(sampleMarkdown)
    }
    finally {
      mounted.unmount()
    }
  })

  test('enters the library when preserving the active Markdown position fails', async () => {
    const currentEntry = createMarkdownEntry('library-save-failure', 'Library save failure')

    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(currentEntry)
    libraryStoreMocks.listEntries.mockResolvedValue([currentEntry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Library save failure')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(currentEntry.title))
      await flushSettledWork()
      libraryStoreMocks.saveReadingPosition.mockRejectedValueOnce(new Error('position save failed'))

      await showLibrary(mounted.host)

      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(expect.objectContaining({
        documentId: currentEntry.id,
        type: 'markdown',
      }))
      expect(hasLibraryEntry(mounted.host, currentEntry.title)).toBe(true)
    }
    finally {
      mounted.unmount()
    }
  })

  test('activates the next Markdown document when preserving the current position fails', async () => {
    const currentEntry = createMarkdownEntry('import-save-failure-current', 'Import save failure current')
    const nextEntry = createMarkdownEntry('import-save-failure-next', 'Import save failure next')

    libraryStoreMocks.addMarkdownDocument
      .mockResolvedValueOnce(currentEntry)
      .mockResolvedValueOnce(nextEntry)
    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([currentEntry])
      .mockResolvedValue([currentEntry, nextEntry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Import save failure current')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(currentEntry.title))
      await flushSettledWork()
      libraryStoreMocks.saveReadingPosition.mockRejectedValueOnce(new Error('position save failed'))

      dispatchPaste(mounted.host, '# Import save failure next')

      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(nextEntry.title))
      expect(readerBody(mounted.host)).toBe('# Import save failure next')
      expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalledTimes(2)
      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(expect.objectContaining({
        documentId: currentEntry.id,
        type: 'markdown',
      }))
      expect(mounted.host.querySelector('[data-testid="floating-affordance-menu"]')).toBeNull()
    }
    finally {
      mounted.unmount()
    }
  })

  test('preserves a Markdown scroll made while the library is still refreshing', async () => {
    const entry = createMarkdownEntry('library-refresh-scroll', 'Library refresh scroll')
    const pendingRefresh = createDeferred<LibraryEntry[]>()

    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([entry])
      .mockReturnValueOnce(pendingRefresh.promise)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Library refresh scroll')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(entry.title))

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2))
      libraryStoreMocks.saveReadingPosition.mockClear()

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubGlobal('scrollY', 510)
      window.dispatchEvent(new Event('scroll'))
      pendingRefresh.resolve([entry])

      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: entry.id,
          scrollY: 510,
          type: 'markdown',
        }),
      ))
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="library-view"]'),
      ).not.toBeNull())

      vi.stubGlobal('scrollY', 0)
      vi.mocked(window.scrollTo).mockClear()
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="library-view"]'),
      ).toBeNull())
      await vi.waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({
        behavior: 'auto',
        top: 510,
      }))
    }
    finally {
      if (vi.isFakeTimers()) {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      pendingRefresh.resolve([entry])
      await flushSettledWork()
      mounted.unmount()
    }
  })

  test('does not save a delayed Markdown scroll under the next document', async () => {
    const earlierEntry = createMarkdownEntry('markdown-position-a', 'Markdown position A')
    const latestEntry = createMarkdownEntry('markdown-position-b', 'Markdown position B')
    const latestRefreshStarted = createDeferred<void>()
    const latestRefresh = createDeferred<LibraryEntry[]>()

    libraryStoreMocks.addMarkdownDocument
      .mockResolvedValueOnce(earlierEntry)
      .mockResolvedValueOnce(latestEntry)
    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([earlierEntry])
      .mockImplementationOnce(() => {
        latestRefreshStarted.resolve(undefined)
        return latestRefresh.promise
      })
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Markdown position A')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(earlierEntry.title))
      await flushSettledWork()

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubGlobal('scrollY', 240)
      window.dispatchEvent(new Event('scroll'))

      vi.stubGlobal('scrollY', 8)
      dispatchPaste(mounted.host, '# Markdown position B')
      await latestRefreshStarted.promise
      await nextTick()
      expect(readerTitle(mounted.host)).toBe(latestEntry.title)

      libraryStoreMocks.saveReadingPosition.mockClear()
      await vi.advanceTimersByTimeAsync(450)

      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: latestEntry.id,
          type: 'markdown',
        }),
      )
    }
    finally {
      if (vi.isFakeTimers()) {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      latestRefresh.resolve([earlierEntry, latestEntry])
      await flushSettledWork()
      mounted.unmount()
    }
  })

  test('preserves a Markdown scroll made while the next import is still pending', async () => {
    const earlierEntry = createMarkdownEntry('pending-scroll-a', 'Pending scroll A')
    const latestEntry = createMarkdownEntry('pending-scroll-b', 'Pending scroll B')
    const latestAdd = createDeferred<LibraryEntry>()
    const latestRefreshStarted = createDeferred<void>()
    const latestRefresh = createDeferred<LibraryEntry[]>()
    const pendingPositionSave = createDeferred<MarkdownReadingPosition>()
    const pendingPositionSaveStarted = createDeferred<void>()

    libraryStoreMocks.addMarkdownDocument
      .mockResolvedValueOnce(earlierEntry)
      .mockReturnValueOnce(latestAdd.promise)
    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([earlierEntry])
      .mockImplementationOnce(() => {
        latestRefreshStarted.resolve(undefined)
        return latestRefresh.promise
      })
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Pending scroll A')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(earlierEntry.title))

      dispatchPaste(mounted.host, '# Pending scroll B')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalledTimes(2))
      libraryStoreMocks.saveReadingPosition.mockClear()
      libraryStoreMocks.saveReadingPosition.mockImplementation(async position => {
        const saved = {
          ...position,
          updatedAt: '2026-08-09T00:00:01.000Z',
        } as MarkdownReadingPosition
        if (position.documentId === earlierEntry.id && position.scrollY === 420) {
          pendingPositionSaveStarted.resolve(undefined)
          return await pendingPositionSave.promise
        }

        return saved
      })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubGlobal('scrollY', 420)
      window.dispatchEvent(new Event('scroll'))
      latestAdd.resolve(latestEntry)
      await pendingPositionSaveStarted.promise

      vi.stubGlobal('scrollY', 510)
      window.dispatchEvent(new Event('scroll'))
      pendingPositionSave.resolve({
        activeHeadingId: null,
        documentId: earlierEntry.id,
        scrollY: 420,
        type: 'markdown',
        updatedAt: '2026-08-09T00:00:01.000Z',
      })

      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: earlierEntry.id,
          scrollY: 510,
          type: 'markdown',
        }),
      ))
      await latestRefreshStarted.promise
      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalledWith(
        expect.objectContaining({ documentId: latestEntry.id }),
      )
    }
    finally {
      if (vi.isFakeTimers()) {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      latestAdd.resolve(latestEntry)
      pendingPositionSave.resolve({
        activeHeadingId: null,
        documentId: earlierEntry.id,
        scrollY: 420,
        type: 'markdown',
        updatedAt: '2026-08-09T00:00:01.000Z',
      })
      latestRefresh.resolve([earlierEntry, latestEntry])
      await flushSettledWork()
      mounted.unmount()
    }
  })

  test('invalidates a Markdown scroll created while replacing the active URL document', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/position.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/position.md',
    }
    const entry = createMarkdownEntry('url-position-owner', 'URL position owner')
    const updateWrite = createDeferred<LibraryEntry>()
    entry.source = source

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument
      .mockResolvedValueOnce(createOpenMarkdownDocument(entry, '# URL position owner\n\nOriginal.'))
      .mockResolvedValue(createOpenMarkdownDocument(entry, '# URL position owner\n\nUpdated.'))
    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(true)
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(updateWrite.promise)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# URL position owner\n\nUpdated.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp()
    const delayedSaves = new Map<number, () => void>()
    const nativeSetTimeout = window.setTimeout.bind(window)
    const nativeClearTimeout = window.clearTimeout.bind(window)
    let nextTimerId = 10_000

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original.'))

      vi.spyOn(window, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
        if (timeout === 450 && typeof handler === 'function') {
          const id = ++nextTimerId
          delayedSaves.set(id, () => handler(...args))
          return id
        }

        return nativeSetTimeout(handler, timeout, ...args)
      })
      vi.spyOn(window, 'clearTimeout').mockImplementation((id) => {
        if (!delayedSaves.delete(Number(id))) {
          nativeClearTimeout(id)
        }
      })

      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())
      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

      libraryStoreMocks.saveReadingPosition.mockClear()
      vi.stubGlobal('scrollY', 240)
      window.dispatchEvent(new Event('scroll'))
      expect(delayedSaves.size).toBe(0)

      updateWrite.resolve(entry)
      await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Updated.'))

      const staleCallbacks = [...delayedSaves.values()]
      delayedSaves.clear()
      for (const callback of staleCallbacks) {
        callback()
      }
      await flushSettledWork()

      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalled()
    }
    finally {
      updateWrite.resolve(entry)
      mounted.unmount()
    }
  })

  test.each(['settles', 'is superseded'] as const)(
    'waits for an active position save before a same-URL replacement %s',
    async settlement => {
      const source = {
        domain: 'example.com',
        inputUrl: 'https://example.com/settled-position.md',
        kind: 'url' as const,
        requestUrl: 'https://example.com/settled-position.md',
      }
      const entry = createMarkdownEntry('settled-url-position-owner', 'Settled URL position owner')
      const contentChanged = createDeferred<boolean>()
      const positionSave = createDeferred<MarkdownReadingPosition>()
      const positionSaveStarted = createDeferred<void>()
      const resumedPositionSave = createDeferred<MarkdownReadingPosition>()
      const nextRequest = createDeferred<Response>()
      const updateWrite = createDeferred<LibraryEntry>()
      entry.source = source

      libraryStoreMocks.listEntries.mockResolvedValue([entry])
      libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
        createOpenMarkdownDocument(entry, '# Settled URL position owner\n\nOriginal.'),
      )
      libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
      libraryStoreMocks.isMarkdownContentChanged.mockReturnValue(contentChanged.promise)
      libraryStoreMocks.addMarkdownDocument.mockReturnValue(updateWrite.promise)
      libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
        ...position,
        updatedAt: '2026-08-09T00:00:01.000Z',
      }))
      libraryStoreMocks.close.mockResolvedValue(undefined)
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('next-position.md')) {
          return await nextRequest.promise
        }

        return new Response('# Settled URL position owner\n\nUpdated.', {
          headers: { 'Content-Type': 'text/markdown' },
          status: 200,
        })
      }))

      const mounted = mountApp()

      try {
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, entry.title, '打开')
        await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original.'))

        dispatchPaste(mounted.host, source.inputUrl)
        await vi.waitFor(() => expect(
          mounted.host.querySelector('[data-testid="url-import-conflict"]'),
        ).not.toBeNull())
        await clickButtonWithText(mounted.host, '更新到最新')
        await vi.waitFor(() => expect(libraryStoreMocks.isMarkdownContentChanged).toHaveBeenCalled())

        let saveCallCount = 0
        libraryStoreMocks.saveReadingPosition.mockImplementation(async position => {
          saveCallCount += 1
          if (saveCallCount === 1) {
            positionSaveStarted.resolve(undefined)
            return await positionSave.promise
          }

          const saved = {
            ...position,
            updatedAt: '2026-08-09T00:00:02.000Z',
          } as MarkdownReadingPosition
          resumedPositionSave.resolve(saved)
          return saved
        })
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        vi.stubGlobal('scrollY', 240)
        window.dispatchEvent(new Event('scroll'))
        await vi.advanceTimersByTimeAsync(450)
        await positionSaveStarted.promise

        contentChanged.resolve(true)
        await nextTick()
        await Promise.resolve()
        expect(libraryStoreMocks.addMarkdownDocument).not.toHaveBeenCalled()

        if (settlement === 'settles') {
          positionSave.resolve({
            activeHeadingId: null,
            documentId: entry.id,
            scrollY: 240,
            type: 'markdown',
            updatedAt: '2026-08-09T00:00:01.000Z',
          })
          await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())
        }
        else {
          dispatchPaste(mounted.host, 'https://example.com/next-position.md')
          await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
          await nextTick()

          vi.stubGlobal('scrollY', 510)
          window.dispatchEvent(new Event('scroll'))
          await vi.advanceTimersByTimeAsync(450)
          await expect(resumedPositionSave.promise).resolves.toMatchObject({
            documentId: entry.id,
            scrollY: 510,
            type: 'markdown',
          })
          expect(libraryStoreMocks.addMarkdownDocument).not.toHaveBeenCalled()
        }
      }
      finally {
        if (vi.isFakeTimers()) {
          vi.clearAllTimers()
          vi.useRealTimers()
        }
        contentChanged.resolve(true)
        positionSave.resolve({
          activeHeadingId: null,
          documentId: entry.id,
          scrollY: 240,
          type: 'markdown',
          updatedAt: '2026-08-09T00:00:01.000Z',
        })
        updateWrite.resolve(entry)
        if (settlement === 'is superseded') {
          nextRequest.reject(new TypeError('next URL request canceled'))
        }
        await flushSettledWork()
        mounted.unmount()
      }
    },
  )

  test('preserves the latest Markdown scroll when an active URL replacement fails', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/failed-position.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/failed-position.md',
    }
    const entry = createMarkdownEntry('failed-url-position-owner', 'Failed URL position owner')
    const updateWrite = createDeferred<LibraryEntry>()
    entry.source = source

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
      createOpenMarkdownDocument(entry, '# Failed URL position owner\n\nOriginal.'),
    )
    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(true)
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(updateWrite.promise)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Failed URL position owner\n\nUpdated.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original.'))

      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())
      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

      libraryStoreMocks.saveReadingPosition.mockClear()
      vi.stubGlobal('scrollY', 310)
      window.dispatchEvent(new Event('scroll'))
      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalled()

      updateWrite.reject(new Error('URL update failed'))
      await vi.waitFor(() => expect(mounted.host.textContent).toContain('无法更新文库'))
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: entry.id,
          scrollY: 310,
          type: 'markdown',
        }),
      ))
    }
    finally {
      mounted.unmount()
    }
  })

  test('preserves a suspended URL position after opening another library document', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/superseded-position.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/superseded-position.md',
    }
    const entry = createMarkdownEntry('superseded-url-position-owner', 'Superseded URL position owner')
    const nextEntry = createMarkdownEntry('superseded-url-position-next', 'Superseded URL position next')
    const updateWrite = createDeferred<LibraryEntry>()
    entry.source = source

    libraryStoreMocks.listEntries.mockResolvedValue([entry, nextEntry])
    libraryStoreMocks.openMarkdownDocument.mockImplementation(async id => id === entry.id
      ? createOpenMarkdownDocument(entry, '# Superseded URL position owner\n\nOriginal.')
      : createOpenMarkdownDocument(nextEntry, '# Superseded URL position next'))
    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(true)
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(updateWrite.promise)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Superseded URL position owner\n\nUpdated.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original.'))

      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())
      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

      libraryStoreMocks.saveReadingPosition.mockClear()
      vi.stubGlobal('scrollY', 310)
      window.dispatchEvent(new Event('scroll'))

      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, nextEntry.title, '打开')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(nextEntry.title))

      updateWrite.reject(new Error('superseded URL update'))
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: entry.id,
          scrollY: 310,
          type: 'markdown',
        }),
      ))
    }
    finally {
      updateWrite.reject(new Error('superseded URL update'))
      await flushSettledWork()
      mounted.unmount()
    }
  })

  test('does not save a suspended URL position after the app unmounts', async () => {
    const source = {
      domain: 'example.com',
      inputUrl: 'https://example.com/unmounted-position.md',
      kind: 'url' as const,
      requestUrl: 'https://example.com/unmounted-position.md',
    }
    const entry = createMarkdownEntry('unmounted-url-position-owner', 'Unmounted URL position owner')
    const updateWrite = createDeferred<LibraryEntry>()
    entry.source = source

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
      createOpenMarkdownDocument(entry, '# Unmounted URL position owner\n\nOriginal.'),
    )
    libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
    libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(true)
    libraryStoreMocks.addMarkdownDocument.mockReturnValue(updateWrite.promise)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-09T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Unmounted URL position owner\n\nUpdated.', {
      headers: { 'Content-Type': 'text/markdown' },
      status: 200,
    })))

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original.'))

      dispatchPaste(mounted.host, source.inputUrl)
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="url-import-conflict"]'),
      ).not.toBeNull())
      await clickButtonWithText(mounted.host, '更新到最新')
      await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

      libraryStoreMocks.saveReadingPosition.mockClear()
      vi.stubGlobal('scrollY', 310)
      window.dispatchEvent(new Event('scroll'))

      click(mounted.host, '[data-testid="floating-affordance-button"]')
      await clickButtonWithText(mounted.host, '清空当前')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))
      mounted.unmount()
      updateWrite.reject(new Error('unmounted URL update'))
      await flushSettledWork()

      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalled()
    }
    finally {
      updateWrite.reject(new Error('unmounted URL update'))
      await flushSettledWork()
      mounted.unmount()
    }
  })

  test.each(['fails', 'commits'] as const)(
    'keeps a newer same-document owner when an older URL replacement %s',
    async settlement => {
      const source = {
        domain: 'example.com',
        inputUrl: 'https://example.com/reactivated-position.md',
        kind: 'url' as const,
        requestUrl: 'https://example.com/reactivated-position.md',
      }
      const entry = createMarkdownEntry('reactivated-url-position-owner', 'Reactivated URL position owner')
      const updateWrite = createDeferred<LibraryEntry>()
      entry.source = source

      libraryStoreMocks.listEntries.mockResolvedValue([entry])
      libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
        createOpenMarkdownDocument(entry, '# Reactivated URL position owner\n\nOriginal.'),
      )
      libraryStoreMocks.findMarkdownEntryByUrl.mockResolvedValue(entry)
      libraryStoreMocks.isMarkdownContentChanged.mockResolvedValue(true)
      libraryStoreMocks.addMarkdownDocument.mockReturnValue(updateWrite.promise)
      libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
        ...position,
        updatedAt: '2026-08-09T00:00:01.000Z',
      }))
      libraryStoreMocks.close.mockResolvedValue(undefined)
      vi.stubGlobal('fetch', vi.fn(async () => new Response('# Reactivated URL position owner\n\nUpdated.', {
        headers: { 'Content-Type': 'text/markdown' },
        status: 200,
      })))

      const mounted = mountApp()

      try {
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, entry.title, '打开')
        await vi.waitFor(() => expect(readerBody(mounted.host)).toContain('Original.'))

        dispatchPaste(mounted.host, source.inputUrl)
        await vi.waitFor(() => expect(
          mounted.host.querySelector('[data-testid="url-import-conflict"]'),
        ).not.toBeNull())
        await clickButtonWithText(mounted.host, '更新到最新')
        await vi.waitFor(() => expect(libraryStoreMocks.addMarkdownDocument).toHaveBeenCalled())

        vi.stubGlobal('scrollY', 310)
        window.dispatchEvent(new Event('scroll'))
        await showLibrary(mounted.host)
        await openLibraryEntry(mounted.host, entry.title, '打开')
        await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(entry.title))

        if (settlement === 'commits') {
          updateWrite.resolve(entry)
          await flushSettledWork()
        }

        libraryStoreMocks.saveReadingPosition.mockClear()
        vi.stubGlobal('scrollY', 500)
        await showLibrary(mounted.host)
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
          expect.objectContaining({
            documentId: entry.id,
            scrollY: 500,
            type: 'markdown',
          }),
        )

        if (settlement === 'fails') {
          updateWrite.reject(new Error('reactivated URL update failed'))
          await flushSettledWork()
          expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalledWith(
            expect.objectContaining({
              documentId: entry.id,
              scrollY: 310,
              type: 'markdown',
            }),
          )
        }
      }
      finally {
        if (settlement === 'commits') {
          updateWrite.resolve(entry)
        }
        else {
          updateWrite.reject(new Error('reactivated URL update failed'))
        }
        await flushSettledWork()
        mounted.unmount()
      }
    },
  )

  test.each(['sample', 'new-document', 'pdf'] as const)(
    'does not restore a stale Markdown position after switching to %s',
    async target => {
      const earlierEntry = createMarkdownEntry('markdown-restore-a', 'Markdown restore A')
      const latestEntry = createMarkdownEntry('markdown-restore-b', 'Markdown restore B')
      const pdfEntry = createPdfEntry('markdown-restore-pdf', 'Markdown restore PDF')
      const earlierPosition: MarkdownReadingPosition = {
        activeHeadingId: null,
        documentId: earlierEntry.id,
        scrollY: 360,
        type: 'markdown',
        updatedAt: '2026-08-09T00:00:00.000Z',
      }
      let visibleEntries: LibraryEntry[] = [earlierEntry]

      libraryStoreMocks.listEntries.mockImplementation(async () => visibleEntries)
      libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
        createOpenMarkdownDocument(earlierEntry, '# Markdown restore A', earlierPosition),
      )
      libraryStoreMocks.addMarkdownDocument.mockImplementation(async () => {
        visibleEntries = [earlierEntry, latestEntry]
        return latestEntry
      })
      libraryStoreMocks.addPdfDocument.mockImplementation(async () => {
        visibleEntries = [earlierEntry, pdfEntry]
        return pdfEntry
      })
      libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
        ...position,
        updatedAt: '2026-08-09T00:00:01.000Z',
      }))
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp()
      const frames = new Map<number, FrameRequestCallback>()
      let nextFrameId = 100

      try {
        await showLibrary(mounted.host)
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
          const id = ++nextFrameId
          frames.set(id, callback)
          return id
        }))
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
          frames.delete(id)
        }))

        await openLibraryEntry(mounted.host, earlierEntry.title, '打开')
        await vi.waitFor(() => {
          expect(readerTitle(mounted.host)).toBe(earlierEntry.title)
          expect(frames.size).toBeGreaterThanOrEqual(1)
        })

        if (target === 'sample') {
          click(mounted.host, '[data-testid="floating-affordance-button"]')
          await clickButtonWithText(mounted.host, '清空当前')
          await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe('miru sample'))
        }
        else if (target === 'new-document') {
          dispatchPaste(mounted.host, '# Markdown restore B')
          await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(latestEntry.title))
        }
        else if (target === 'pdf') {
          await dispatchFile(mounted.host, new File([Uint8Array.of(1)], 'Markdown restore PDF.pdf', {
            type: 'application/pdf',
          }))
          await vi.waitFor(() => expect(
            mounted.host.querySelector('[data-testid="pdf-viewer"]'),
          ).not.toBeNull())
        }
        expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalledWith(
          expect.objectContaining({
            documentId: earlierEntry.id,
            scrollY: 0,
            type: 'markdown',
          }),
        )

        vi.mocked(window.scrollTo).mockClear()
        for (const [id, callback] of [...frames]) {
          frames.delete(id)
          callback(0)
        }
        await nextTick()

        expect(window.scrollTo).not.toHaveBeenCalled()
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test('restores the active library Markdown position when returning from the library', async () => {
    const entry = createMarkdownEntry('library-return-position', 'Library return position')

    libraryStoreMocks.addMarkdownDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-10T00:00:00.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      dispatchPaste(mounted.host, '# Library return position')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(entry.title))
      await flushSettledWork()

      vi.stubGlobal('scrollY', 640)
      await showLibrary(mounted.host)
      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(expect.objectContaining({
        documentId: entry.id,
        scrollY: 640,
        type: 'markdown',
      }))

      vi.stubGlobal('scrollY', 0)
      vi.mocked(window.scrollTo).mockClear()
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="library-view"]')).toBeNull()
        expect(readerTitle(mounted.host)).toBe(entry.title)
      })

      await vi.waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({
        behavior: 'auto',
        top: 640,
      }))
    }
    finally {
      mounted.unmount()
    }
  })

  test('retains a pending Markdown restore while visiting the library', async () => {
    const entry = createMarkdownEntry('library-paused-restore', 'Library paused restore')
    const pendingLibraryRefresh = createDeferred<LibraryEntry[]>()
    const position: MarkdownReadingPosition = {
      activeHeadingId: null,
      documentId: entry.id,
      scrollY: 360,
      type: 'markdown',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }

    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([entry])
      .mockReturnValueOnce(pendingLibraryRefresh.promise)
      .mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
      createOpenMarkdownDocument(entry, '# Library paused restore', position),
    )
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 150

    try {
      await showLibrary(mounted.host)
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      }))
      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
        frames.delete(id)
      }))

      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => {
        expect(frames.size).toBeGreaterThanOrEqual(1)
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
      })

      libraryStoreMocks.saveReadingPosition.mockClear()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      window.dispatchEvent(new Event('scroll'))
      await vi.advanceTimersByTimeAsync(450)
      expect(libraryStoreMocks.saveReadingPosition).not.toHaveBeenCalled()
      vi.useRealTimers()

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(3))

      vi.mocked(window.scrollTo).mockClear()
      for (const [id, callback] of [...frames]) {
        frames.delete(id)
        callback(0)
      }
      await nextTick()
      expect(window.scrollTo).not.toHaveBeenCalled()

      pendingLibraryRefresh.resolve([entry])
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="library-view"]'),
      ).not.toBeNull())

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="library-view"]')).toBeNull()
        expect(frames.size).toBeGreaterThanOrEqual(1)
      })
      for (const [id, callback] of [...frames]) {
        frames.delete(id)
        callback(0)
      }
      await nextTick()

      expect(window.scrollTo).toHaveBeenCalledWith({
        behavior: 'auto',
        top: position.scrollY,
      })
    }
    finally {
      if (vi.isFakeTimers()) {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      pendingLibraryRefresh.resolve([entry])
      mounted.unmount()
    }
  })

  test.each([
    ['an unlocked surface', false],
    ['a locked mobile surface', true],
  ] as const)('keeps a pending Markdown restore valid during unresolved URL input on %s', async (
    _surface,
    locksPage,
  ) => {
    const entry = createMarkdownEntry('pending-restore-input', 'Pending restore input')
    const position: MarkdownReadingPosition = {
      activeHeadingId: null,
      documentId: entry.id,
      scrollY: 360,
      type: 'markdown',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }
    const request = createDeferred<Response>()

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
      createOpenMarkdownDocument(entry, '# Pending restore input', position),
    )
    libraryStoreMocks.close.mockResolvedValue(undefined)
    const fetchMock = vi.fn(() => request.promise)
    vi.stubGlobal('fetch', fetchMock)

    const mounted = mountApp()
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 200

    try {
      await showLibrary(mounted.host)
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      }))
      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
        frames.delete(id)
      }))

      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(frames.size).toBeGreaterThanOrEqual(1))

      if (locksPage) {
        vi.stubGlobal('matchMedia', (media: string): MediaQueryList => ({
          addEventListener: vi.fn(),
          addListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
          matches: media === '(max-width: 640px)',
          media,
          onchange: null,
          removeEventListener: vi.fn(),
          removeListener: vi.fn(),
        }))
      }

      dispatchPaste(mounted.host, 'https://example.com/pending-restore.md')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
      if (locksPage) {
        await vi.waitFor(() => expect(document.body.style.position).toBe('fixed'))
      }

      vi.mocked(window.scrollTo).mockClear()
      for (const [id, callback] of [...frames]) {
        frames.delete(id)
        callback(0)
      }
      await nextTick()

      if (locksPage) {
        expect(document.body.style.top).toBe(`-${position.scrollY}px`)
        expect(window.scrollTo).not.toHaveBeenCalled()
        click(mounted.host, '[data-testid="command-scrim"]')
        await vi.waitFor(() => expect(document.body.style.position).not.toBe('fixed'))
        expect(window.scrollTo).toHaveBeenLastCalledWith({
          behavior: 'auto',
          top: position.scrollY,
        })
      }
      else {
        expect(window.scrollTo).toHaveBeenCalledWith({
          behavior: 'auto',
          top: position.scrollY,
        })
      }
    }
    finally {
      request.reject(new TypeError('URL request failed'))
      await flushSettledWork()
      mounted.unmount()
    }
  })

  test('does not restore a Markdown position after the app unmounts', async () => {
    const entry = createMarkdownEntry('unmounted-restore', 'Unmounted restore')
    const position: MarkdownReadingPosition = {
      activeHeadingId: null,
      documentId: entry.id,
      scrollY: 360,
      type: 'markdown',
      updatedAt: '2026-08-09T00:00:00.000Z',
    }

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(
      createOpenMarkdownDocument(entry, '# Unmounted restore', position),
    )
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 300

    try {
      await showLibrary(mounted.host)
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      }))
      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
        frames.delete(id)
      }))

      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(frames.size).toBeGreaterThanOrEqual(1))

      vi.mocked(window.scrollTo).mockClear()
      mounted.unmount()
      for (const [id, callback] of [...frames]) {
        frames.delete(id)
        callback(0)
      }
      await nextTick()

      expect(window.scrollTo).not.toHaveBeenCalled()
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps the last library snapshot when refresh fails and recovers on retry', async () => {
    const snapshotEntry = createMarkdownEntry('snapshot-entry', 'Snapshot entry')
    const recoveredEntry = createMarkdownEntry('recovered-entry', 'Recovered entry')

    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([snapshotEntry])
      .mockRejectedValueOnce(new Error('library refresh failed'))
      .mockResolvedValue([snapshotEntry, recoveredEntry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)
      expect(mounted.host.textContent).toContain(snapshotEntry.title)

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="library-view"]'),
      ).toBeNull())

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(
        mounted.host.querySelector('[data-testid="library-view"]'),
      ).not.toBeNull())

      expect(mounted.host.textContent).toContain(snapshotEntry.title)
      expect(mounted.host.textContent).not.toContain(recoveredEntry.title)
      expect(libraryViewStatus(mounted.host)).toContain('文库暂时无法刷新')

      changeLibrarySort(mounted.host, 'title')

      await vi.waitFor(() => expect(mounted.host.textContent).toContain(recoveredEntry.title))
      expect(mounted.host.querySelector('[data-testid="library-view"] [role="status"]')).toBeNull()
    }
    finally {
      mounted.unmount()
    }
  })

  test('does not apply an older library snapshot after a newer refresh fails', async () => {
    const initialEntry = createMarkdownEntry('initial-refresh-entry', 'Initial refresh entry')
    const staleEntry = createMarkdownEntry('stale-refresh-entry', 'Stale refresh entry')
    const recoveredEntry = createMarkdownEntry('latest-refresh-entry', 'Latest refresh entry')
    const olderRefresh = createDeferred<LibraryEntry[]>()

    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([initialEntry])
      .mockReturnValueOnce(olderRefresh.promise)
      .mockRejectedValueOnce(new Error('newer library refresh failed'))
      .mockResolvedValue([recoveredEntry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)

      changeLibrarySort(mounted.host, 'title')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2))

      changeLibrarySort(mounted.host, 'last-opened')
      await vi.waitFor(() => expect(libraryViewStatus(mounted.host)).toContain('文库暂时无法刷新'))

      olderRefresh.resolve([staleEntry])
      await flushSettledWork()

      expect(mounted.host.textContent).toContain(initialEntry.title)
      expect(mounted.host.textContent).not.toContain(staleEntry.title)
      expect(libraryViewStatus(mounted.host)).toContain('文库暂时无法刷新')

      changeLibrarySort(mounted.host, 'title')
      await vi.waitFor(() => expect(mounted.host.textContent).toContain(recoveredEntry.title))
      expect(mounted.host.querySelector('[data-testid="library-view"] [role="status"]')).toBeNull()
    }
    finally {
      mounted.unmount()
    }
  })

  test('does not restore an older refresh error after a newer snapshot is applied', async () => {
    const initialEntry = createMarkdownEntry('initial-before-success', 'Initial before success')
    const latestEntry = createMarkdownEntry('latest-success-entry', 'Latest success entry')
    const olderRefresh = createDeferred<LibraryEntry[]>()

    libraryStoreMocks.listEntries
      .mockResolvedValueOnce([initialEntry])
      .mockReturnValueOnce(olderRefresh.promise)
      .mockResolvedValue([latestEntry])
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp()

    try {
      await showLibrary(mounted.host)

      changeLibrarySort(mounted.host, 'title')
      await vi.waitFor(() => expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2))

      changeLibrarySort(mounted.host, 'last-opened')
      await vi.waitFor(() => {
        expect(hasLibraryEntry(mounted.host, latestEntry.title)).toBe(true)
        expect(libraryViewStatus(mounted.host)).toBeUndefined()
      })

      olderRefresh.reject(new Error('older library refresh failed'))
      await flushSettledWork()

      expect(hasLibraryEntry(mounted.host, latestEntry.title)).toBe(true)
      expect(hasLibraryEntry(mounted.host, initialEntry.title)).toBe(false)
      expect(libraryViewStatus(mounted.host)).toBeUndefined()
    }
    finally {
      mounted.unmount()
    }
  })

  test.each([
    {
      action: 'rename',
      errorStatus: '重命名暂时无法保存。当前标题已保留，请稍后重试。',
    },
    {
      action: 'pin',
      errorStatus: '置顶状态暂时无法更新。当前列表已保留，请稍后重试。',
    },
    {
      action: 'delete',
      errorStatus: '暂时无法删除这篇文档。当前内容已保留，请稍后重试。',
    },
    {
      action: 'clear',
      errorStatus: '暂时无法清空文库。当前内容已保留，请稍后重试。',
    },
  ] as const)(
    'keeps a library entry retryable when the $action mutation fails',
    async ({ action, errorStatus }) => {
      const entry = createMarkdownEntry(`mutation-${action}`, `Mutation ${action}`)
      const recoveredTitle = 'Recovered mutation title'
      const recoveredEntry: LibraryEntry = action === 'rename'
        ? {
            ...entry,
            sortTitle: recoveredTitle.toLocaleLowerCase(),
            title: recoveredTitle,
          }
        : {
            ...entry,
            pinned: action === 'pin',
          }
      const appErrors: unknown[] = []
      let visibleEntries = [entry]

      libraryStoreMocks.listEntries.mockImplementation(async () => visibleEntries)
      if (action === 'rename' || action === 'pin') {
        libraryStoreMocks.updateEntry
          .mockRejectedValueOnce(new Error(`${action} failed`))
          .mockImplementationOnce(async () => {
            visibleEntries = [recoveredEntry]
            return recoveredEntry
          })
      }
      else if (action === 'delete') {
        libraryStoreMocks.deleteEntry
          .mockRejectedValueOnce(new Error('delete failed'))
          .mockImplementationOnce(async () => {
            visibleEntries = []
          })
      }
      else {
        libraryStoreMocks.clearLibrary
          .mockRejectedValueOnce(new Error('clear failed'))
          .mockImplementationOnce(async () => {
            visibleEntries = []
          })
      }
      libraryStoreMocks.close.mockResolvedValue(undefined)

      const mounted = mountApp(error => appErrors.push(error))

      try {
        await showLibrary(mounted.host)
        await performLibraryMutation(mounted.host, action, entry.title, recoveredTitle)
        const mutationMock = libraryMutationMock(action)
        await vi.waitFor(() => expect(mutationMock).toHaveBeenCalledOnce())
        await flushSettledWork()

        if (action === 'rename') {
          expect(libraryStoreMocks.updateEntry).toHaveBeenCalledWith(entry.id, { title: recoveredTitle })
        }
        else if (action === 'pin') {
          expect(libraryStoreMocks.updateEntry).toHaveBeenCalledWith(entry.id, { pinned: true })
        }
        else if (action === 'delete') {
          expect(libraryStoreMocks.deleteEntry).toHaveBeenCalledWith(entry.id)
        }
        else {
          expect(libraryStoreMocks.clearLibrary).toHaveBeenCalledWith()
        }
        expect(hasLibraryEntry(mounted.host, entry.title)).toBe(true)
        if (action === 'pin') {
          expect(hasLibraryEntryAction(mounted.host, entry.title, '置顶')).toBe(true)
        }
        expect(libraryViewStatus(mounted.host)).toBe(errorStatus)
        expect(libraryStoreMocks.listEntries).toHaveBeenCalledOnce()
        expect(appErrors).toEqual([])

        await performLibraryMutation(mounted.host, action, entry.title, recoveredTitle)
        await vi.waitFor(() => expect(mutationMock).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => {
          if (action === 'rename') {
            expect(hasLibraryEntry(mounted.host, recoveredTitle)).toBe(true)
            expect(hasLibraryEntry(mounted.host, entry.title)).toBe(false)
          }
          else if (action === 'pin') {
            expect(hasLibraryEntryAction(mounted.host, entry.title, '取消置顶')).toBe(true)
          }
          else {
            expect(mounted.host.querySelector('[data-testid="library-empty"]')).not.toBeNull()
          }
          expect(libraryViewStatus(mounted.host)).toBeUndefined()
        })

        expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
        expect(appErrors).toEqual([])
      }
      finally {
        mounted.unmount()
      }
    },
  )

  test('does not restore an older library mutation error after a newer mutation succeeds', async () => {
    const entry = createMarkdownEntry('mutation-stale-error', 'Mutation stale error')
    const pinnedEntry: LibraryEntry = { ...entry, pinned: true }
    const olderMutation = createDeferred<LibraryEntry>()
    const appErrors: unknown[] = []
    let visibleEntries = [entry]

    libraryStoreMocks.listEntries.mockImplementation(async () => visibleEntries)
    libraryStoreMocks.updateEntry
      .mockReturnValueOnce(olderMutation.promise)
      .mockImplementationOnce(async () => {
        visibleEntries = [pinnedEntry]
        return pinnedEntry
      })
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await performLibraryMutation(mounted.host, 'pin', entry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.updateEntry).toHaveBeenCalledOnce())

      await performLibraryMutation(mounted.host, 'pin', entry.title)
      await vi.waitFor(() => {
        expect(libraryStoreMocks.updateEntry).toHaveBeenCalledTimes(2)
        expect(hasLibraryEntryAction(mounted.host, entry.title, '取消置顶')).toBe(true)
        expect(libraryViewStatus(mounted.host)).toBeUndefined()
      })

      olderMutation.reject(new Error('older mutation failed'))
      await flushSettledWork()

      expect(hasLibraryEntryAction(mounted.host, entry.title, '取消置顶')).toBe(true)
      expect(libraryViewStatus(mounted.host)).toBeUndefined()
      expect(libraryStoreMocks.listEntries).toHaveBeenCalledTimes(2)
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  test.each([
    ['delete', '暂时无法删除这篇文档。当前内容已保留，请稍后重试。'],
    ['clear', '暂时无法清空文库。当前内容已保留，请稍后重试。'],
  ] as const)('keeps the active document after a failed library %s', async (action, errorStatus) => {
    const entry = createMarkdownEntry(`active-mutation-${action}`, `Active mutation ${action}`)
    const markdown = `# Active mutation ${action}\n\nBody stays available.`
    const appErrors: unknown[] = []

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openMarkdownDocument.mockResolvedValue(createOpenMarkdownDocument(entry, markdown))
    libraryStoreMocks.deleteEntry.mockRejectedValue(new Error('delete failed'))
    libraryStoreMocks.clearLibrary.mockRejectedValue(new Error('clear failed'))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title, '打开')
      await vi.waitFor(() => expect(readerTitle(mounted.host)).toBe(entry.title))
      await showLibrary(mounted.host)

      await performLibraryMutation(mounted.host, action, entry.title)
      await vi.waitFor(() => expect(libraryViewStatus(mounted.host)).toBe(errorStatus))
      expect(hasLibraryEntry(mounted.host, entry.title)).toBe(true)
      expect(appErrors).toEqual([])

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => {
        expect(readerTitle(mounted.host)).toBe(entry.title)
        expect(readerBody(mounted.host)).toBe(markdown)
      })
    }
    finally {
      mounted.unmount()
    }
  })

  test('shows a library mutation error that settles while the reader is active', async () => {
    const entry = createMarkdownEntry('mutation-hidden-error', 'Mutation hidden error')
    const mutation = createDeferred<LibraryEntry>()
    const appErrors: unknown[] = []

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.updateEntry.mockReturnValue(mutation.promise)
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await performLibraryMutation(mounted.host, 'pin', entry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.updateEntry).toHaveBeenCalledOnce())

      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="library-view"]')).toBeNull())

      mutation.reject(new Error('hidden mutation failed'))
      await flushSettledWork()
      expect(appErrors).toEqual([])

      await showLibrary(mounted.host)
      expect(libraryViewStatus(mounted.host)).toBe(
        '置顶状态暂时无法更新。当前列表已保留，请稍后重试。',
      )
      expect(hasLibraryEntryAction(mounted.host, entry.title, '置顶')).toBe(true)
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

  test('keeps the current PDF position active when its persistence fails and retries later', async () => {
    const entry = createPdfEntry('pdf-position-save-retry', 'PDF position save retry')
    const opened = createOpenPdfDocument(entry)
    const saveError = new Error('PDF position save failed')
    const appErrors: unknown[] = []

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openPdfDocument.mockResolvedValue(opened)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-11T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => {
        expect(mounted.host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(false)
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
          expect.objectContaining({ documentId: entry.id, pageNumber: 1 }),
        )
      })
      await flushSettledWork()

      libraryStoreMocks.saveReadingPosition.mockClear()
      libraryStoreMocks.saveReadingPosition.mockRejectedValueOnce(saveError)
      click(mounted.host, '[aria-label="下一页"]')
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 2 }),
      ))
      await flushSettledWork()

      expect(mounted.host.querySelector('[aria-label="PDF 第 2 页, 共 5 页"]')).not.toBeNull()
      expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
        .toContain('PDF 阅读位置暂时无法保存')
      expect(appErrors).toEqual([])

      await showLibrary(mounted.host)
      click(mounted.host, '[data-testid="library-open-button"]')
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[aria-label="PDF 第 2 页, 共 5 页"]')).not.toBeNull()
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledTimes(2)
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ documentId: entry.id, pageNumber: 2, type: 'pdf' }),
        )
      })
      await flushSettledWork()

      expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
        .not.toContain('PDF 阅读位置暂时无法保存')
      expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
        .toContain('PDF 阅读位置已恢复保存')
      await bookmarkCurrentPdf(mounted.host)
      expect(readBookmarks()).toEqual([
        expect.objectContaining({
          documentKey: `library:${entry.id}`,
          kind: 'pdf-page',
          target: { pageNumber: 2 },
        }),
      ])
      expect(mounted.host.querySelector('.app-shell__live-status')?.textContent)
        .toContain('已添加第 2 页书签')
      expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
        .toContain('PDF 阅读位置已恢复保存')
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  test('keeps a PDF position save warning when import completion publishes its status', async () => {
    const entry = createPdfEntry('pdf-position-import-status', 'PDF position import status')
    const activationRefresh = createDeferred<LibraryEntry[]>()
    const appErrors: unknown[] = []

    libraryStoreMocks.addPdfDocument.mockResolvedValue(entry)
    libraryStoreMocks.listEntries.mockReturnValue(activationRefresh.promise)
    libraryStoreMocks.saveReadingPosition.mockRejectedValue(new Error('PDF import position save failed'))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await dispatchFile(mounted.host, new File([Uint8Array.of(1)], 'PDF position import status.pdf', {
        type: 'application/pdf',
      }))
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('[data-testid="pdf-viewer"]')).not.toBeNull()
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
          expect.objectContaining({ documentId: entry.id, pageNumber: 1, type: 'pdf' }),
        )
        expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
          .toContain('PDF 阅读位置暂时无法保存')
      })

      activationRefresh.resolve([entry])
      await vi.waitFor(() => {
        expect(mounted.host.querySelector('.app-shell__live-status')?.textContent)
          .toContain('PDF 已加入文库')
        expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
          .toContain('PDF 阅读位置暂时无法保存')
      })
      expect(appErrors).toEqual([])
    }
    finally {
      mounted.unmount()
      activationRefresh.resolve([entry])
      await flushSettledWork()
    }
  })

  test('ignores a stale PDF position save failure after a newer position persists', async () => {
    const entry = createPdfEntry('pdf-position-stale-rejection', 'PDF stale position rejection')
    const opened = createOpenPdfDocument(entry)
    const staleSave = createDeferred<PdfReadingPosition>()
    const staleError = new Error('stale PDF position save failed')
    const appErrors: unknown[] = []

    libraryStoreMocks.listEntries.mockResolvedValue([entry])
    libraryStoreMocks.openPdfDocument.mockResolvedValue(opened)
    libraryStoreMocks.saveReadingPosition.mockImplementation(async position => ({
      ...position,
      updatedAt: '2026-08-11T00:00:01.000Z',
    }))
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => {
        expect(mounted.host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(false)
        expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
          expect.objectContaining({ documentId: entry.id, pageNumber: 1 }),
        )
      })
      await flushSettledWork()

      libraryStoreMocks.saveReadingPosition.mockClear()
      libraryStoreMocks.saveReadingPosition.mockImplementation(async (position) => {
        if (position.pageNumber === 2) {
          return staleSave.promise
        }

        return {
          ...position,
          updatedAt: '2026-08-11T00:00:02.000Z',
        }
      })
      click(mounted.host, '[aria-label="下一页"]')
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 2 }),
      ))
      click(mounted.host, '[aria-label="下一页"]')
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 3 }),
      ))
      await flushSettledWork()

      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledTimes(2)
      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ documentId: entry.id, pageNumber: 2, type: 'pdf' }),
      )
      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ documentId: entry.id, pageNumber: 3, type: 'pdf' }),
      )

      const currentPositionStatus = mounted.host
        .querySelector('[data-testid="pdf-position-save-status"]')?.textContent
      staleSave.reject(staleError)
      await flushSettledWork()

      expect(mounted.host.querySelector('[aria-label="PDF 第 3 页, 共 5 页"]')).not.toBeNull()
      expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
        .toBe(currentPositionStatus)
      expect(appErrors).toEqual([])
      await bookmarkCurrentPdf(mounted.host)
      expect(readBookmarks()).toEqual([
        expect.objectContaining({
          documentKey: `library:${entry.id}`,
          kind: 'pdf-page',
          target: { pageNumber: 3 },
        }),
      ])
    }
    finally {
      mounted.unmount()
      staleSave.resolve({
        ...createPdfPosition(entry.id, 2),
        updatedAt: '2026-08-11T00:00:03.000Z',
      })
      await flushSettledWork()
    }
  })

  test('ignores a position save failure from an earlier activation of the same PDF', async () => {
    const entry = createPdfEntry('pdf-position-stale-activation', 'PDF stale activation rejection')
    const stalePosition = createPdfPosition(entry.id, 3)
    const firstOpen = createOpenPdfDocument(entry, stalePosition)
    const secondOpen = createOpenPdfDocument(entry)
    const staleSave = createDeferred<PdfReadingPosition>()
    const secondRead = createDeferred<ArrayBuffer>()
    const appErrors: unknown[] = []

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
        updatedAt: '2026-08-11T00:00:01.000Z',
      }
    })
    libraryStoreMocks.close.mockResolvedValue(undefined)

    const mounted = mountApp(error => appErrors.push(error))

    try {
      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: entry.id, pageNumber: 3, type: 'pdf' }),
      ))

      await showLibrary(mounted.host)
      await openLibraryEntry(mounted.host, entry.title)
      await vi.waitFor(() => {
        expect(mounted.host.textContent).toContain(entry.title)
        expect(secondBlobRead).toHaveBeenCalledOnce()
      })
      expect(libraryStoreMocks.saveReadingPosition).toHaveBeenCalledTimes(1)

      const currentPositionStatus = mounted.host
        .querySelector('[data-testid="pdf-position-save-status"]')?.textContent
      staleSave.reject(new Error('stale activation position save failed'))
      await flushSettledWork()

      expect(mounted.host.querySelector('[data-testid="pdf-position-save-status"]')?.textContent)
        .toBe(currentPositionStatus)
      expect(appErrors).toEqual([])
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
      staleSave.resolve({
        ...stalePosition,
        updatedAt: '2026-08-11T00:00:02.000Z',
      })
      secondRead.resolve(Uint8Array.of(5).buffer)
      await flushSettledWork()
    }
  })

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
      staleSave.resolve({
        ...stalePosition,
        updatedAt: '2026-08-09T00:00:03.000Z',
      })
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

function mountApp(onError?: (error: unknown) => void) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(App)
  let isMounted = true
  if (onError) {
    app.config.errorHandler = error => onError(error)
  }
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

type LibraryMutationAction = 'clear' | 'delete' | 'pin' | 'rename'

async function performLibraryMutation(
  host: HTMLElement,
  action: LibraryMutationAction,
  title: string,
  renameTitle = title,
): Promise<void> {
  if (action === 'rename') {
    await clickLibraryEntryAction(host, title, '重命名')
    let input: HTMLInputElement | null = null
    await vi.waitFor(() => {
      input = host.querySelector<HTMLInputElement>('[data-library-rename-input]')
      expect(input).not.toBeNull()
    })
    if (!input) {
      return
    }

    input.value = renameTitle
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const saveButton = [...(input.closest('form')?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => button.textContent?.trim() === '保存')
    expect(saveButton).toBeDefined()
    saveButton?.click()
    return
  }

  if (action === 'pin') {
    await clickLibraryEntryAction(host, title, '置顶')
    return
  }

  if (action === 'delete') {
    await clickLibraryEntryAction(host, title, '删除')
  }
  else {
    click(host, '[data-testid="library-management-button"]')
    await vi.waitFor(() => expect(
      host.querySelector('[data-testid="library-clear-button"]'),
    ).not.toBeNull())
    click(host, '[data-testid="library-clear-button"]')
  }

  await vi.waitFor(() => expect(host.querySelector('.library-dialog__danger')).not.toBeNull())
  click(host, '.library-dialog__danger')
}

function libraryMutationMock(action: LibraryMutationAction) {
  if (action === 'rename' || action === 'pin') {
    return libraryStoreMocks.updateEntry
  }
  if (action === 'delete') {
    return libraryStoreMocks.deleteEntry
  }
  return libraryStoreMocks.clearLibrary
}

function hasLibraryEntryAction(host: HTMLElement, title: string, action: string): boolean {
  const entry = [...host.querySelectorAll<HTMLElement>('[data-testid="library-entry"]')]
    .find(candidate => candidate.textContent?.includes(title))
  return [...(entry?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .some(button => button.textContent?.trim() === action)
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

async function dispatchFile(host: HTMLElement, file: File): Promise<void> {
  click(host, '[data-testid="floating-affordance-button"]')
  let input: HTMLInputElement | null = null
  await vi.waitFor(() => {
    input = host.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
  })
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  })
  input?.dispatchEvent(new Event('change', { bubbles: true }))
}

function readerTitle(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="reader-document-title"]')?.textContent ?? undefined
}

function readerBody(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="reader-document-body"]')?.textContent ?? undefined
}

function libraryViewStatus(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="library-view"] [role="status"]')?.textContent ?? undefined
}

function hasLibraryEntry(host: HTMLElement, title: string): boolean {
  return [...host.querySelectorAll<HTMLElement>('[data-testid="library-entry"]')]
    .some(entry => entry.textContent?.includes(title))
}

function changeLibrarySort(host: HTMLElement, mode: LibrarySortMode): void {
  const sort = host.querySelector<HTMLSelectElement>('[data-testid="library-sort"]')
  expect(sort).not.toBeNull()
  if (!sort) {
    return
  }

  sort.value = mode
  sort.dispatchEvent(new Event('change', { bubbles: true }))
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
  position: MarkdownReadingPosition | null = null,
): OpenMarkdownDocumentResult {
  return {
    entry,
    markdown,
    position,
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
