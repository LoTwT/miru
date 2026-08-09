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
    addMarkdownDocument: async (input, mutation) => (await getStore()).addMarkdownDocument(input, mutation),
    addPdfDocument: async (input, mutation) => (await getStore()).addPdfDocument(input, mutation),
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
    markOpened: async (id, mutation) => (await getStore()).markOpened(id, mutation),
    openMarkdownDocument: async (id, options) => (await getStore()).openMarkdownDocument(id, options),
    openPdfDocument: async (id, options) => (await getStore()).openPdfDocument(id, options),
    saveReadingPosition: async position => (await getStore()).saveReadingPosition(position),
    updateEntry: async (id, input) => (await getStore()).updateEntry(id, input),
  }
}

export function isLibraryQuotaExceededError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'LibraryQuotaExceededError'
}
