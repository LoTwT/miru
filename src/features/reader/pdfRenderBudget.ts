export const defaultPdfCanvasPixelBudget = 8_388_608
export const defaultPdfCanvasDimensionLimit = 8_192

export interface PdfCanvasMetrics {
  height: number
  scale: number
  width: number
}

interface PdfCanvasMetricsOptions {
  cssHeight: number
  cssWidth: number
  devicePixelRatio: number
  maxDimension?: number
  maxPixels?: number
}

interface PdfPageRenderJob {
  order: number
  page: number
  priority: number
  promise: Promise<void>
  reject: (reason?: unknown) => void
  resolve: () => void
  run: () => Promise<void>
  state: 'queued' | 'running'
}

export function getPdfCanvasMetrics(options: PdfCanvasMetricsOptions): PdfCanvasMetrics {
  const cssWidth = Math.max(1, finiteOrFallback(options.cssWidth, 1))
  const cssHeight = Math.max(1, finiteOrFallback(options.cssHeight, 1))
  const requestedScale = Math.max(0.1, finiteOrFallback(options.devicePixelRatio, 1))
  const maxPixels = Math.max(1, finiteOrFallback(options.maxPixels, defaultPdfCanvasPixelBudget))
  const maxDimension = Math.max(1, finiteOrFallback(options.maxDimension, defaultPdfCanvasDimensionLimit))
  const pixelScale = Math.sqrt(maxPixels / (cssWidth * cssHeight))
  const dimensionScale = Math.min(maxDimension / cssWidth, maxDimension / cssHeight)
  const scale = Math.min(requestedScale, pixelScale, dimensionScale)

  return {
    height: Math.max(1, Math.floor(cssHeight * scale)),
    scale,
    width: Math.max(1, Math.floor(cssWidth * scale)),
  }
}

export class PdfPageRenderQueue {
  private readonly jobs = new Map<number, PdfPageRenderJob>()
  private activeCount = 0
  private drainScheduled = false
  private nextOrder = 0

  constructor(private readonly maxConcurrency = 2) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new RangeError('PDF render concurrency must be a positive integer')
    }
  }

  schedule(page: number, priority: number, run: () => Promise<void>): Promise<void> {
    const existing = this.jobs.get(page)
    if (existing) {
      if (existing.state === 'queued') {
        existing.priority = priority
      }
      return existing.promise
    }

    let resolve!: () => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const job: PdfPageRenderJob = {
      order: this.nextOrder,
      page,
      priority,
      promise,
      reject,
      resolve,
      run,
      state: 'queued',
    }
    this.nextOrder += 1
    this.jobs.set(page, job)
    this.scheduleDrain()
    return promise
  }

  cancelPending(page: number): boolean {
    const job = this.jobs.get(page)
    if (!job || job.state !== 'queued') {
      return false
    }

    this.jobs.delete(page)
    job.resolve()
    return true
  }

  cancelAllPending(): void {
    for (const job of [...this.jobs.values()]) {
      if (job.state !== 'queued') {
        continue
      }

      this.jobs.delete(job.page)
      job.resolve()
    }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return
    }

    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drain()
    })
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency) {
      const job = this.nextQueuedJob()
      if (!job) {
        return
      }

      job.state = 'running'
      this.activeCount += 1
      void this.run(job)
    }
  }

  private nextQueuedJob(): PdfPageRenderJob | undefined {
    return [...this.jobs.values()]
      .filter(job => job.state === 'queued')
      .sort((left, right) => left.priority - right.priority || left.order - right.order)[0]
  }

  private async run(job: PdfPageRenderJob): Promise<void> {
    try {
      await job.run()
      job.resolve()
    }
    catch (reason) {
      job.reject(reason)
    }
    finally {
      if (this.jobs.get(job.page) === job) {
        this.jobs.delete(job.page)
      }
      this.activeCount -= 1
      this.drain()
    }
  }
}

function finiteOrFallback(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
