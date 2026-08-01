import { describe, expect, it } from 'vitest'

import {
  getBufferedPdfPages,
  getDominantPdfPage,
  prioritizePdfPages,
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

  it('renders visible pages first, then nearby buffered pages', () => {
    expect(prioritizePdfPages({
      focusPage: 10,
      pages: [8, 9, 10, 11, 12],
      visibleAreas: new Map([[10, 100], [11, 400]]),
    })).toEqual([11, 10, 9, 8, 12])
  })

})
