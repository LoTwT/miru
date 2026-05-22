import { describe, expect, it } from 'vitest'

import { collectOutlineItems } from '@/features/reader/outlineNavigation'

describe('outline navigation model', () => {
  it('collects H1-H3 headings once a document is heading-rich', () => {
    const content = createContent(`
      <h1 id="intro"><a class="header-anchor" href="#intro">Intro</a></h1>
      <p>Body</p>
      <h2 id="inputs"><a class="header-anchor" href="#inputs">Inputs</a></h2>
      <h3 id="paste"><a class="header-anchor" href="#paste">Paste</a></h3>
      <h4 id="ignored"><a class="header-anchor" href="#ignored">Ignored</a></h4>
      <h1 id="privacy"><a class="header-anchor" href="#privacy">Privacy</a></h1>
    `)

    expect(collectOutlineItems(content)).toEqual([
      { id: 'intro', level: 1, title: 'Intro' },
      { id: 'inputs', level: 2, title: 'Inputs' },
      { id: 'paste', level: 3, title: 'Paste' },
      { id: 'privacy', level: 1, title: 'Privacy' },
    ])
  })

  it('returns no outline for short documents', () => {
    const content = createContent(`
      <h1 id="intro"><a class="header-anchor" href="#intro">Intro</a></h1>
      <h2 id="inputs"><a class="header-anchor" href="#inputs">Inputs</a></h2>
      <h2 id="privacy"><a class="header-anchor" href="#privacy">Privacy</a></h2>
    `)

    expect(collectOutlineItems(content)).toEqual([])
  })

  it('skips headings without ids or visible titles', () => {
    const content = createContent(`
      <h1 id="intro"><a class="header-anchor" href="#intro">Intro</a></h1>
      <h2>No id</h2>
      <h2 id="blank">   </h2>
      <h2 id="inputs"><a class="header-anchor" href="#inputs">Inputs</a></h2>
      <h3 id="paste"><a class="header-anchor" href="#paste">Paste</a></h3>
      <h1 id="privacy"><a class="header-anchor" href="#privacy">Privacy</a></h1>
    `)

    expect(collectOutlineItems(content)).toEqual([
      { id: 'intro', level: 1, title: 'Intro' },
      { id: 'inputs', level: 2, title: 'Inputs' },
      { id: 'paste', level: 3, title: 'Paste' },
      { id: 'privacy', level: 1, title: 'Privacy' },
    ])
  })
})

function createContent(html: string): HTMLElement {
  const content = document.createElement('div')
  content.className = 'reader-surface__content'
  content.innerHTML = html
  return content
}
