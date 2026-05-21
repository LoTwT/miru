import { beforeEach, describe, expect, it } from 'vitest'

import { useReadingSettings } from '@/features/settings/useReadingSettings'
import { readPersistedReadingSettings } from '@/lib/theme/tokens'

function createStorage(): Storage {
  const data = new Map<string, string>()

  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => Array.from(data.keys())[index] ?? null,
    removeItem: key => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  }
}

describe('reading customization settings', () => {
  let root: HTMLElement
  let storage: Storage

  beforeEach(() => {
    root = document.createElement('html')
    storage = createStorage()
  })

  it('writes only selected override tokens and persists them', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateFontSize('22')
    settings.updateMeasure('75')
    settings.updateTheme('sepia')

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('22px')
    expect(root.style.getPropertyValue('--reading-measure')).toBe('75ch')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('#f4ecd8')
    expect(root.style.getPropertyValue('--reading-fg-muted')).toBe('#6f6149')
    expect(root.dataset.readingTheme).toBe('sepia')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.presetId).toBe('sepia')
    expect(persisted?.tokenOverrides?.['--reading-font-size']).toBe('22px')
    expect(persisted?.tokenOverrides?.['--reading-measure']).toBe('75ch')
    expect(persisted?.tokenOverrides?.['--reading-bg']).toBe('#f4ecd8')
  })

  it('switches back to system by clearing theme tokens while preserving typography overrides', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateFontSize('20')
    settings.updateTheme('dark')
    settings.updateTheme('system')

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('20px')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(root.dataset.readingTheme).toBeUndefined()

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.presetId).toBe('system')
    expect(persisted?.tokenOverrides?.['--reading-font-size']).toBe('20px')
    expect(persisted?.tokenOverrides?.['--reading-bg']).toBeUndefined()
  })

  it('reset clears customization overrides without losing remote image mode', () => {
    storage.setItem('miru:reading-settings:v1', JSON.stringify({
      version: 1,
      remoteImageMode: 'block',
      tokenOverrides: {
        '--reading-font-size': '24px',
        '--reading-bg': '#f4ecd8',
      },
      presetId: 'sepia',
    }))

    const settings = useReadingSettings({ root, storage })

    settings.applyCurrent()
    settings.reset()

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(root.dataset.readingTheme).toBeUndefined()

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.remoteImageMode).toBe('block')
    expect(persisted?.tokenOverrides).toBeUndefined()
  })

  it('ignores malformed persisted settings safely', () => {
    storage.setItem('miru:reading-settings:v1', '{bad json')

    const settings = useReadingSettings({ root, storage })

    expect(settings.state.fontSize).toBe('18')
    expect(settings.state.theme).toBe('system')
  })
})
