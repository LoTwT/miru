import type { createLibraryStore } from './libraryStore'

export type LibraryStore = ReturnType<typeof createLibraryStore>

interface LazyLibraryStoreOptions {
  loadStore?: () => Promise<LibraryStore>
}

export function createLazyLibraryStore(options: LazyLibraryStoreOptions = {}): LibraryStore {
  const loadStore = options.loadStore ?? (async () => {
    const { createLibraryStore } = await import('./libraryStore')
    return createLibraryStore()
  })
  let storePromise: Promise<LibraryStore> | null = null

  function getStore(): Promise<LibraryStore> {
    if (storePromise) {
      return storePromise
    }

    const loading = loadStore()
    storePromise = loading
    void loading.catch(() => {
      if (storePromise === loading) {
        storePromise = null
      }
    })
    return loading
  }

  return {
    addMarkdownDocument: async input => (await getStore()).addMarkdownDocument(input),
    addPdfDocument: async input => (await getStore()).addPdfDocument(input),
    clearLibrary: async () => (await getStore()).clearLibrary(),
    async close() {
      const loading = storePromise
      storePromise = null
      if (loading) {
        await (await loading).close()
      }
    },
    countStoreEntries: async () => (await getStore()).countStoreEntries(),
    deleteEntry: async id => (await getStore()).deleteEntry(id),
    findMarkdownEntryByUrl: async source => (await getStore()).findMarkdownEntryByUrl(source),
    getReadingPosition: async id => (await getStore()).getReadingPosition(id),
    isMarkdownContentChanged: async (id, markdown) => (await getStore()).isMarkdownContentChanged(id, markdown),
    listEntries: async sortMode => (await getStore()).listEntries(sortMode),
    openMarkdownDocument: async id => (await getStore()).openMarkdownDocument(id),
    openPdfDocument: async id => (await getStore()).openPdfDocument(id),
    saveReadingPosition: async position => (await getStore()).saveReadingPosition(position),
    updateEntry: async (id, input) => (await getStore()).updateEntry(id, input),
  }
}

export function isLibraryQuotaExceededError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'LibraryQuotaExceededError'
}
