import { beforeEach, describe, expect, it } from 'vitest'

import {
  contrastTokenOverridesByThemeAndChoice,
  darkThemeTokenOverrides,
  lightThemeTokenOverrides,
  sepiaThemeTokenOverrides,
} from '@/features/settings/readingSettingsOptions'
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
    settings.updateParagraphGap('loose')
    settings.updatePageMargin('spacious')
    settings.updateTheme('sepia')
    settings.updateContrast('strong')
    settings.updateOutlinePosition('left')

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('22px')
    expect(root.style.getPropertyValue('--reading-measure')).toBe('75ch')
    expect(root.style.getPropertyValue('--reading-paragraph-gap')).toBe('1.55em')
    expect(root.style.getPropertyValue('--reading-page-margin')).toBe('clamp(2rem, 7vw, 6rem)')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('#efe1bd')
    expect(root.style.getPropertyValue('--reading-fg')).toBe('#332817')
    expect(root.style.getPropertyValue('--reading-fg-muted')).toBe('#55462e')
    expect(root.style.getPropertyValue('--reading-code-bg')).toBe('#e2cb99')
    expect(root.dataset.readingTheme).toBe('sepia')
    expect(root.dataset.readingContrast).toBe('strong')
    expect(settings.state.outlinePosition).toBe('left')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.presetId).toBe('sepia')
    expect(persisted?.tokenOverrides?.['--reading-font-size']).toBe('22px')
    expect(persisted?.tokenOverrides?.['--reading-measure']).toBe('75ch')
    expect(persisted?.tokenOverrides?.['--reading-paragraph-gap']).toBe('1.55em')
    expect(persisted?.tokenOverrides?.['--reading-page-margin']).toBe('clamp(2rem, 7vw, 6rem)')
    expect(persisted?.tokenOverrides?.['--reading-bg']).toBe('#efe1bd')
    expect(persisted?.contrast).toBe('strong')
    expect(persisted?.outlinePosition).toBe('left')
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

  it('persists outline position without writing typography or theme overrides', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateOutlinePosition('left')

    expect(settings.state.outlinePosition).toBe('left')
    expect(root.style.cssText).toBe('')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.outlinePosition).toBe('left')
    expect(persisted?.presetId).toBe('system')
    expect(persisted?.tokenOverrides).toBeUndefined()
  })

  it('persists system contrast without writing fixed theme colors', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateContrast('soft')

    expect(settings.state.contrast).toBe('soft')
    expect(root.dataset.readingTheme).toBeUndefined()
    expect(root.dataset.readingContrast).toBe('soft')
    expect(root.style.cssText).toBe('')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.presetId).toBe('system')
    expect(persisted?.contrast).toBe('soft')
    expect(persisted?.tokenOverrides).toBeUndefined()
  })

  it('reset clears customization overrides without losing remote image mode', () => {
    storage.setItem('miru:reading-settings:v1', JSON.stringify({
      version: 1,
      remoteImageMode: 'block',
      outlinePosition: 'left',
      tokenOverrides: {
        '--reading-font-size': '24px',
        '--reading-bg': '#efe1bd',
      },
      presetId: 'sepia',
    }))

    const settings = useReadingSettings({ root, storage })

    settings.applyCurrent()
    settings.reset()

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(root.dataset.readingTheme).toBeUndefined()
    expect(root.dataset.readingContrast).toBeUndefined()
    expect(settings.state.outlinePosition).toBe('right')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.remoteImageMode).toBe('block')
    expect(persisted?.tokenOverrides).toBeUndefined()
    expect(persisted?.outlinePosition).toBeUndefined()
  })

  it('ignores malformed persisted settings safely', () => {
    storage.setItem('miru:reading-settings:v1', '{bad json')

    const settings = useReadingSettings({ root, storage })

    expect(settings.state.fontSize).toBe('18')
    expect(settings.state.theme).toBe('system')
    expect(settings.state.contrast).toBe('standard')
    expect(settings.state.outlinePosition).toBe('right')
  })

  it('keeps every contrast option at AA for body text', () => {
    const themes = {
      light: lightThemeTokenOverrides,
      dark: darkThemeTokenOverrides,
      sepia: sepiaThemeTokenOverrides,
    } as const

    for (const [theme, tokens] of Object.entries(themes)) {
      for (const contrast of ['soft', 'standard', 'strong'] as const) {
        const overrides = contrastTokenOverridesByThemeAndChoice[theme as keyof typeof themes][contrast]
        const fg = overrides['--reading-fg'] ?? tokens['--reading-fg']
        const bg = tokens['--reading-bg']

        expect(
          contrastRatio(fg, bg),
          `${theme} ${contrast} body contrast`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA)
  const luminanceB = relativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(hexColor: string): number {
  const [red, green, blue] = hexToRgb(hexColor).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function hexToRgb(hexColor: string): [number, number, number] {
  const normalized = hexColor.replace('#', '')

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}
