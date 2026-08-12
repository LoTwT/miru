import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, test, vi } from 'vitest'

import PdfViewer from '@/components/PdfViewer.vue'
import type { LibraryEntry } from '@/features/library/types'

const pdfJsMocks = vi.hoisted(() => ({
  createTextDivs: vi.fn(),
  getDocument: vi.fn(),
  renderTextLayer: vi.fn(),
  setWorkerSrc: vi.fn(),
}))
const virtualizerMocks = vi.hoisted(() => ({
  measure: vi.fn(),
  measureElement: vi.fn(),
  resizeItem: vi.fn(),
  scrollToIndex: vi.fn(),
}))

interface PdfSearchState {
  activeIndex: number
  announcement?: string
  resultContext?: string
  statusText?: string
  total: number
}

interface PdfViewerHandle {
  goToSearchMatch: (delta: number) => void
}

vi.mock('@tanstack/vue-virtual', async () => {
  const { computed } = await import('vue')

  return {
    useVirtualizer: (options: { value: { count: number } }) => computed(() => {
      const count = options.value.count
      return {
        getTotalSize: () => count * 810,
        getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
          end: ((index + 1) * 810) - 18,
          index,
          key: index + 1,
          lane: 0,
          size: 792,
          start: index * 810,
        })),
        measure: virtualizerMocks.measure,
        measureElement: virtualizerMocks.measureElement,
        resizeItem: virtualizerMocks.resizeItem,
        scrollToIndex: virtualizerMocks.scrollToIndex,
      }
    }),
  }
})

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    set workerSrc(value: string) {
      pdfJsMocks.setWorkerSrc(value)
    },
  },
  TextLayer: class {
    cancel = vi.fn()
    render = vi.fn(async () => {
      await pdfJsMocks.renderTextLayer()
    })
    textDivs: HTMLElement[]

    constructor(options: { container: HTMLElement }) {
      this.textDivs = pdfJsMocks.createTextDivs(options) ?? []
    }
  },
  getDocument: pdfJsMocks.getDocument,
  setLayerDimensions: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: '/pdf.worker.test.mjs',
}))

