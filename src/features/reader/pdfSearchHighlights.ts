import type { PdfSearchMatch } from './pdfSearchIndex'

export const pdfSearchMatchClass = 'pdf-viewer__search-match'
export const activePdfSearchMatchClass = 'pdf-viewer__search-match--active'

interface RenderPdfSearchHighlightsOptions {
  activeMatchId: string | undefined
  container: HTMLElement
  matches: readonly PdfSearchMatch[]
  textDivs: readonly HTMLElement[]
}

export function renderPdfSearchHighlights(options: RenderPdfSearchHighlightsOptions): void {
  const {
    activeMatchId,
    container,
    matches,
    textDivs,
  } = options

  container
    .querySelectorAll(`.${pdfSearchMatchClass}`)
    .forEach(marker => marker.remove())
  container.removeAttribute('data-pdf-has-highlight')

  for (const textDiv of textDivs) {
    delete textDiv.dataset.pdfSearchMatch
  }

  const containerRect = container.getBoundingClientRect()
  for (const match of matches) {
    for (const spanRange of match.spanRanges) {
      const textDiv = textDivs[spanRange.spanIndex]
      if (!textDiv) {
        continue
      }

      textDiv.dataset.pdfSearchMatch = match.id
      const textNode = textDiv.firstChild
      if (!(textNode instanceof Text) || spanRange.start >= spanRange.end) {
        continue
      }

      const range = container.ownerDocument.createRange()
      range.setStart(textNode, Math.min(spanRange.start, textNode.length))
      range.setEnd(textNode, Math.min(spanRange.end, textNode.length))

      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) {
          continue
        }

        const marker = container.ownerDocument.createElement('span')
        marker.classList.add(pdfSearchMatchClass)
        marker.classList.toggle(activePdfSearchMatchClass, activeMatchId === match.id)
        marker.dataset.pdfSearchMatch = match.id
        marker.style.inlineSize = `${rect.width}px`
        marker.style.blockSize = `${rect.height}px`
        marker.style.insetInlineStart = `${rect.left - containerRect.left}px`
        marker.style.insetBlockStart = `${rect.top - containerRect.top}px`
        container.append(marker)
      }

      range.detach()
    }
  }

  if (container.querySelector(`.${pdfSearchMatchClass}`)) {
    container.dataset.pdfHasHighlight = 'true'
  }
}

export function updateActivePdfSearchHighlight(
  container: HTMLElement,
  activeMatchId: string | undefined,
): void {
  for (const marker of container.querySelectorAll<HTMLElement>(`.${pdfSearchMatchClass}`)) {
    marker.classList.toggle(
      activePdfSearchMatchClass,
      marker.dataset.pdfSearchMatch === activeMatchId,
    )
  }
}

export function findActivePdfSearchHighlight(
  container: HTMLElement,
  matchId: string,
): HTMLElement | null {
  for (const marker of container.querySelectorAll<HTMLElement>(`.${activePdfSearchMatchClass}`)) {
    if (marker.dataset.pdfSearchMatch === matchId) {
      return marker
    }
  }

  return null
}
