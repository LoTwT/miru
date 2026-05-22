import { describe, expect, it } from 'vitest'

import {
  ensureReadableUrlContentType,
  getBareUrlPaste,
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
