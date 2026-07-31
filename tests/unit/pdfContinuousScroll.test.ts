import { describe, expect, it } from 'vitest'

import {
  getBufferedPdfPages,
  getDominantPdfPage,
  getPdfPageMeasurementOrder,
} from '@/features/reader/pdfContinuousScroll'

describe('PDF continuous-scroll planning', () => {
  it('buffers only the pages around observed anchors', () => {
    expect([...getBufferedPdfPages({
      anchorPages: [50, 51],
      fallbackPage: 1,
      totalPages: 200,
    })]).toEqual([48, 49, 50, 51, 52, 53])
  })

  it('clamps fallback buffers at document boundaries', () => {
    expect([...getBufferedPdfPages({
      anchorPages: [],
      fallbackPage: 200,
      totalPages: 200,
    })]).toEqual([198, 199, 200])
  })

  it('uses observer-provided visible area to select the dominant page', () => {
    expect(getDominantPdfPage([[7, 120], [8, 480], [9, 80]])).toBe(8)
    expect(getDominantPdfPage([[7, 0], [8, Number.NaN]])).toBeNull()
  })

  it('measures the anchor vicinity first without repeating the first page', () => {
    const order = getPdfPageMeasurementOrder(8, 6)

    expect(order.slice(0, 5)).toEqual([6, 5, 7, 4, 8])
    expect(order).toHaveLength(7)
    expect(new Set(order).size).toBe(7)
    expect(order).not.toContain(1)
  })
})
