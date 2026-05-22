import { describe, expect, it } from 'vitest'

import { enhanceCollapsibleHeadings } from '@/features/reader/collapsibleHeadings'

describe('collapsible H1 headings', () => {
  it('wraps H1 sibling sections without changing heading anchors', () => {
    const content = createContent(`
      <h1 id="first"><a class="header-anchor" href="#first">First</a></h1>
      <p>Intro</p>
      <h2 id="child"><a class="header-anchor" href="#child">Child</a></h2>
      <p>Child body</p>
      <h1 id="second"><a class="header-anchor" href="#second">Second</a></h1>
      <p>Second body</p>
    `)

    const cleanup = enhanceCollapsibleHeadings(content)
    const rows = content.querySelectorAll('.reader-heading-row')
    const sections = content.querySelectorAll<HTMLDivElement>('.reader-section')
    const buttons = content.querySelectorAll<HTMLButtonElement>('[data-reader-heading-toggle]')

    expect(rows).toHaveLength(2)
    expect(sections).toHaveLength(2)
    expect(buttons).toHaveLength(2)
    expect(content.querySelector<HTMLAnchorElement>('h1 a.header-anchor')?.href).toContain('#first')
    expect(sections[0]?.textContent).toContain('Intro')
    expect(sections[0]?.textContent).toContain('Child')
    expect(sections[0]?.textContent).not.toContain('Second body')
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(buttons[0]?.getAttribute('aria-controls')).toBe(sections[0]?.id)

    cleanup()

    expect(content.querySelectorAll('.reader-heading-row')).toHaveLength(0)
    expect(content.querySelectorAll('.reader-section')).toHaveLength(0)
    expect(content.querySelectorAll('h1')).toHaveLength(2)
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
