const TEXT_HTML_CONTENT_TYPE = 'text/html'

const MARKDOWN_CONTENT_TYPES = new Set([
  'application/markdown',
  'application/x-markdown',
  'text/markdown',
  'text/x-markdown',
  'text/plain',
])

export class UnsupportedUrlContentTypeError extends Error {
  constructor(readonly contentType: string) {
    super(`Unsupported URL content type: ${contentType}`)
    this.name = 'UnsupportedUrlContentTypeError'
  }
}

export function getBareUrlPaste(text: string): string | null {
  const trimmed = text.trim()

  if (!trimmed || /\s/.test(trimmed)) {
    return null
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    return trimmed
  }
  catch {
    return null
  }
}

export function ensureReadableUrlContentType(contentTypeHeader: string | null): void {
  const contentType = normalizeContentType(contentTypeHeader)

  if (!contentType) {
    return
  }

  if (contentType === TEXT_HTML_CONTENT_TYPE) {
    throw new UnsupportedUrlContentTypeError(contentType)
  }

  if (contentType.startsWith('text/') || MARKDOWN_CONTENT_TYPES.has(contentType)) {
    return
  }

  throw new UnsupportedUrlContentTypeError(contentType)
}

function normalizeContentType(contentTypeHeader: string | null): string {
  return contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? ''
}
