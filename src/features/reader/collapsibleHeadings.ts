const collapsibleHeadingSelector = ':scope > h1'

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
  const headings = Array.from(content.querySelectorAll<HTMLHeadingElement>(collapsibleHeadingSelector))

  headings.forEach((heading, index) => {
    const sectionNodes = collectSectionNodes(heading)

    if (sectionNodes.length === 0) {
      return
    }

    const row = document.createElement('div')
    row.className = 'reader-heading-row'
    row.dataset.readerHeadingRow = ''

    const section = document.createElement('div')
    section.className = 'reader-section'
    section.id = `reader-section-${index + 1}`
    section.dataset.readerSection = ''

    const title = normalizeHeadingTitle(heading)
    const button = createToggleButton(title, section.id)

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
  })

  return () => cleanupCollapsibleHeadings(records)
}

function collectSectionNodes(heading: HTMLHeadingElement): Element[] {
  const nodes: Element[] = []
  let sibling = heading.nextElementSibling

  while (sibling && sibling.tagName !== 'H1') {
    nodes.push(sibling)
    sibling = sibling.nextElementSibling
  }

  return nodes
}

function createToggleButton(title: string, sectionId: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'reader-heading-toggle'
  button.dataset.readerHeadingToggle = ''
  button.setAttribute('aria-controls', sectionId)
  setExpanded(button, null, title, true)

  button.innerHTML = [
    '<svg class="reader-heading-toggle__icon" viewBox="0 0 10 10" aria-hidden="true" focusable="false">',
    '<path d="M2 3.25 5 6.75 8 3.25Z" />',
    '</svg>',
  ].join('')

  return button
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
