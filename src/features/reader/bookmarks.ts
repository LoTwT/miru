export type ReaderBookmarkKind = 'markdown-heading' | 'markdown-position' | 'pdf-page'

export interface ReaderBookmark {
  id: string
  documentKey: string
  documentTitle: string
  kind: ReaderBookmarkKind
  label: string
  createdAt: string
  target: {
    headingId?: string
    pageNumber?: number
    scrollY?: number
  }
  schemaVersion: 1
}

export const readerBookmarksStorageKey = 'miru:reader-bookmarks:v1'

export function readPersistedReaderBookmarks(storage: Storage = localStorage): ReaderBookmark[] {
  try {
    const raw = storage.getItem(readerBookmarksStorageKey)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isReaderBookmark)
  }
  catch {
    return []
  }
}

export function writePersistedReaderBookmarks(bookmarks: readonly ReaderBookmark[], storage: Storage = localStorage): void {
  storage.setItem(readerBookmarksStorageKey, JSON.stringify(bookmarks))
}

export function createReaderBookmark(input: Omit<ReaderBookmark, 'createdAt' | 'id' | 'schemaVersion'>): ReaderBookmark {
  return {
    ...input,
    id: createBookmarkId(),
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
  }
}

export function removeBookmarksForDocument(bookmarks: readonly ReaderBookmark[], documentKey: string): ReaderBookmark[] {
  return bookmarks.filter(bookmark => bookmark.documentKey !== documentKey)
}

export function removeLibraryBookmarks(bookmarks: readonly ReaderBookmark[]): ReaderBookmark[] {
  return bookmarks.filter(bookmark => !bookmark.documentKey.startsWith('library:'))
}

function isReaderBookmark(value: unknown): value is ReaderBookmark {
  if (!value || typeof value !== 'object') {
    return false
  }

  const bookmark = value as Partial<ReaderBookmark>
  return bookmark.schemaVersion === 1
    && typeof bookmark.id === 'string'
    && typeof bookmark.documentKey === 'string'
    && typeof bookmark.documentTitle === 'string'
    && typeof bookmark.label === 'string'
    && typeof bookmark.createdAt === 'string'
    && isReaderBookmarkKind(bookmark.kind)
    && isBookmarkTarget(bookmark.target)
}

function isReaderBookmarkKind(value: unknown): value is ReaderBookmarkKind {
  return value === 'markdown-heading'
    || value === 'markdown-position'
    || value === 'pdf-page'
}

function isBookmarkTarget(value: unknown): value is ReaderBookmark['target'] {
  if (!value || typeof value !== 'object') {
    return false
  }

  const target = value as ReaderBookmark['target']
  return (target.headingId === undefined || typeof target.headingId === 'string')
    && (target.pageNumber === undefined || typeof target.pageNumber === 'number')
    && (target.scrollY === undefined || typeof target.scrollY === 'number')
}

function createBookmarkId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `bookmark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
