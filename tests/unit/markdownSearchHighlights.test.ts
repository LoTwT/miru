import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearMarkdownSearchHighlights,
  highlightMarkdownSearchMatches,
  updateActiveMarkdownSearchMatch,
} from '@/features/reader/markdownSearchHighlights'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Markdown search highlights', () => {
  it('highlights readable text while skipping interactive content', () => {
    const content = document.createElement('div')
    content.innerHTML = '<p>Alpha and alpha.</p><button>Alpha action</button><svg><text>Alpha icon</text></svg>'

    const matches = highlightMarkdownSearchMatches(content, 'alpha')

    expect(matches).toHaveLength(2)
    expect(matches.map(match => match.textContent)).toEqual(['Alpha', 'alpha'])
    expect(content.querySelector('button mark')).toBeNull()
    expect(content.querySelector('svg mark')).toBeNull()
  })

  it('normalizes each affected parent only once when clearing many matches', () => {
    const content = document.createElement('div')
    content.innerHTML = '<p>alpha alpha alpha alpha</p><p>alpha alpha</p>'
    highlightMarkdownSearchMatches(content, 'alpha')
    const normalize = vi.spyOn(Node.prototype, 'normalize')

    clearMarkdownSearchHighlights(content)

    expect(normalize).toHaveBeenCalledTimes(2)
    expect(content.querySelectorAll('.reader-search-match')).toHaveLength(0)
    expect([...content.querySelectorAll('p')].map(paragraph => paragraph.childNodes.length)).toEqual([1, 1])
  })

  it('updates only the previous and next active matches', () => {
    const content = document.createElement('div')
    content.innerHTML = '<p>alpha alpha alpha</p>'
    const matches = highlightMarkdownSearchMatches(content, 'alpha')

    updateActiveMarkdownSearchMatch(matches, -1, 0)
    updateActiveMarkdownSearchMatch(matches, 0, 2)

    expect(matches.map(match => match.classList.contains('reader-search-match--active'))).toEqual([false, false, true])
  })
})
