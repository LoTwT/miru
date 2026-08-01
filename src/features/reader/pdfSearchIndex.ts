export interface PdfSearchTextItem {
  hasEOL?: boolean
  text: string
}

export interface PdfSearchPageIndex {
  normalizedText: string
  pageNumber: number
  spanEnds: Uint32Array
  spanStarts: Uint32Array
}

export interface PdfSearchSpanRange {
  end: number
  spanIndex: number
  start: number
}

export interface PdfSearchMatch {
  id: string
  pageNumber: number
  spanRanges: PdfSearchSpanRange[]
}

export function createPdfSearchPageIndex(
  pageNumber: number,
  items: Iterable<PdfSearchTextItem>,
): PdfSearchPageIndex {
  const spanStarts: number[] = []
  const spanEnds: number[] = []
  let text = ''

  for (const item of items) {
    if (!item.text) {
      continue
    }

    if (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
      text += ' '
    }

    spanStarts.push(text.length)
    text += item.text
    spanEnds.push(text.length)

    if (item.hasEOL) {
      text += '\n'
    }
  }

  return {
    normalizedText: text.toLocaleLowerCase(),
    pageNumber,
    spanEnds: Uint32Array.from(spanEnds),
    spanStarts: Uint32Array.from(spanStarts),
  }
}

export function findPdfSearchMatches(page: PdfSearchPageIndex, queryLower: string): PdfSearchMatch[] {
  if (!queryLower) {
    return []
  }

  const matches: PdfSearchMatch[] = []
  let matchStart = page.normalizedText.indexOf(queryLower)
  let spanCursor = 0

  while (matchStart !== -1) {
    const matchEnd = matchStart + queryLower.length

    while (spanCursor < page.spanEnds.length && page.spanEnds[spanCursor]! <= matchStart) {
      spanCursor += 1
    }

    const spanRanges: PdfSearchSpanRange[] = []
    for (let spanIndex = spanCursor; spanIndex < page.spanStarts.length; spanIndex += 1) {
      const spanStart = page.spanStarts[spanIndex]!
      const spanEnd = page.spanEnds[spanIndex]!
      if (spanStart >= matchEnd) {
        break
      }
      if (spanEnd > matchStart) {
        spanRanges.push({
          end: Math.min(spanEnd, matchEnd) - spanStart,
          spanIndex,
          start: Math.max(spanStart, matchStart) - spanStart,
        })
      }
    }

    if (spanRanges.length > 0) {
      matches.push({
        id: `${page.pageNumber}:${matchStart}:${matches.length}`,
        pageNumber: page.pageNumber,
        spanRanges,
      })
    }

    matchStart = page.normalizedText.indexOf(queryLower, Math.max(matchEnd, matchStart + 1))
  }

  return matches
}
