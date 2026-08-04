export function getBufferedPdfPages(options: {
  anchorPages: Iterable<number>
  fallbackPage: number
  radius?: number
  totalPages: number
}): Set<number> {
  const totalPages = Math.max(0, Math.trunc(options.totalPages))
  if (totalPages === 0) {
    return new Set()
  }

  const anchors = [...options.anchorPages]
    .filter(page => Number.isFinite(page))
    .map(page => clampPage(page, totalPages))
  const pages = new Set<number>()
  const radius = Math.max(0, Math.trunc(options.radius ?? 2))

  for (const anchor of anchors.length > 0 ? anchors : [clampPage(options.fallbackPage, totalPages)]) {
    for (let offset = -radius; offset <= radius; offset += 1) {
      pages.add(clampPage(anchor + offset, totalPages))
    }
  }

  return pages
}

export function getDominantPdfPage(visibleAreas: Iterable<readonly [number, number]>): number | null {
  let dominantPage: number | null = null
  let largestArea = 0

  for (const [page, area] of visibleAreas) {
    if (!Number.isFinite(page) || !Number.isFinite(area) || area <= largestArea) {
      continue
    }

    dominantPage = Math.trunc(page)
    largestArea = area
  }

  return dominantPage
}

export function prioritizePdfPages(options: {
  focusPage: number
  pages: Iterable<number>
  visibleAreas: ReadonlyMap<number, number>
}): number[] {
  const focusPage = Math.trunc(options.focusPage)

  return [...new Set(options.pages)]
    .filter(page => Number.isFinite(page))
    .sort((left, right) => {
      const leftArea = Math.max(0, options.visibleAreas.get(left) ?? 0)
      const rightArea = Math.max(0, options.visibleAreas.get(right) ?? 0)
      const leftVisible = leftArea > 0
      const rightVisible = rightArea > 0

      if (leftVisible !== rightVisible) {
        return leftVisible ? -1 : 1
      }
      if (leftVisible && rightVisible && leftArea !== rightArea) {
        return rightArea - leftArea
      }

      return Math.abs(left - focusPage) - Math.abs(right - focusPage) || left - right
    })
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(totalPages, Math.max(1, Math.trunc(page)))
}
