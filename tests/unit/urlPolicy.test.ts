import { describe, expect, it } from 'vitest'

import { isSafeImageUrl, isSafeLinkUrl } from '@/lib/security/urlPolicy'

describe('url policy', () => {
  it('allows expected link schemes', () => {
    expect(isSafeLinkUrl('https://example.com')).toBe(true)
    expect(isSafeLinkUrl('http://example.com')).toBe(true)
    expect(isSafeLinkUrl('mailto:hello@example.com')).toBe(true)
    expect(isSafeLinkUrl('#heading')).toBe(true)
    expect(isSafeLinkUrl('/docs/readme')).toBe(true)
  })

  it('blocks active and local link schemes', () => {
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeLinkUrl('file:///etc/passwd')).toBe(false)
  })

  it('allows safe image schemes and blocks unsafe image schemes', () => {
    expect(isSafeImageUrl('https://example.com/image.png')).toBe(true)
    expect(isSafeImageUrl('data:image/png;base64,abc')).toBe(true)
    expect(isSafeImageUrl('blob:https://example.com/id')).toBe(true)
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeImageUrl('file:///tmp/image.png')).toBe(false)
  })
})
