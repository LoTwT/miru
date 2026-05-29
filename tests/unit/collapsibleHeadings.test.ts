import { describe, expect, it } from 'vitest'

import { enhanceCollapsibleHeadings } from '@/features/reader/collapsibleHeadings'

describe('collapsible headings', () => {
  it('wraps H1-H3 sibling sections without changing heading anchors', () => {
    const content = createContent(`
      <h1 id="first"><a class="header-anchor" href="#first">First</a></h1>
      <p>Intro</p>
      <h2 id="child"><a class="header-anchor" href="#child">Child</a></h2>
      <p>Child body</p>
      <h3 id="detail"><a class="header-anchor" href="#detail">Detail</a></h3>
      <p>Detail body</p>
      <h1 id="second"><a class="header-anchor" href="#second">Second</a></h1>
      <p>Second body</p>
    `)

    const cleanup = enhanceCollapsibleHeadings(content)
    const rows = content.querySelectorAll('.reader-heading-row')
    const sections = content.querySelectorAll<HTMLDivElement>('.reader-section')
    const buttons = content.querySelectorAll<HTMLButtonElement>('[data-reader-heading-toggle]')

    expect(rows).toHaveLength(4)
    expect(sections).toHaveLength(4)
    expect(buttons).toHaveLength(4)
    expect(content.querySelector<HTMLAnchorElement>('h1 a.header-anchor')?.href).toContain('#first')
    expect(content.querySelector<HTMLAnchorElement>('h2 a.header-anchor')?.href).toContain('#child')
    expect(content.querySelector<HTMLAnchorElement>('h3 a.header-anchor')?.href).toContain('#detail')
    expect(sections[0]?.textContent).toContain('Intro')
    expect(sections[0]?.textContent).toContain('Child')
    expect(sections[0]?.textContent).not.toContain('Second body')
    expect(sections[1]?.textContent).toContain('Child body')
    expect(sections[1]?.textContent).toContain('Detail')
    expect(sections[1]?.textContent).not.toContain('Second body')
    expect(sections[2]?.textContent).toContain('Detail body')
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(buttons[0]?.getAttribute('aria-controls')).toBe(sections[0]?.id)
    expect(buttons[1]?.dataset.readerHeadingLevel).toBe('2')
    expect(buttons[2]?.dataset.readerHeadingLevel).toBe('3')

    cleanup()

    expect(content.querySelectorAll('.reader-heading-row')).toHaveLength(0)
    expect(content.querySelectorAll('.reader-section')).toHaveLength(0)
    expect(content.querySelectorAll('h1')).toHaveLength(2)
    expect(content.querySelectorAll('h2')).toHaveLength(1)
    expect(content.querySelectorAll('h3')).toHaveLength(1)
  })

  it('toggles only the controlled section', () => {
    const content = createContent(`
      <h1 id="first"><a class="header-anchor" href="#first">First</a></h1>
      <p>Intro</p>
      <h1 id="second"><a class="header-anchor" href="#second">Second</a></h1>
      <p>Second body</p>
    `)

    enhanceCollapsibleHeadings(content)

    const buttons = content.querySelectorAll<HTMLButtonElement>('[data-reader-heading-toggle]')
    const sections = content.querySelectorAll<HTMLDivElement>('.reader-section')

    buttons[0]?.click()

    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('false')
    expect(buttons[0]?.getAttribute('aria-label')).toContain('展开')
    expect(sections[0]?.hidden).toBe(true)
    expect(sections[1]?.hidden).toBe(false)

    buttons[0]?.click()

    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(sections[0]?.hidden).toBe(false)
  })

  it('collapses nested sections independently from their parent section', () => {
    const content = createContent(`
      <h1 id="first"><a class="header-anchor" href="#first">First</a></h1>
      <p>Intro</p>
      <h2 id="child"><a class="header-anchor" href="#child">Child</a></h2>
      <p>Child body</p>
      <h3 id="detail"><a class="header-anchor" href="#detail">Detail</a></h3>
      <p>Detail body</p>
      <h2 id="next"><a class="header-anchor" href="#next">Next child</a></h2>
      <p>Next body</p>
    `)

    enhanceCollapsibleHeadings(content)

    const childToggle = Array.from(content.querySelectorAll<HTMLButtonElement>('[data-reader-heading-toggle]'))
      .find(button => button.textContent === '' && button.getAttribute('aria-label')?.includes('Child'))
    const childSection = childToggle
      ?.closest('.reader-heading-row')
      ?.nextElementSibling as HTMLDivElement | null

    childToggle?.click()

    expect(childToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(childSection?.hidden).toBe(true)
    expect(childSection?.textContent).toContain('Child body')
    expect(childSection?.textContent).toContain('Detail')
    expect(childSection?.textContent).not.toContain('Next body')
    expect(content.textContent).toContain('Intro')
    expect(content.textContent).toContain('Next body')
  })

  it('does not add empty controls to heading-only documents', () => {
    const content = createContent('<h1 id="empty"><a class="header-anchor" href="#empty">Empty</a></h1>')

    enhanceCollapsibleHeadings(content)

    expect(content.querySelector('[data-reader-heading-toggle]')).toBeNull()
    expect(content.querySelector('.reader-section')).toBeNull()
  })
})

function createContent(html: string): HTMLElement {
  const content = document.createElement('div')
  content.className = 'reader-surface__content'
  content.innerHTML = html
  return content
}