afterEach(() => {
  pdfJsMocks.createTextDivs.mockReset()
  pdfJsMocks.getDocument.mockReset()
  pdfJsMocks.renderTextLayer.mockReset()
  pdfJsMocks.setWorkerSrc.mockReset()
  virtualizerMocks.measure.mockReset()
  virtualizerMocks.measureElement.mockReset()
  virtualizerMocks.resizeItem.mockReset()
  virtualizerMocks.scrollToIndex.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

describe('PdfViewer loading lifecycle', () => {
  test('offers a page reload when the PDF runtime resources fail to initialize', async () => {
    pdfJsMocks.setWorkerSrc.mockImplementationOnce(() => {
      throw new Error('runtime chunk failed')
    })
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
      createPdfEntry('resource-failure', 'Resource failure'),
    )

    try {
      await vi.waitFor(() => {
        expect(viewer.host.querySelector('[role="alert"]')?.textContent)
          .toContain('PDF 阅读器资源暂时无法加载')
      })

      expect(viewer.host.textContent).toContain('重新加载页面')
      expect(viewer.host.textContent).not.toContain('这个 PDF 打不开')
      expect(pdfJsMocks.getDocument).not.toHaveBeenCalled()
    }
    finally {
      viewer.unmount()
    }
  })

  test('offers a page reload when the PDF worker resource fails to initialize', async () => {
    pdfJsMocks.getDocument.mockImplementation(() => ({
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.reject(new Error('Setting up fake worker failed: Failed to fetch dynamically imported module')),
    }))
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
      createPdfEntry('worker-failure', 'Worker failure'),
    )

    try {
      await vi.waitFor(() => {
        expect(viewer.host.querySelector('[role="alert"]')?.textContent)
          .toContain('PDF 阅读器资源暂时无法加载')
      })

      expect(viewer.host.textContent).toContain('重新加载页面')
      expect(viewer.host.textContent).not.toContain('这个 PDF 打不开')
    }
    finally {
      viewer.unmount()
    }
  })

  test('keeps the latest PDF visible when an earlier blob read finishes later', async () => {
    const slowRead = createDeferred<ArrayBuffer>()
    const slowBlob = new Blob([Uint8Array.of(3)], { type: 'application/pdf' })
    const fastBlob = new Blob([Uint8Array.of(2)], { type: 'application/pdf' })
    const slowArrayBuffer = vi.spyOn(slowBlob, 'arrayBuffer').mockImplementation(() => slowRead.promise)
    vi.spyOn(fastBlob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(2).buffer)
    pdfJsMocks.getDocument.mockImplementation(({ data }: { data: Uint8Array }) =>
      createPdfLoadingTask(data[0] ?? 1),
    )
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(slowBlob, createPdfEntry('slow-a', 'Slow A'))

    try {
      await vi.waitFor(() => expect(slowArrayBuffer).toHaveBeenCalledOnce())

      viewer.entry.value = createPdfEntry('fast-b', 'Fast B')
      viewer.blob.value = fastBlob
      await nextTick()
      await vi.waitFor(() => {
        expect(viewer.host.textContent).toContain('Fast B')
        expect(viewer.host.textContent).toContain('1 / 2')
      })

      slowRead.resolve(Uint8Array.of(3).buffer)
      await flushSettledWork()

      expect(viewer.host.querySelector('.pdf-viewer__title')?.textContent).toContain('Fast B')
      expect(viewer.host.textContent).toContain('1 / 2')
      expect(viewer.host.textContent).not.toContain('1 / 3')
      expect(viewer.host.querySelector('[data-testid="pdf-viewer-canvas"]')?.getAttribute('aria-label'))
        .toBe('PDF 第 1 页, 共 2 页')
    }
    finally {
      viewer.unmount()
    }
  })

  test('ignores an earlier blob read failure after the latest PDF is ready', async () => {
    const slowRead = createDeferred<ArrayBuffer>()
    const slowBlob = new Blob([Uint8Array.of(3)], { type: 'application/pdf' })
    const fastBlob = new Blob([Uint8Array.of(2)], { type: 'application/pdf' })
    const slowArrayBuffer = vi.spyOn(slowBlob, 'arrayBuffer').mockImplementation(() => slowRead.promise)
    vi.spyOn(fastBlob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(2).buffer)
    pdfJsMocks.getDocument.mockImplementation(({ data }: { data: Uint8Array }) =>
      createPdfLoadingTask(data[0] ?? 1),
    )
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(slowBlob, createPdfEntry('slow-a', 'Slow A'))

    try {
      await vi.waitFor(() => expect(slowArrayBuffer).toHaveBeenCalledOnce())

      viewer.entry.value = createPdfEntry('fast-b', 'Fast B')
      viewer.blob.value = fastBlob
      await nextTick()
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 2'))

      slowRead.reject(new Error('stale read failed'))
      await flushSettledWork()

      expect(viewer.host.textContent).toContain('Fast B')
      expect(viewer.host.textContent).toContain('1 / 2')
      expect(viewer.host.textContent).not.toContain('这个 PDF 打不开')
      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
    }
    finally {
      viewer.unmount()
    }
  })

  test('retries releasing a ready PDF after its first destroy attempt fails', async () => {
    const readyLoadingTask = createPdfLoadingTask(3)
    const readyDestroy = readyLoadingTask.destroy
    readyDestroy
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValueOnce(undefined)
    const slowBlob = new Blob([Uint8Array.of(3)], { type: 'application/pdf' })
    const fastBlob = new Blob([Uint8Array.of(2)], { type: 'application/pdf' })
    vi.spyOn(slowBlob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(3).buffer)
    vi.spyOn(fastBlob, 'arrayBuffer').mockResolvedValue(Uint8Array.of(2).buffer)
    pdfJsMocks.getDocument
      .mockReturnValueOnce(readyLoadingTask)
      .mockImplementationOnce(({ data }: { data: Uint8Array }) => createPdfLoadingTask(data[0] ?? 1))
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(slowBlob, createPdfEntry('slow-a', 'Slow A'))

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 3'))

      viewer.entry.value = createPdfEntry('fast-b', 'Fast B')
      viewer.blob.value = fastBlob
      await nextTick()
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 2'))
      expect(readyDestroy).toHaveBeenCalledTimes(2)
    }
    finally {
      viewer.unmount()
    }
  })

  test('offers a page reload when the previous PDF render cannot be cleaned up', async () => {
    const cleanupError = new Error('render cleanup failed')
    const render = createDeferred<void>()
    const initialBlob = new Blob([Uint8Array.of(2)], { type: 'application/pdf' })
    const nextBlob = new Blob([Uint8Array.of(3)], { type: 'application/pdf' })
    pdfJsMocks.getDocument.mockReturnValueOnce(createPdfLoadingTask(2, () => {
      throw cleanupError
    }, render.promise))
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(initialBlob, createPdfEntry('cleanup-a', 'Cleanup A'))

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 2'))

      viewer.entry.value = createPdfEntry('cleanup-b', 'Cleanup B')
      viewer.blob.value = nextBlob
      await nextTick()
      await vi.waitFor(() => {
        expect(viewer.host.querySelector('[role="alert"]')?.textContent)
          .toContain('PDF 阅读器资源暂时无法加载')
      })

      expect(viewer.host.textContent).toContain('重新加载页面')
      expect(viewer.host.textContent).not.toContain('这个 PDF 打不开')
      expect(pdfJsMocks.getDocument).toHaveBeenCalledOnce()
    }
    finally {
      viewer.unmount()
      render.resolve(undefined)
    }
  })

  test('ignores a paged render failure after switching to scroll mode', async () => {
    const stalePage = createDeferred<ReturnType<typeof createPdfPage>>()
    const currentPage = createPdfPage()
    const loadingTask = {
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.resolve<unknown>(undefined),
    }
    const pdfDocument = {
      getPage: vi.fn()
        .mockImplementationOnce(() => stalePage.promise)
        .mockResolvedValue(currentPage),
      loadingTask,
      numPages: 2,
    }
    loadingTask.promise = Promise.resolve(pdfDocument)
    pdfJsMocks.getDocument.mockReturnValue(loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
      createPdfEntry('mode-switch', 'Mode switch'),
    )

    try {
      await vi.waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledOnce())
      const scrollButton = [...viewer.host.querySelectorAll('button')]
        .find(button => button.textContent?.trim() === '滚动')
      expect(scrollButton).toBeDefined()

      scrollButton?.click()
      await vi.waitFor(() => expect(scrollButton?.getAttribute('aria-pressed')).toBe('true'))
      await vi.waitFor(() => expect(pdfDocument.getPage.mock.calls.length).toBeGreaterThan(1))

      stalePage.reject(new Error('stale paged render failed'))
      await flushSettledWork()

      expect(viewer.host.textContent).not.toContain('这一页暂时无法显示')
      expect(scrollButton?.getAttribute('aria-pressed')).toBe('true')
    }
    finally {
      viewer.unmount()
    }
  })

  test('does not start pdf.js after unmounting during a blob read', async () => {
    const slowRead = createDeferred<ArrayBuffer>()
    const slowBlob = new Blob([Uint8Array.of(3)], { type: 'application/pdf' })
    const slowArrayBuffer = vi.spyOn(slowBlob, 'arrayBuffer').mockImplementation(() => slowRead.promise)
    pdfJsMocks.getDocument.mockImplementation(({ data }: { data: Uint8Array }) =>
      createPdfLoadingTask(data[0] ?? 1),
    )
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(slowBlob, createPdfEntry('slow-a', 'Slow A'))

    try {
      await vi.waitFor(() => expect(slowArrayBuffer).toHaveBeenCalledOnce())
      viewer.unmount()
      slowRead.resolve(Uint8Array.of(3).buffer)
      await flushSettledWork()

      expect(pdfJsMocks.getDocument).not.toHaveBeenCalled()
    }
    finally {
      viewer.unmount()
    }
  })
})

