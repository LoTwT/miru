import { describe, expect, it } from 'vitest'

import {
  defaultPdfCanvasDimensionLimit,
  defaultPdfCanvasPixelBudget,
  getPdfCanvasMetrics,
  PdfPageRenderQueue,
} from '@/features/reader/pdfRenderBudget'

describe('PDF canvas budget', () => {
  it('preserves the requested device scale while it fits the budget', () => {
    expect(getPdfCanvasMetrics({
      cssHeight: 800,
      cssWidth: 1_000,
      devicePixelRatio: 2,
    })).toEqual({
      height: 1_600,
      scale: 2,
      width: 2_000,
    })
  })

  it('caps oversized canvases by pixels and browser-safe dimensions', () => {
    const metrics = getPdfCanvasMetrics({
      cssHeight: 10_000,
      cssWidth: 5_000,
      devicePixelRatio: 3,
    })

    expect(metrics.width * metrics.height).toBeLessThanOrEqual(defaultPdfCanvasPixelBudget)
    expect(metrics.width).toBeLessThanOrEqual(defaultPdfCanvasDimensionLimit)
    expect(metrics.height).toBeLessThanOrEqual(defaultPdfCanvasDimensionLimit)
    expect(metrics.scale).toBeLessThan(1)
  })
})

describe('PDF page render queue', () => {
  it('limits concurrent work and starts queued pages by priority', async () => {
    const queue = new PdfPageRenderQueue(2)
    const started: number[] = []
    const releases = new Map<number, () => void>()
    const run = (page: number) => async () => {
      started.push(page)
      await new Promise<void>((resolve) => {
        releases.set(page, resolve)
      })
    }

    const pageOne = queue.schedule(1, 10, run(1))
    const pageTwo = queue.schedule(2, 0, run(2))
    const pageThree = queue.schedule(3, 5, run(3))
    await Promise.resolve()

    expect(started).toEqual([2, 3])
    releases.get(2)?.()
    await pageTwo
    await Promise.resolve()
    expect(started).toEqual([2, 3, 1])

    releases.get(3)?.()
    releases.get(1)?.()
    await Promise.all([pageOne, pageThree])
  })

  it('deduplicates pages and lets pending work be canceled', async () => {
    const queue = new PdfPageRenderQueue(1)
    let releaseActive!: () => void
    let duplicateRuns = 0
    const active = queue.schedule(1, 0, async () => {
      await new Promise<void>((resolve) => {
        releaseActive = resolve
      })
    })
    const firstPending = queue.schedule(2, 10, async () => {
      duplicateRuns += 1
    })
    const duplicatePending = queue.schedule(2, -10, async () => {
      duplicateRuns += 1
    })

    expect(duplicatePending).toBe(firstPending)
    expect(queue.cancelPending(2)).toBe(true)
    await firstPending
    releaseActive()
    await active
    expect(duplicateRuns).toBe(0)
  })
})
