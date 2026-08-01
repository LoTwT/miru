import { describe, expect, it } from 'vitest'

import {
  createPdfSearchPageIndex,
  findPdfSearchMatches,
} from '@/features/reader/pdfSearchIndex'

describe('PDF search indexing', () => {
  it('stores text span offsets compactly and maps repeated matches in order', () => {
    const page = createPdfSearchPageIndex(7, [
      { text: 'Alpha' },
      { text: 'beta', hasEOL: true },
      { text: 'ALPHA' },
    ])

    expect(page.spanStarts).toBeInstanceOf(Uint32Array)
    expect(page.spanEnds).toBeInstanceOf(Uint32Array)
    expect([...page.spanStarts]).toEqual([0, 6, 11])
    expect([...page.spanEnds]).toEqual([5, 10, 16])
    expect(findPdfSearchMatches(page, 'alpha')).toEqual([
      {
        id: '7:0:0',
        pageNumber: 7,
        spanRanges: [{ end: 5, spanIndex: 0, start: 0 }],
      },
      {
        id: '7:11:1',
        pageNumber: 7,
        spanRanges: [{ end: 5, spanIndex: 2, start: 0 }],
      },
    ])
  })

  it('maps a match across adjacent PDF text spans without rescanning earlier spans', () => {
    const page = createPdfSearchPageIndex(3, [
      { text: 'quiet' },
      { text: 'reading' },
      { text: 'quiet' },
    ])

    expect(findPdfSearchMatches(page, 'quiet reading')[0]?.spanRanges).toEqual([
      { end: 5, spanIndex: 0, start: 0 },
      { end: 7, spanIndex: 1, start: 0 },
    ])
  })
})
