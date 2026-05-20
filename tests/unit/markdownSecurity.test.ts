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

  it('does not turn image-only schemes into links', async () => {
    const html = await renderMarkdown('[data link](data:image/png;base64,iVBORw0KGgo=)')

    expect(html.value).not.toContain('<a')
    expect(html.value).not.toContain('</a>')
    expect(html.value).toContain('data link')
  })

  it('renders remote images with hardened attributes', async () => {
    const html = await renderMarkdown('![diagram](https://example.com/diagram.png)')

    expect(html.value).toContain('<img src="https://example.com/diagram.png"')
    expect(html.value).toContain('referrerpolicy="no-referrer"')
    expect(html.value).toContain('loading="lazy"')
    expect(html.value).toContain('decoding="async"')
  })

  it('blocks remote images when the renderer is in block mode', async () => {
    const html = await renderMarkdown('![diagram](https://example.com/diagram.png)', {
      remoteImageMode: 'block',
    })

    expect(html.value).not.toContain('<img')
    expect(html.value).not.toContain('src="https://example.com/diagram.png"')
    expect(html.value).toContain('远程图片已屏蔽')
  })

  it('treats protocol-relative images as remote images', async () => {
    const html = await renderMarkdown('![diagram](//example.com/diagram.png)', {
      remoteImageMode: 'block',
    })

    expect(html.value).not.toContain('<img')
    expect(html.value).toContain('远程图片已屏蔽')
  })

  it('keeps local images visible when remote images are blocked or prompted', async () => {
    for (const remoteImageMode of ['block', 'prompt'] as const) {
      const html = await renderMarkdown([
        '![data](data:image/png;base64,iVBORw0KGgo=)',
        '![blob](blob:https://example.com/asset)',
        '![relative](./asset.png)',
      ].join('\n'), {
        remoteImageMode,
      })

      expect(html.value).toContain('<img src="data:image/png;base64,iVBORw0KGgo="')
      expect(html.value).toContain('<img src="blob:https://example.com/asset"')
      expect(html.value).toContain('<img src="./asset.png"')
      expect(html.value).not.toContain('远程图片已屏蔽')
      expect(html.value).not.toContain('远程图片待加载')
    }
  })

  it('renders remote images as placeholders when the renderer is in prompt mode', async () => {
    const html = await renderMarkdown('![diagram](https://example.com/diagram.png)', {
      remoteImageMode: 'prompt',
    })

    expect(html.value).not.toContain('<img')
    expect(html.value).toContain('data-src="https://example.com/diagram.png"')
    expect(html.value).toContain('远程图片待加载')
  })
})