describe('PdfViewer search extraction', () => {
  test.each([
    ['getPage', 'page read failed'],
    ['getTextContent', 'text extraction failed'],
  ] as const)('reports a retryable search error when %s rejects', async (failureStage, message) => {
    const searchFixture = createSearchPdfLoadingTask({
      getPageError: failureStage === 'getPage' ? new Error(message) : undefined,
      getTextContentError: failureStage === 'getTextContent' ? new Error(message) : undefined,
    })
    pdfJsMocks.getDocument.mockReturnValue(searchFixture.loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(1)], { type: 'application/pdf' }),
      createPdfEntry(`search-${failureStage}`, `Search ${failureStage}`),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 1'))

      viewer.searchQuery.value = 'needle'
      await nextTick()

      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates)).toEqual({
          activeIndex: -1,
          announcement: 'PDF 搜索文本读取失败, 请重试。',
          statusText: '搜索文本读取失败, 请重试',
          total: 0,
        })
      })
      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
      expect(viewer.host.textContent).toContain('1 / 1')
    }
    finally {
      viewer.unmount()
    }
  })

  test('clears partial matches when a later PDF page cannot be extracted', async () => {
    const firstPage = {
      ...createPdfPage(),
      getTextContent: vi.fn().mockResolvedValue(createPdfTextContent('needle on the first page')),
    }
    const secondPage = {
      ...createPdfPage(),
      getTextContent: vi.fn().mockRejectedValue(new Error('second page extraction failed')),
    }
    const loadingTask = {
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.resolve<unknown>(undefined),
    }
    const pdfDocument = {
      getPage: vi.fn((page: number) => Promise.resolve(page === 1 ? firstPage : secondPage)),
      loadingTask,
      numPages: 2,
    }
    loadingTask.promise = Promise.resolve(pdfDocument)
    pdfJsMocks.getDocument.mockReturnValue(loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
      createPdfEntry('search-partial', 'Search partial'),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 2'))

      viewer.searchQuery.value = 'needle'
      await nextTick()

      await vi.waitFor(() => {
        expect(viewer.searchStates.some(state => state.total === 1)).toBe(true)
        expect(latestSearchState(viewer.searchStates)).toEqual({
          activeIndex: -1,
          announcement: 'PDF 搜索文本读取失败, 请重试。',
          statusText: '搜索文本读取失败, 请重试',
          total: 0,
        })
      })
      expect(viewer.host.querySelectorAll('.pdf-viewer__search-match')).toHaveLength(0)
      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
      expect(viewer.host.textContent).toContain('1 / 2')

      viewer.host.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')?.click()
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('2 / 2'))
      await flushSettledWork()

      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
      expect(viewer.host.textContent).not.toContain('这一页暂时无法显示')
      expect(latestSearchState(viewer.searchStates).statusText)
        .toBe('搜索文本读取失败, 请重试')
    }
    finally {
      viewer.unmount()
    }
  })

  test('keeps a current text-layer failure after the remaining pages finish indexing', async () => {
    const secondPageText = createDeferred<ReturnType<typeof createPdfTextContent>>()
    const textLayerRender = createDeferred<void>()
    pdfJsMocks.renderTextLayer.mockImplementationOnce(() => textLayerRender.promise)
    const firstPage = {
      ...createPdfPage(),
      getTextContent: vi.fn().mockResolvedValue(createPdfTextContent('needle on the first page')),
    }
    const secondPage = {
      ...createPdfPage(),
      getTextContent: vi.fn(() => secondPageText.promise),
    }
    const loadingTask = {
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.resolve<unknown>(undefined),
    }
    const pdfDocument = {
      getPage: vi.fn((page: number) => Promise.resolve(page === 1 ? firstPage : secondPage)),
      loadingTask,
      numPages: 2,
    }
    loadingTask.promise = Promise.resolve(pdfDocument)
    pdfJsMocks.getDocument.mockReturnValue(loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
      createPdfEntry('search-current-layer-error', 'Search current layer error'),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 2'))

      viewer.searchQuery.value = 'needle'
      await nextTick()
      await vi.waitFor(() => {
        expect(secondPage.getTextContent).toHaveBeenCalledOnce()
        expect(pdfJsMocks.renderTextLayer).toHaveBeenCalledOnce()
      })

      textLayerRender.reject(new Error('current text-layer failed'))
      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates).statusText)
          .toBe('搜索文本读取失败, 请重试')
      })

      secondPageText.resolve(createPdfTextContent('second page text'))
      await flushSettledWork()

      expect(latestSearchState(viewer.searchStates)).toEqual({
        activeIndex: -1,
        announcement: 'PDF 搜索文本读取失败, 请重试。',
        statusText: '搜索文本读取失败, 请重试',
        total: 0,
      })
      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
      expect(viewer.host.textContent).toContain('1 / 2')
      expect(pdfJsMocks.renderTextLayer).toHaveBeenCalledOnce()
    }
    finally {
      viewer.unmount()
    }
  })

  test('keeps the PDF page readable when initial search extraction fails', async () => {
    const searchFixture = createSearchPdfLoadingTask({
      getTextContent: () => Promise.reject(new Error('initial extraction failed')),
    })
    pdfJsMocks.getDocument.mockReturnValue(searchFixture.loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(1)], { type: 'application/pdf' }),
      createPdfEntry('search-initial', 'Search initial'),
      'needle',
    )

    try {
      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates).statusText)
          .toBe('搜索文本读取失败, 请重试')
      })

      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
      expect(viewer.host.textContent).not.toContain('这一页暂时无法显示')
      expect(viewer.host.querySelector('[data-testid="pdf-viewer-canvas"]')?.getAttribute('aria-label'))
        .toBe('PDF 第 1 页, 共 1 页')
    }
    finally {
      viewer.unmount()
    }
  })

  test('retries text extraction after a failed search', async () => {
    const searchFixture = createSearchPdfLoadingTask({
      getTextContentError: new Error('temporary extraction failure'),
      searchableText: 'available text',
    })
    pdfJsMocks.getDocument.mockReturnValue(searchFixture.loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(1)], { type: 'application/pdf' }),
      createPdfEntry('search-retry', 'Search retry'),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 1'))

      viewer.searchQuery.value = 'first query'
      await nextTick()
      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates).statusText)
          .toBe('搜索文本读取失败, 请重试')
      })

      viewer.searchQuery.value = ''
      await nextTick()
      viewer.searchQuery.value = 'first query'
      await nextTick()
      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates)).toEqual({
          activeIndex: -1,
          announcement: undefined,
          resultContext: undefined,
          statusText: undefined,
          total: 0,
        })
      })
      expect(searchFixture.getTextContent).toHaveBeenCalledTimes(2)
      expect(viewer.host.textContent).toContain('1 / 1')
    }
    finally {
      viewer.unmount()
    }
  })

  test('does not let an earlier document search failure overwrite the latest search', async () => {
    const staleExtraction = createDeferred<ReturnType<typeof createPdfTextContent>>()
    const staleFixture = createSearchPdfLoadingTask({
      getTextContent: () => staleExtraction.promise,
    })
    const currentFixture = createSearchPdfLoadingTask({ searchableText: 'current document text' })
    pdfJsMocks.getDocument
      .mockReturnValueOnce(staleFixture.loadingTask)
      .mockReturnValueOnce(currentFixture.loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(1)], { type: 'application/pdf' }),
      createPdfEntry('search-stale', 'Search stale'),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 1'))
      viewer.searchQuery.value = 'missing query'
      await nextTick()
      await vi.waitFor(() => expect(staleFixture.getTextContent).toHaveBeenCalledOnce())

      viewer.entry.value = createPdfEntry('search-current', 'Search current')
      viewer.blob.value = new Blob([Uint8Array.of(2)], { type: 'application/pdf' })
      await nextTick()
      await vi.waitFor(() => {
        expect(viewer.host.textContent).toContain('Search current')
        expect(currentFixture.getTextContent).toHaveBeenCalledOnce()
        expect(latestSearchState(viewer.searchStates)).toEqual({
          activeIndex: -1,
          announcement: undefined,
          resultContext: undefined,
          statusText: undefined,
          total: 0,
        })
      })
      const successfulState = latestSearchState(viewer.searchStates)
      const successfulStateCount = viewer.searchStates.length

      staleExtraction.reject(new Error('stale extraction failed'))
      await flushSettledWork()

      expect(viewer.searchStates).toHaveLength(successfulStateCount)
      expect(latestSearchState(viewer.searchStates)).toBe(successfulState)
      expect(viewer.host.textContent).toContain('Search current')
      expect(viewer.host.textContent).toContain('1 / 1')
    }
    finally {
      viewer.unmount()
    }
  })

  test('does not let an earlier text-layer failure overwrite a newer search', async () => {
    const staleTextLayer = createDeferred<ReturnType<typeof createPdfTextContent>>()
    const pages = Array.from({ length: 9 }, (_, index) => ({
      ...createPdfPage(),
      getTextContent: index === 0
        ? vi.fn()
            .mockResolvedValueOnce(createPdfTextContent('old query'))
            .mockImplementationOnce(() => staleTextLayer.promise)
        : vi.fn().mockResolvedValue(createPdfTextContent(`page ${index + 1}`)),
    }))
    const loadingTask = {
      destroy: vi.fn().mockResolvedValue(undefined),
      promise: Promise.resolve<unknown>(undefined),
    }
    const pdfDocument = {
      getPage: vi.fn((page: number) => Promise.resolve(pages[page - 1]!)),
      loadingTask,
      numPages: pages.length,
    }
    loadingTask.promise = Promise.resolve(pdfDocument)
    pdfJsMocks.getDocument.mockReturnValue(loadingTask)
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(9)], { type: 'application/pdf' }),
      createPdfEntry('search-stale-layer', 'Search stale layer'),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 9'))
      viewer.searchQuery.value = 'old query'
      await nextTick()
      await vi.waitFor(() => {
        expect(pages[8]!.getTextContent).toHaveBeenCalledOnce()
        expect(latestSearchState(viewer.searchStates).total).toBe(1)
        expect(latestSearchState(viewer.searchStates).resultContext).toBe('第 1 页')
      })

      for (let page = 2; page <= 9; page += 1) {
        viewer.host.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')?.click()
        await vi.waitFor(() => {
          expect(viewer.host.querySelector('.pdf-viewer__page-total')?.textContent).toBe(`${page} / 9`)
        })
      }

      const pageInput = viewer.host.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!
      pageInput.value = '1'
      pageInput.dispatchEvent(new Event('input', { bubbles: true }))
      pageInput.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.waitFor(() => expect(pages[0]!.getTextContent).toHaveBeenCalledTimes(2))

      viewer.searchQuery.value = 'new query'
      await nextTick()
      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates)).toEqual({
          activeIndex: -1,
          announcement: undefined,
          resultContext: undefined,
          statusText: undefined,
          total: 0,
        })
      })
      const successfulState = latestSearchState(viewer.searchStates)
      const successfulStateCount = viewer.searchStates.length

      staleTextLayer.reject(new Error('stale text-layer extraction failed'))
      await flushSettledWork()

      expect(viewer.searchStates).toHaveLength(successfulStateCount)
      expect(latestSearchState(viewer.searchStates)).toBe(successfulState)
      expect(viewer.host.querySelector('[role="alert"]')).toBeNull()
      expect(viewer.host.textContent).toContain('1 / 9')
    }
    finally {
      viewer.unmount()
    }
  })

  test('only reveals the latest match after rapid navigation within one search', async () => {
    const fixture = createSearchPdfLoadingTask({ searchableText: 'needle and needle' })
    pdfJsMocks.getDocument.mockReturnValue(fixture.loadingTask)
    pdfJsMocks.createTextDivs.mockImplementation(({ container }: { container: HTMLElement }) => {
      const textDiv = container.ownerDocument.createElement('span')
      container.append(textDiv)
      return [textDiv]
    })
    stubPdfViewerRuntime()
    const viewer = mountPdfViewer(
      new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
      createPdfEntry('search-latest-reveal', 'Search latest reveal'),
    )

    try {
      await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 1'))
      const scrollButton = [...viewer.host.querySelectorAll('button')]
        .find(button => button.textContent?.trim() === '滚动')
      expect(scrollButton).toBeDefined()

      scrollButton?.click()
      await vi.waitFor(() => expect(scrollButton?.getAttribute('aria-pressed')).toBe('true'))
      await flushSettledWork()

      const stage = viewer.host.querySelector<HTMLElement>('[data-testid="pdf-viewer-stage"]')!
      const stageScrollTo = vi.fn()
      Object.defineProperty(stage, 'scrollTo', {
        configurable: true,
        value: stageScrollTo,
      })

      viewer.searchQuery.value = 'needle'
      await nextTick()
      await vi.waitFor(() => {
        expect(latestSearchState(viewer.searchStates)).toMatchObject({
          activeIndex: 0,
          resultContext: '第 1 页',
          total: 2,
        })
        expect(pdfJsMocks.renderTextLayer).toHaveBeenCalled()
        expect(stageScrollTo).toHaveBeenCalled()
      })
      await flushSettledWork()
      stageScrollTo.mockClear()
      viewer.positionChanges.length = 0

      viewer.component.value?.goToSearchMatch(1)
      viewer.component.value?.goToSearchMatch(1)
      await flushSettledWork()

      expect(latestSearchState(viewer.searchStates)).toMatchObject({
        activeIndex: 0,
        resultContext: '第 1 页',
        total: 2,
      })
      expect(stageScrollTo).toHaveBeenCalledTimes(2)
      expect(viewer.positionChanges).toHaveLength(2)
    }
    finally {
      viewer.unmount()
    }
  })

  test.each(['new-query', 'manual-scroll'] as const)(
    'does not resume a pending search reveal after %s takes ownership',
    async (nextIntent) => {
      const scrollPageRender = createDeferred<void>()
      const initialPage = createPdfPage()
      const scrollPage = {
        ...createPdfPage(() => {}, scrollPageRender.promise),
        getTextContent: vi.fn().mockResolvedValue(createPdfTextContent('old result')),
      }
      const loadingTask = {
        destroy: vi.fn().mockResolvedValue(undefined),
        promise: Promise.resolve<unknown>(undefined),
      }
      const pdfDocument = {
        getPage: vi.fn()
          .mockResolvedValueOnce(initialPage)
          .mockResolvedValue(scrollPage),
        loadingTask,
        numPages: 1,
      }
      loadingTask.promise = Promise.resolve(pdfDocument)
      pdfJsMocks.getDocument.mockReturnValue(loadingTask)
      pdfJsMocks.createTextDivs.mockImplementation(({ container }: { container: HTMLElement }) => {
        const textDiv = container.ownerDocument.createElement('span')
        container.append(textDiv)
        return [textDiv]
      })
      stubPdfViewerRuntime()
      const viewer = mountPdfViewer(
        new Blob([Uint8Array.of(2)], { type: 'application/pdf' }),
        createPdfEntry('search-stale-reveal', 'Search stale reveal'),
      )

      try {
        await vi.waitFor(() => expect(viewer.host.textContent).toContain('1 / 1'))
        const scrollButton = [...viewer.host.querySelectorAll('button')]
          .find(button => button.textContent?.trim() === '滚动')
        expect(scrollButton).toBeDefined()

        scrollButton?.click()
        await vi.waitFor(() => expect(scrollButton?.getAttribute('aria-pressed')).toBe('true'))
        await vi.waitFor(() => expect(scrollPage.render).toHaveBeenCalledOnce())

        const stage = viewer.host.querySelector<HTMLElement>('[data-testid="pdf-viewer-stage"]')!
        const stageScrollTo = vi.fn()
        Object.defineProperty(stage, 'scrollTo', {
          configurable: true,
          value: stageScrollTo,
        })

        viewer.searchQuery.value = 'old'
        await nextTick()
        await vi.waitFor(() => {
          expect(latestSearchState(viewer.searchStates).resultContext).toBe('第 1 页')
        })

        if (nextIntent === 'new-query') {
          viewer.searchQuery.value = 'missing'
          await nextTick()
          await vi.waitFor(() => {
            expect(latestSearchState(viewer.searchStates)).toEqual({
              activeIndex: -1,
              announcement: undefined,
              resultContext: undefined,
              statusText: undefined,
              total: 0,
            })
          })
        }
        else {
          stage.dispatchEvent(new WheelEvent('wheel'))
          await nextTick()
          expect(latestSearchState(viewer.searchStates)).toMatchObject({
            activeIndex: 0,
            total: 1,
          })
        }
        await flushSettledWork()
        stageScrollTo.mockClear()
        viewer.positionChanges.length = 0

        scrollPageRender.resolve(undefined)
        await flushSettledWork()

        if (nextIntent === 'new-query') {
          expect(latestSearchState(viewer.searchStates)).toEqual({
            activeIndex: -1,
            announcement: undefined,
            resultContext: undefined,
            statusText: undefined,
            total: 0,
          })
        }
        else {
          expect(latestSearchState(viewer.searchStates)).toMatchObject({
            activeIndex: 0,
            total: 1,
          })
        }
        expect(stageScrollTo).not.toHaveBeenCalled()
        expect(viewer.positionChanges).toHaveLength(0)
      }
      finally {
        viewer.unmount()
        scrollPageRender.resolve(undefined)
        await flushSettledWork()
      }
    },
  )
})

