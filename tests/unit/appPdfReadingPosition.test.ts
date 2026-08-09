import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import App from '@/App.vue'
import type { LibraryEntry, OpenPdfDocumentResult, PdfReadingPosition } from '@/features/library/types'
import { readerBookmarksStorageKey } from '@/features/reader/bookmarks'

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
  openMarkdownDocument: vi.fn(),
  openPdfDocument: vi.fn(),
  saveReadingPosition: vi.fn(),
  updateEntry: vi.fn(),
}))
const pdfJsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}))

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
      setup(_props, { expose }) {
        expose({
          clearSearch: vi.fn(),
          focus: vi.fn(),
          getBookmarkSnippet: vi.fn(() => ''),
          goToSearchMatch: vi.fn(),
          scrollToHeading: vi.fn(),
        })
        return () => h('article', { 'data-testid': 'reader-surface-stub' })
      },
    }),
  }
})

describe('App PDF reading position ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of Object.values(libraryStoreMocks)) {
      mock.mockReset()
    }
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

async function openLibraryEntry(host: HTMLElement, title: string): Promise<void> {
  let openButton: HTMLButtonElement | undefined
  await vi.waitFor(() => {
    const entry = [...host.querySelectorAll<HTMLElement>('[data-testid="library-entry"]')]
      .find(candidate => candidate.textContent?.includes(title))
    openButton = [...(entry?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => button.textContent?.trim() === '看原件')
    expect(openButton).toBeDefined()
  })
  openButton?.click()
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

function createPdfEntry(id: string, title: string): LibraryEntry {
  return {
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
