import { describe, expect, it } from 'vitest'

import { renderMarkdown } from '@/lib/markdown/renderer'

describe('markdown renderer security baseline', () => {
  it('does not execute raw html from markdown source', async () => {
    const html = await renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>')

    expect(html.value).not.toContain('<script')
    expect(html.value).not.toContain('<img')
    expect(html.value).toContain('&lt;script&gt;')
  })

  it('blocks unsafe link schemes', async () => {
    const html = await renderMarkdown('[bad](javascript:alert(1))')

    expect(html.value).not.toContain('href="javascript:')
    expect(html.value).toContain('[bad](javascript:alert(1))')
  })

  it('renders remote images with hardened attributes', async () => {
    const html = await renderMarkdown('![diagram](https://example.com/diagram.png)')

    expect(html.value).toContain('referrerpolicy="no-referrer"')
    expect(html.value).toContain('loading="lazy"')
    expect(html.value).toContain('decoding="async"')
  })
})