function mountPdfViewer(initialBlob: Blob, initialEntry: LibraryEntry, initialSearchQuery = '') {
  const component = shallowRef<PdfViewerHandle | null>(null)
  const entry = shallowRef(initialEntry)
  const blob = shallowRef<Blob>(initialBlob)
  const searchQuery = shallowRef(initialSearchQuery)
  const searchStates: PdfSearchState[] = []
  const positionChanges: unknown[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(defineComponent({
    setup() {
      return () => h(PdfViewer, {
        blob: blob.value,
        entry: entry.value,
        position: null,
        ref: component,
        searchQuery: searchQuery.value,
        onPositionChange: (position: unknown) => positionChanges.push(position),
        onSearchChange: (state: PdfSearchState) => searchStates.push(state),
      })
    },
  }))
  let isMounted = true
  app.mount(host)

  return {
    blob,
    component,
    entry,
    host,
    positionChanges,
    searchQuery,
    searchStates,
    unmount() {
      if (isMounted) {
        app.unmount()
        isMounted = false
      }
      host.remove()
    },
  }
}

function latestSearchState(states: PdfSearchState[]): PdfSearchState {
  const state = states.at(-1)
  expect(state).toBeDefined()
  return state!
}

function stubPdfViewerRuntime(): void {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
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
    createdAt: '2026-08-07T00:00:00.000Z',
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
    updatedAt: '2026-08-07T00:00:00.000Z',
  }
}

