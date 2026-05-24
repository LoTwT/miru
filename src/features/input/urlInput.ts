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

export class UrlFetchHttpError extends Error {
  constructor(readonly status: number) {
    super(`URL fetch failed with HTTP ${status}`)
    this.name = 'UrlFetchHttpError'
  }
}

export interface NormalizedMarkdownUrl {
  inputUrl: string
  requestUrl: string
  wasConverted: boolean
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

export function normalizeMarkdownUrl(input: string): NormalizedMarkdownUrl | null {
  const trimmed = input.trim()

  let url: URL
  try {
    url = new URL(trimmed)
  }
  catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }

  const converted = normalizeGitHubUrl(url)
    ?? normalizeGistUrl(url)
    ?? normalizeGitLabUrl(url)
    ?? url

  return {
    inputUrl: trimmed,
    requestUrl: converted.toString(),
    wasConverted: converted.toString() !== url.toString(),
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

function normalizeGitHubUrl(url: URL): URL | null {
  if (url.hostname !== 'github.com') {
    return null
  }

  const segments = getPathSegments(url)
  const [owner, repo, fileMode, branch, ...filePath] = segments

  if (!owner || !repo || !branch || filePath.length === 0) {
    return null
  }

  if (fileMode !== 'blob' && fileMode !== 'raw') {
    return null
  }

  return new URL(`https://raw.githubusercontent.com/${[owner, repo, branch, ...filePath].join('/')}`)
}

function normalizeGistUrl(url: URL): URL | null {
  if (url.hostname !== 'gist.github.com') {
    return null
  }

  const [user, rawGistId, maybeRaw, ...rawPath] = getPathSegments(url)
  const gistId = rawGistId?.replace(/\.git$/i, '')

  if (!user || !gistId) {
    return null
  }

  const path = maybeRaw === 'raw' ? ['raw', ...rawPath] : ['raw']

  return new URL(`https://gist.githubusercontent.com/${[user, gistId, ...path].join('/')}`)
}

function normalizeGitLabUrl(url: URL): URL | null {
  if (url.hostname !== 'gitlab.com' && !url.hostname.endsWith('.gitlab.com')) {
    return null
  }

  const segments = getPathSegments(url)
  const markerIndex = segments.indexOf('-')

  if (markerIndex < 1 || segments[markerIndex + 1] !== 'blob') {
    return null
  }

  const rawSegments = [
    ...segments.slice(0, markerIndex),
    '-',
    'raw',
    ...segments.slice(markerIndex + 2),
  ]

  const converted = new URL(url.toString())
  converted.pathname = `/${rawSegments.join('/')}`
  converted.search = ''
  converted.hash = ''

  return converted
}

function getPathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}
