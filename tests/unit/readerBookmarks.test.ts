import { describe, expect, it } from 'vitest'

import {
  createReaderBookmark,
  readPersistedReaderBookmarks,
  readerBookmarksStorageKey,
  removeBookmarksForDocument,
  removeLibraryBookmarks,
  writePersistedReaderBookmarks,
  type ReaderBookmark,
} from '@/features/reader/bookmarks'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('reader bookmarks persistence', () => {
  it('persists and reads valid bookmark payloads', () => {
    const storage = new MemoryStorage()
    const bookmark = createReaderBookmark({
      documentKey: 'library:doc-1',
      documentTitle: 'Quiet note',
      kind: 'markdown-heading',
      label: 'Section one',
      target: { headingId: 'section-one' },
    })

    writePersistedReaderBookmarks([bookmark], storage)

    expect(storage.getItem(readerBookmarksStorageKey)).toContain('Section one')
    expect(readPersistedReaderBookmarks(storage)).toEqual([bookmark])
  })

  it('ignores malformed persisted bookmark entries', () => {
    const storage = new MemoryStorage()
    const valid = createReaderBookmark({
      documentKey: 'sample',
      documentTitle: 'Sample',
      kind: 'markdown-position',
      label: 'Current paragraph',
      target: { scrollY: 320 },
    })
    const invalid = { ...valid, target: 'bad-target' }

    storage.setItem(readerBookmarksStorageKey, JSON.stringify([invalid, valid, null]))

    expect(readPersistedReaderBookmarks(storage)).toEqual([valid])
  })

  it('removes bookmarks by document or library namespace', () => {
    const bookmarks: ReaderBookmark[] = [
      createReaderBookmark({
        documentKey: 'library:doc-1',
        documentTitle: 'Doc one',
        kind: 'pdf-page',
        label: '第 2 页',
        target: { pageNumber: 2 },
      }),
      createReaderBookmark({
        documentKey: 'library:doc-2',
        documentTitle: 'Doc two',
        kind: 'markdown-position',
        label: 'Spot',
        target: { scrollY: 42 },
      }),
      createReaderBookmark({
        documentKey: 'sample',
        documentTitle: 'Sample',
        kind: 'markdown-heading',
        label: 'Intro',
        target: { headingId: 'intro' },
      }),
    ]

    expect(removeBookmarksForDocument(bookmarks, 'library:doc-1')).toHaveLength(2)
    expect(removeLibraryBookmarks(bookmarks).map(bookmark => bookmark.documentKey)).toEqual(['sample'])
  })
})
