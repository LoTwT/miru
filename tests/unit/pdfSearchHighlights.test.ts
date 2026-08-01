import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  activePdfSearchMatchClass,
  findActivePdfSearchHighlight,
  pdfSearchMatchClass,
  renderPdfSearchHighlights,
  updateActivePdfSearchHighlight,
} from '@/features/reader/pdfSearchHighlights'

describe('PDF search highlights', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders match geometry and clears stale marker state', () => {
    const container = document.createElement('div')
    const textDiv = document.createElement('span')
    const staleMarker = createMarker('stale', true)
    textDiv.append(document.createTextNode('Daily Paper'))
    container.append(textDiv, staleMarker)
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(createRect({ left: 10, top: 20 }))
    vi.spyOn(document, 'createRange').mockReturnValue({
      detach: vi.fn(),
      getClientRects: () => [createRect({ height: 12, left: 25, top: 32, width: 40 })],
      setEnd: vi.fn(),
      setStart: vi.fn(),
    } as unknown as Range)

    renderPdfSearchHighlights({
      activeMatchId: '1:0:0',
      container,
      matches: [{
        id: '1:0:0',
        pageNumber: 1,
        spanRanges: [{ end: 5, spanIndex: 0, start: 0 }],
      }],
      textDivs: [textDiv],
    })

    const marker = findActivePdfSearchHighlight(container, '1:0:0')
    expect(staleMarker.isConnected).toBe(false)
    expect(marker?.style.inlineSize).toBe('40px')
    expect(marker?.style.blockSize).toBe('12px')
    expect(marker?.style.insetInlineStart).toBe('15px')
    expect(marker?.style.insetBlockStart).toBe('12px')
    expect(textDiv.dataset.pdfSearchMatch).toBe('1:0:0')
    expect(container.dataset.pdfHasHighlight).toBe('true')

    renderPdfSearchHighlights({
      activeMatchId: undefined,
      container,
      matches: [],
      textDivs: [textDiv],
    })

    expect(container.querySelector(`.${pdfSearchMatchClass}`)).toBeNull()
    expect(textDiv.dataset.pdfSearchMatch).toBeUndefined()
    expect(container.dataset.pdfHasHighlight).toBeUndefined()
  })

  it('updates the active result without replacing rendered markers', () => {
    const container = document.createElement('div')
    const firstMarker = createMarker('1:0:0', true)
    const secondMarker = createMarker('1:12:1')
    const secondMarkerFragment = createMarker('1:12:1')
    container.append(firstMarker, secondMarker, secondMarkerFragment)

    updateActivePdfSearchHighlight(container, '1:12:1')

    expect([...container.children]).toEqual([
      firstMarker,
      secondMarker,
      secondMarkerFragment,
    ])
    expect(firstMarker.classList.contains(activePdfSearchMatchClass)).toBe(false)
    expect(secondMarker.classList.contains(activePdfSearchMatchClass)).toBe(true)
    expect(secondMarkerFragment.classList.contains(activePdfSearchMatchClass)).toBe(true)
  })
})

function createMarker(matchId: string, active = false): HTMLSpanElement {
  const marker = document.createElement('span')
  marker.classList.add(pdfSearchMatchClass)
  marker.classList.toggle(activePdfSearchMatchClass, active)
  marker.dataset.pdfSearchMatch = matchId
  return marker
}

function createRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...overrides,
  }
}
