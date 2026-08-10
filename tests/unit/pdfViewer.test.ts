import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, test, vi } from 'vitest'

import PdfViewer from '@/components/PdfViewer.vue'
import type { LibraryEntry } from '@/features/library/types'

const pdfJsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  setWorkerSrc: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    set workerSrc(value: string) {
      pdfJsMocks.setWorkerSrc(value)
    },
  },
  TextLayer: class {},
  getDocument: pdfJsMocks.getDocument,
  setLayerDimensions: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: '/pdf.worker.test.mjs',
}))

describe('PdfViewer loading lifecycle', () => {
  afterEach(() => {
    pdfJsMocks.getDocument.mockReset()
    pdfJsMocks.setWorkerSrc.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  })

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

function mountPdfViewer(initialBlob: Blob, initialEntry: LibraryEntry) {
  const entry = shallowRef(initialEntry)
  const blob = shallowRef<Blob>(initialBlob)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(defineComponent({
    setup() {
      return () => h(PdfViewer, {
        blob: blob.value,
        entry: entry.value,
        position: null,
        searchQuery: '',
      })
    },
  }))
  let isMounted = true
  app.mount(host)

  return {
    blob,
    entry,
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

function stubPdfViewerRuntime(): void {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
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
