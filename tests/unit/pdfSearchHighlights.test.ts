import { describe, expect, it } from 'vitest'

import {
  activePdfSearchMatchClass,
  pdfSearchMatchClass,
  updateActivePdfSearchHighlight,
} from '@/features/reader/pdfSearchHighlights'

describe('PDF search highlights', () => {
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
