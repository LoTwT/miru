import { bench } from 'vitest'

import {
  clearMarkdownSearchHighlights,
  highlightMarkdownSearchMatches,
} from '@/features/reader/markdownSearchHighlights'
import { getPdfCanvasMetrics } from '@/features/reader/pdfRenderBudget'
import { createPdfSearchPageIndex, findPdfSearchMatches } from '@/features/reader/pdfSearchIndex'

const markdownParagraphCount = 1_024
const markdownSearchContent = createMarkdownSearchContent()
const pdfPageItems = createPdfPageItems()
const canvasPageSizes = createCanvasPageSizes()
let benchmarkSink = 0

bench('highlight and clear about 1 MiB of Markdown text', () => {
  const matches = highlightMarkdownSearchMatches(markdownSearchContent, 'needle')
  benchmarkSink = matches.length
  clearMarkdownSearchHighlights(markdownSearchContent)
}, {
  iterations: 3,
  time: 250,
  warmupIterations: 1,
  warmupTime: 50,
})

bench('find a distant result across 120 PDF pages', () => {
  let matchedPage = 0

  for (const [index, items] of pdfPageItems.entries()) {
    const page = createPdfSearchPageIndex(index + 1, items)
    if (findPdfSearchMatches(page, 'distant-page-marker').length > 0) {
      matchedPage = page.pageNumber
      break
    }
  }

  benchmarkSink = matchedPage
}, {
  iterations: 10,
  time: 250,
  warmupIterations: 2,
  warmupTime: 50,
})

bench('calculate capped canvas metrics for 120 PDF pages', () => {
  let peakPixels = 0

  for (const page of canvasPageSizes) {
    const metrics = getPdfCanvasMetrics({
      cssHeight: page.height,
      cssWidth: page.width,
      devicePixelRatio: 3,
    })
    peakPixels = Math.max(peakPixels, metrics.width * metrics.height)
  }

  benchmarkSink = peakPixels
}, {
  iterations: 20,
  time: 250,
  warmupIterations: 3,
  warmupTime: 50,
})

function createMarkdownSearchContent(): HTMLElement {
  const content = document.createElement('article')
  const text = `${'quiet '.repeat(80)}needle ${'reading '.repeat(64)}`

  for (let index = 0; index < markdownParagraphCount; index += 1) {
    const paragraph = document.createElement('p')
    paragraph.textContent = `${index} ${text}`
    content.append(paragraph)
  }

  return content
}

function createPdfPageItems() {
  return Array.from({ length: 120 }, (_, pageIndex) => (
    Array.from({ length: 32 }, (_, spanIndex) => ({
      hasEOL: spanIndex === 31,
      text: pageIndex === 116 && spanIndex === 20
        ? 'distant-page-marker'
        : `page-${pageIndex + 1}-span-${spanIndex + 1}`,
    }))
  ))
}

function createCanvasPageSizes() {
  return Array.from({ length: 120 }, (_, index) => ({
    height: index % 9 === 0 ? 1_440 : 792,
    width: index % 7 === 0 ? 1_920 : 612,
  }))
}
