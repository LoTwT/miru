import { describe, expect, it, vi } from 'vitest'

import { createLazyLibraryStore } from '@/features/library/lazyLibraryStore'
import type { LibraryStore } from '@/features/library/lazyLibraryStore'

describe('lazy library store', () => {
  it('does not load IndexedDB code until the first library operation', async () => {
    const listEntries = vi.fn().mockResolvedValue([])
    const close = vi.fn().mockResolvedValue(undefined)
    const loadStore = vi.fn().mockResolvedValue({ listEntries, close } as unknown as LibraryStore)
    const store = createLazyLibraryStore({ loadStore })

    expect(loadStore).not.toHaveBeenCalled()
    await store.close()
    expect(loadStore).not.toHaveBeenCalled()

    await expect(store.listEntries()).resolves.toEqual([])
    await expect(store.listEntries('title')).resolves.toEqual([])
    expect(loadStore).toHaveBeenCalledOnce()
    expect(listEntries).toHaveBeenNthCalledWith(1, undefined)
    expect(listEntries).toHaveBeenNthCalledWith(2, 'title')

    await store.close()
    expect(close).toHaveBeenCalledOnce()
  })
})