function createPdfLoadingTask(
  numPages: number,
  cancelRender: () => void = () => {},
  renderPromise: Promise<void> = Promise.resolve(),
) {
  const page = createPdfPage(cancelRender, renderPromise)
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

function createPdfPage(
  cancelRender: () => void = () => {},
  renderPromise: Promise<void> = Promise.resolve(),
) {
  const renderTask = {
    cancel: vi.fn(cancelRender),
    promise: renderPromise,
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

function createSearchPdfLoadingTask(options: {
  getPageError?: Error
  getTextContent?: () => Promise<ReturnType<typeof createPdfTextContent>>
  getTextContentError?: Error
  searchableText?: string
} = {}) {
  const renderPage = createPdfPage()
  const getTextContent = options.getTextContent ? vi.fn(options.getTextContent) : vi.fn()
  if (!options.getTextContent) {
    if (options.getTextContentError) {
      getTextContent.mockRejectedValueOnce(options.getTextContentError)
    }
    getTextContent.mockResolvedValue(createPdfTextContent(options.searchableText ?? 'searchable text'))
  }
  const searchPage = {
    ...createPdfPage(),
    getTextContent,
  }
  const getPage = vi.fn()
    .mockResolvedValueOnce(renderPage)
    .mockImplementation(() => {
      if (options.getPageError) {
        return Promise.reject(options.getPageError)
      }

      return Promise.resolve(searchPage)
    })
  const loadingTask = {
    destroy: vi.fn().mockResolvedValue(undefined),
    promise: Promise.resolve<unknown>(undefined),
  }
  const pdfDocument = {
    getPage,
    loadingTask,
    numPages: 1,
  }
  loadingTask.promise = Promise.resolve(pdfDocument)

  return {
    getPage,
    getTextContent,
    loadingTask,
  }
}

function createPdfTextContent(text = '') {
  return {
    items: text ? [{ hasEOL: false, str: text }] : [],
    styles: {},
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
