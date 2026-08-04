import { describe, expect, it } from 'vitest'

import { enhanceMarkdownCodeBlocks } from '@/features/reader/markdownCodeHighlighting'

describe('progressive Markdown code highlighting', () => {
  it('upgrades only code blocks and preserves surrounding reader nodes', async () => {
    const content = document.createElement('div')
    content.innerHTML = '<h1>Keep me</h1><ul><li>Stable list</li></ul><pre><code class="language-ts">const answer = 42\n</code></pre>'
    document.body.append(content)
    const heading = content.querySelector('h1')
    const list = content.querySelector('ul')

    await expect(enhanceMarkdownCodeBlocks(content)).resolves.toBe(true)

    expect(content.querySelector('h1')).toBe(heading)
    expect(content.querySelector('ul')).toBe(list)
    expect(content.querySelector('pre.shiki')).not.toBeNull()
    expect(content.textContent).toContain('const answer = 42')
    content.remove()
  })

  it('leaves stale reader content untouched', async () => {
    const content = document.createElement('div')
    content.innerHTML = '<pre><code class="language-ts">const stale = true\n</code></pre>'
    document.body.append(content)

    await expect(enhanceMarkdownCodeBlocks(content, { isCurrent: () => false })).resolves.toBe(false)

    expect(content.querySelector('pre.shiki')).toBeNull()
    content.remove()
  })
})
