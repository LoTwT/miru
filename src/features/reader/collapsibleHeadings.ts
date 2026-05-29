const collapsibleHeadingSelector = ':scope > h1, :scope > h2, :scope > h3'
const maxCollapsibleHeadingLevel = 3

interface CollapsibleHeadingRecord {
  button: HTMLButtonElement
  onClick: () => void
  row: HTMLDivElement
  section: HTMLDivElement
  heading: HTMLHeadingElement
}

export function enhanceCollapsibleHeadings(content: HTMLElement): () => void {
  if (content.querySelector('[data-reader-heading-toggle]')) {
    return () => {}
  }

  const records: CollapsibleHeadingRecord[] = []
  enhanceHeadingContainer(content, records)

  return () => cleanupCollapsibleHeadings(records)
}

function enhanceHeadingContainer(container: HTMLElement, records: CollapsibleHeadingRecord[]): void {
  const directHeadings = Array.from(container.querySelectorAll<HTMLHeadingElement>(collapsibleHeadingSelector))
    .filter(heading => heading.parentElement === container)
  const levels = directHeadings
    .map(heading => getHeadingLevel(heading))
    .filter((level): level is number => level !== null && level <= maxCollapsibleHeadingLevel)

  if (levels.length === 0) {
    return
  }

  const currentLevel = Math.min(...levels)
  const headings = directHeadings.filter(heading => getHeadingLevel(heading) === currentLevel)

  headings.forEach((heading) => {
    const sectionNodes = collectSectionNodes(heading, currentLevel)

    if (sectionNodes.length === 0) {
      return
    }

    const row = document.createElement('div')
    row.className = 'reader-heading-row'
    row.dataset.readerHeadingRow = ''
    row.dataset.readerHeadingLevel = String(currentLevel)

    const section = document.createElement('div')
    section.className = 'reader-section'
    section.id = `reader-section-${records.length + 1}`
    section.dataset.readerSection = ''
    section.dataset.readerHeadingLevel = String(currentLevel)

    const title = normalizeHeadingTitle(heading)
    const button = createToggleButton(title, section.id, currentLevel)

    heading.before(row)
    row.append(button, heading)
    sectionNodes[0]?.before(section)

    for (const node of sectionNodes) {
      section.append(node)
    }

    const onClick = () => {
      const isExpanded = button.getAttribute('aria-expanded') === 'true'
      setExpanded(button, section, title, !isExpanded)
    }

    button.addEventListener('click', onClick)
    records.push({ button, onClick, row, section, heading })
    enhanceHeadingContainer(section, records)
  })
}

function collectSectionNodes(heading: HTMLHeadingElement, level: number): Element[] {
  const nodes: Element[] = []
  let sibling = heading.nextElementSibling

  while (sibling) {
    const siblingLevel = getHeadingLevel(sibling)

    if (siblingLevel !== null && siblingLevel <= level) {
      break
    }

    nodes.push(sibling)
    sibling = sibling.nextElementSibling
  }

  return nodes
}

function createToggleButton(title: string, sectionId: string, level: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'reader-heading-toggle'
  button.dataset.readerHeadingToggle = ''
  button.dataset.readerHeadingLevel = String(level)
  button.setAttribute('aria-controls', sectionId)
  setExpanded(button, null, title, true)

  button.innerHTML = [
    '<svg class="reader-heading-toggle__icon" viewBox="0 0 10 10" aria-hidden="true" focusable="false">',
    '<path d="M2 3.25 5 6.75 8 3.25Z" />',
    '</svg>',
  ].join('')

  return button
}

function getHeadingLevel(element: Element): number | null {
  const match = /^H([1-6])$/.exec(element.tagName)
  return match ? Number(match[1]) : null
}

function setExpanded(
  button: HTMLButtonElement,
  section: HTMLDivElement | null,
  title: string,
  isExpanded: boolean,
): void {
  button.setAttribute('aria-expanded', String(isExpanded))
  button.setAttribute('aria-label', `${isExpanded ? '折叠' : '展开'}「${title}」章节`)

  if (section) {
    section.hidden = !isExpanded
  }
}

function normalizeHeadingTitle(heading: HTMLHeadingElement): string {
  return heading.textContent?.replace(/\s+/g, ' ').trim() || '当前'
}

function cleanupCollapsibleHeadings(records: CollapsibleHeadingRecord[]): void {
  for (const { button, onClick, row, section, heading } of records) {
    button.removeEventListener('click', onClick)

    if (row.parentNode) {
      row.parentNode.insertBefore(heading, row)
      row.remove()
    }

    if (section.parentNode) {
      for (const child of Array.from(section.childNodes)) {
        section.parentNode.insertBefore(child, section)
      }
      section.remove()
    }
  }
}
