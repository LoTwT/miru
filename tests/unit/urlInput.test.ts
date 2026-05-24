import { describe, expect, it } from 'vitest'

import {
  ensureReadableUrlContentType,
  getBareUrlPaste,
  normalizeMarkdownUrl,
  UnsupportedUrlContentTypeError,
} from '@/features/input/urlInput'

describe('bare URL paste detection', () => {
  it('accepts a single http or https URL with surrounding whitespace', () => {
    expect(getBareUrlPaste(' https://example.com/readme.md\n')).toBe('https://example.com/readme.md')
    expect(getBareUrlPaste('http://example.com/raw.txt')).toBe('http://example.com/raw.txt')
  })

  it('rejects URL-looking markdown or multiple tokens', () => {
    expect(getBareUrlPaste('`https://example.com/readme.md`')).toBeNull()
    expect(getBareUrlPaste('https://example.com/readme.md extra')).toBeNull()
    expect(getBareUrlPaste('[doc](https://example.com/readme.md)')).toBeNull()
  })

  it('rejects non-http schemes and invalid URLs', () => {
    expect(getBareUrlPaste('ftp://example.com/readme.md')).toBeNull()
    expect(getBareUrlPaste('example.com/readme.md')).toBeNull()
  })
})

describe('markdown URL normalization', () => {
  it('converts GitHub file pages to raw URLs', () => {
    expect(normalizeMarkdownUrl('https://github.com/LoTwT/miru/blob/main/README.md')).toMatchObject({
      inputUrl: 'https://github.com/LoTwT/miru/blob/main/README.md',
      requestUrl: 'https://raw.githubusercontent.com/LoTwT/miru/main/README.md',
      wasConverted: true,
    })

    expect(normalizeMarkdownUrl('https://github.com/LoTwT/miru/raw/main/docs/guide.md')?.requestUrl)
      .toBe('https://raw.githubusercontent.com/LoTwT/miru/main/docs/guide.md')
  })

  it('converts gist pages to raw URLs', () => {
    expect(normalizeMarkdownUrl('https://gist.github.com/octocat/1234567890abcdef')?.requestUrl)
      .toBe('https://gist.githubusercontent.com/octocat/1234567890abcdef/raw')

    expect(normalizeMarkdownUrl('https://gist.github.com/octocat/1234567890abcdef/raw/readme.md')?.requestUrl)
      .toBe('https://gist.githubusercontent.com/octocat/1234567890abcdef/raw/readme.md')
  })

  it('converts GitLab blob pages to raw URLs', () => {
    expect(normalizeMarkdownUrl('https://gitlab.com/group/project/-/blob/main/README.md?ref_type=heads#L4')?.requestUrl)
      .toBe('https://gitlab.com/group/project/-/raw/main/README.md')
  })

  it('preserves direct http markdown URLs and rejects unsupported schemes', () => {
    expect(normalizeMarkdownUrl('https://example.com/readme.md')).toMatchObject({
      requestUrl: 'https://example.com/readme.md',
      wasConverted: false,
    })
    expect(normalizeMarkdownUrl('ftp://example.com/readme.md')).toBeNull()
    expect(normalizeMarkdownUrl('example.com/readme.md')).toBeNull()
  })
})

describe('URL fetch content-type guard', () => {
  it('allows markdown and plain text responses', () => {
    expect(() => ensureReadableUrlContentType('text/markdown; charset=utf-8')).not.toThrow()
    expect(() => ensureReadableUrlContentType('text/plain')).not.toThrow()
  })

  it('allows missing content-type because some raw hosts omit it', () => {
    expect(() => ensureReadableUrlContentType(null)).not.toThrow()
  })

  it('rejects html pages and binary responses', () => {
    expect(() => ensureReadableUrlContentType('text/html; charset=utf-8')).toThrow(UnsupportedUrlContentTypeError)
    expect(() => ensureReadableUrlContentType('image/png')).toThrow(UnsupportedUrlContentTypeError)
    expect(() => ensureReadableUrlContentType('application/octet-stream')).toThrow(UnsupportedUrlContentTypeError)
  })
})
