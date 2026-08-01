export const pdfSearchMatchClass = 'pdf-viewer__search-match'
export const activePdfSearchMatchClass = 'pdf-viewer__search-match--active'

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
