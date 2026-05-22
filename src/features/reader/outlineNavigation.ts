export const MIN_OUTLINE_HEADING_COUNT = 4

export type OutlineHeadingLevel = 1 | 2 | 3

export interface ReaderOutlineItem {
  id: string
  level: OutlineHeadingLevel
  title: string
}

const outlineHeadingSelector = 'h1[id], h2[id], h3[id]'

export function collectOutlineItems(content: HTMLElement): ReaderOutlineItem[] {
  const items = Array.from(content.querySelectorAll<HTMLHeadingElement>(outlineHeadingSelector))
    .map(toOutlineItem)
    .filter((item): item is ReaderOutlineItem => item !== null)

  return items.length >= MIN_OUTLINE_HEADING_COUNT ? items : []
}

function toOutlineItem(heading: HTMLHeadingElement): ReaderOutlineItem | null {
  const id = heading.id.trim()
  const title = heading.textContent?.replace(/\s+/g, ' ').trim()
  const level = Number(heading.tagName.slice(1))

  if (!id || !title || !isOutlineHeadingLevel(level)) {
    return null
  }

  return { id, level, title }
}

function isOutlineHeadingLevel(level: number): level is OutlineHeadingLevel {
  return level === 1 || level === 2 || level === 3
}
