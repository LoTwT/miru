import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createLocalFontFamilyId,
  deriveCustomThemeTokenOverrides,
  fixCustomThemeToAA,
  readingColorSchemeOptions,
  readingFontFamilyOptions,
  readingThemeStyleOptions,
  sepiaContrastTokenOverrides,
  sepiaThemeTokenOverrides,
} from '@/features/settings/readingSettingsOptions'
import { createLocalFontStore, deleteLocalFontsDatabase } from '@/features/settings/localFonts'
import type { LocalFontMetadata, LocalFontRecord } from '@/features/settings/localFonts'
import { useReadingSettings } from '@/features/settings/useReadingSettings'
import {
  legacyReadingPresetsStorageKey,
  readingPresetsStorageKey,
  readPersistedReadingPresets,
  writePersistedReadingPresets,
} from '@/features/settings/readingPresets'
import {
  legacyReadingSettingsStorageKey,
  readingSettingsStorageKey,
  readPersistedReadingSettings,
  writePersistedReadingSettings,
} from '@/lib/theme/tokens'

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

function failWritesTo(storage: Storage, blockedKey: string): Storage {
  return {
    get length() {
      return storage.length
    },
    clear: () => storage.clear(),
    getItem: key => storage.getItem(key),
    key: index => storage.key(index),
    removeItem: key => storage.removeItem(key),
    setItem: (key, value) => {
      if (key === blockedKey) {
        throw new Error('simulated write failure')
      }

      storage.setItem(key, value)
    },
  }
}

describe('reading customization settings', () => {
  let root: HTMLElement
  let storage: Storage

  beforeEach(() => {
    root = document.createElement('html')
    storage = createStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('writes only selected override tokens and persists them', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateFontSize('22')
    settings.updateMeasure('75')
    settings.updateLetterSpacing('loose')
    settings.updateParagraphGap('loose')
    settings.updatePageMargin('spacious')
    settings.updateFontFamily('system-sans')
    settings.updateColorScheme('sepia')
    settings.updateContrast('strong')
    settings.updateOutlinePosition('left')

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('22px')
    expect(root.style.getPropertyValue('--reading-measure')).toBe('75ch')
    expect(root.style.getPropertyValue('--reading-letter-spacing')).toBe('0.03em')
    expect(root.style.getPropertyValue('--reading-paragraph-gap')).toBe('1.55em')
    expect(root.style.getPropertyValue('--reading-page-margin')).toBe('clamp(2rem, 7vw, 6rem)')
    expect(root.style.getPropertyValue('--reading-font-body')).toBe('-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('#efe1bd')
    expect(root.style.getPropertyValue('--reading-fg')).toBe('#2a2012')
    expect(root.style.getPropertyValue('--reading-fg-muted')).toBe('#3e3220')
    expect(root.style.getPropertyValue('--reading-rule')).toBe('#ab8b48')
    expect(root.style.getPropertyValue('--reading-code-bg')).toBe('#e2cb99')
    expect(root.dataset.readingStyle).toBe('brutal')
    expect(root.dataset.readingScheme).toBe('sepia')
    expect(root.dataset.readingContrast).toBe('strong')
    expect(settings.state.outlinePosition).toBe('left')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted).toMatchObject({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'sepia',
    })
    expect(persisted?.tokenOverrides?.['--reading-font-size']).toBe('22px')
    expect(persisted?.tokenOverrides?.['--reading-measure']).toBe('75ch')
    expect(persisted?.tokenOverrides?.['--reading-letter-spacing']).toBe('0.03em')
    expect(persisted?.tokenOverrides?.['--reading-paragraph-gap']).toBe('1.55em')
    expect(persisted?.tokenOverrides?.['--reading-page-margin']).toBe('clamp(2rem, 7vw, 6rem)')
    expect(persisted?.tokenOverrides?.['--reading-font-body']).toBe('-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif')
    expect(persisted?.fontBody).toBeUndefined()
    expect(persisted?.tokenOverrides?.['--reading-bg']).toBe('#efe1bd')
    expect(persisted?.contrast).toBe('strong')
    expect(persisted?.outlinePosition).toBe('left')
  })

  it('switches style and color scheme independently while preserving typography overrides', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateFontSize('20')
    settings.updateColorScheme('dark')
    settings.updateThemeStyle('default')
    settings.updateColorScheme('system')

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('20px')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(root.classList.contains('brutal')).toBe(false)
    expect(root.dataset.readingStyle).toBe('default')
    expect(root.dataset.readingScheme).toBe('system')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'system',
    })
    expect(persisted?.tokenOverrides?.['--reading-font-size']).toBe('20px')
    expect(persisted?.tokenOverrides?.['--reading-bg']).toBeUndefined()
  })

  it('writes lossless rollback projections and restores v1-only edits after a rollback', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateThemeStyle('default')
    settings.updateColorScheme('dark')

    expect(JSON.parse(storage.getItem('miru:reading-settings:v2') ?? '{}')).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    })
    expect(JSON.parse(storage.getItem('miru:reading-settings:v1') ?? '{}')).toMatchObject({
      version: 1,
      presetId: 'dark',
      themeStyle: 'default',
      colorScheme: 'dark',
    })
    expect(JSON.parse(storage.getItem('miru:reading-settings:v1') ?? '{}').compatibilityRevision)
      .toBe(JSON.parse(storage.getItem('miru:reading-settings:v2') ?? '{}').compatibilityRevision)

    storage.setItem('miru:reading-settings:v1', JSON.stringify({
      version: 1,
      presetId: 'light',
    }))

    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'light',
    })

    storage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'invalid',
      colorScheme: 'invalid',
      contrast: 'invalid',
      outlinePosition: 'center',
      remoteImageMode: 'maybe',
      customTheme: {
        bg: '#fff',
      },
      tokenOverrides: {
        '--reading-font-size': 'url(https://attacker.invalid/font)',
      },
    }))
    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'light',
    })

    settings.updateColorScheme('dark')
    settings.savePreset('Rollback preset')

    expect(JSON.parse(storage.getItem('miru:reading-presets:v2') ?? '{}')).toMatchObject({
      version: 2,
      presets: [
        expect.objectContaining({
          settings: expect.objectContaining({
            themeStyle: 'default',
            colorScheme: 'dark',
          }),
        }),
      ],
    })
    expect(JSON.parse(storage.getItem('miru:reading-presets:v1') ?? '{}')).toMatchObject({
      version: 1,
      presets: [
        expect.objectContaining({
          settings: expect.objectContaining({
            theme: 'dark',
            themeStyle: 'default',
            colorScheme: 'dark',
          }),
        }),
      ],
    })
    expect(JSON.parse(storage.getItem('miru:reading-presets:v1') ?? '{}').compatibilityRevision)
      .toBe(JSON.parse(storage.getItem('miru:reading-presets:v2') ?? '{}').compatibilityRevision)
  })

  it('round-trips every style and color combination through the v1 projection', () => {
    for (const themeStyle of readingThemeStyleOptions.map(option => option.id)) {
      for (const colorScheme of readingColorSchemeOptions.map(option => option.id)) {
        const caseStorage = createStorage()

        writePersistedReadingSettings({
          version: 2,
          themeStyle,
          colorScheme,
        }, caseStorage)
        caseStorage.removeItem(readingSettingsStorageKey)

        expect(readPersistedReadingSettings(caseStorage)).toMatchObject({
          version: 2,
          themeStyle,
          colorScheme,
        })
      }
    }
  })

  it('recovers the committed v1 projection when the authoritative settings write fails', () => {
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    }, storage)
    const failingStorage = failWritesTo(storage, readingSettingsStorageKey)

    expect(() => writePersistedReadingSettings({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'light',
    }, failingStorage)).toThrow('simulated write failure')

    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'light',
    })
  })

  it('preserves a v2-only style when an old writer changes only known settings fields', () => {
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'dark',
    }, storage)

    storage.setItem(legacyReadingSettingsStorageKey, JSON.stringify({
      version: 1,
      presetId: 'dark',
      tokenOverrides: {
        '--reading-font-size': '20px',
      },
    }))

    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'dark',
      tokenOverrides: {
        '--reading-font-size': '20px',
      },
    })

    storage.setItem(legacyReadingSettingsStorageKey, JSON.stringify({
      version: 1,
      presetId: 'light',
      tokenOverrides: {
        '--reading-font-size': '20px',
      },
    }))

    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'light',
    })
  })

  it('recovers the healthy v1 projection when one same-revision v2 field is invalid', () => {
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    }, storage)

    const revision = JSON.parse(storage.getItem(readingSettingsStorageKey) ?? '{}').compatibilityRevision
    storage.setItem(readingSettingsStorageKey, JSON.stringify({
      version: 2,
      themeStyle: 'invalid',
      colorScheme: 'dark',
      compatibilityRevision: revision,
    }))

    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    })
  })

  it('merges old-writer edits with valid v2 axes when another v2 field is damaged', () => {
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'dark',
    }, storage)

    const damagedV2 = JSON.parse(storage.getItem(readingSettingsStorageKey) ?? '{}')
    storage.setItem(readingSettingsStorageKey, JSON.stringify({
      ...damagedV2,
      contrast: 'invalid',
    }))
    storage.setItem(legacyReadingSettingsStorageKey, JSON.stringify({
      version: 1,
      presetId: 'dark',
      tokenOverrides: {
        '--reading-font-size': '20px',
      },
    }))

    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'dark',
      tokenOverrides: {
        '--reading-font-size': '20px',
      },
    })
  })

  it('treats a rollback-era v1 deletion as an explicit reset', () => {
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    }, storage)
    storage.removeItem(legacyReadingSettingsStorageKey)

    expect(readPersistedReadingSettings(storage)).toBeNull()

    const settings = useReadingSettings({ root, storage })
    expect(settings.savePreset('Rollback reset preset')).not.toBeNull()
    storage.removeItem(legacyReadingPresetsStorageKey)

    expect(readPersistedReadingPresets(storage)).toEqual([])
  })

  it('does not resurrect damaged v2 snapshots after a rollback-era reset', () => {
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    }, storage)
    storage.setItem(readingSettingsStorageKey, JSON.stringify({
      version: 2,
      themeStyle: 'invalid',
      colorScheme: 'dark',
      compatibilityRevision: 42,
    }))
    storage.removeItem(legacyReadingSettingsStorageKey)

    expect(readPersistedReadingSettings(storage)).toBeNull()

    const settings = useReadingSettings({ root, storage })
    const preset = settings.savePreset('Damaged rollback preset')
    expect(preset).not.toBeNull()
    storage.setItem(readingPresetsStorageKey, JSON.stringify({
      version: 2,
      compatibilityRevision: 42,
      presets: [{
        ...preset!,
        settings: {
          ...preset!.settings,
          themeStyle: 'invalid',
        },
      }],
    }))
    storage.removeItem(legacyReadingPresetsStorageKey)

    expect(readPersistedReadingPresets(storage)).toEqual([])
  })

  it('salvages safe presets from a damaged revisionless v2 snapshot', () => {
    const settings = useReadingSettings({ root, storage })
    const preset = settings.savePreset('Revisionless preset')
    expect(preset).not.toBeNull()

    const payload = JSON.parse(storage.getItem(readingPresetsStorageKey) ?? '{}')
    delete payload.compatibilityRevision
    payload.presets[0].settings.themeStyle = 'invalid'
    storage.setItem(readingPresetsStorageKey, JSON.stringify(payload))
    storage.removeItem(legacyReadingPresetsStorageKey)

    expect(readPersistedReadingPresets(storage)).toEqual([
      expect.objectContaining({
        name: 'Revisionless preset',
        settings: expect.objectContaining({
          themeStyle: 'brutal',
          colorScheme: 'system',
        }),
      }),
    ])
  })

  it('restores rollback preset edits and rejects semantically invalid v2 preset payloads', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateThemeStyle('default')
    settings.updateColorScheme('dark')
    expect(settings.savePreset('Original preset')).not.toBeNull()

    storage.setItem('miru:reading-presets:v1', JSON.stringify({
      version: 1,
      presets: [{
        id: 'preset-rollback',
        name: 'Rollback edit',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        settings: {
          fontSize: '18',
          theme: 'system',
        },
      }],
    }))

    expect(readPersistedReadingPresets(storage)).toEqual([
      expect.objectContaining({
        id: 'preset-rollback',
        name: 'Rollback edit',
        settings: expect.objectContaining({
          themeStyle: 'brutal',
          colorScheme: 'system',
        }),
      }),
    ])

    storage.setItem(readingPresetsStorageKey, JSON.stringify({
      version: 2,
      presets: [{}],
    }))

    expect(readPersistedReadingPresets(storage)).toEqual([
      expect.objectContaining({
        id: 'preset-rollback',
        name: 'Rollback edit',
      }),
    ])
  })

  it('recovers the committed v1 preset projection when the authoritative preset write fails', () => {
    const settings = useReadingSettings({ root, storage })
    const original = settings.savePreset('Original preset')
    expect(original).not.toBeNull()
    const failingStorage = failWritesTo(storage, readingPresetsStorageKey)

    expect(() => writePersistedReadingPresets([{
      ...original!,
      name: 'Partial rollback preset',
      settings: {
        ...original!.settings,
        themeStyle: 'default',
        colorScheme: 'system',
      },
    }], failingStorage)).toThrow('simulated write failure')

    expect(readPersistedReadingPresets(storage)).toEqual([
      expect.objectContaining({
        name: 'Partial rollback preset',
        settings: expect.objectContaining({
          themeStyle: 'default',
          colorScheme: 'system',
        }),
      }),
    ])
  })

  it('preserves v2-only preset styles across old-writer edits and restores corrupt v2 presets', () => {
    const settings = useReadingSettings({ root, storage })
    settings.updateColorScheme('dark')
    const preset = settings.savePreset('Original preset')
    expect(preset).not.toBeNull()

    const legacyPreset = {
      ...preset!,
      name: 'Renamed by rollback',
      settings: {
        ...preset!.settings,
        fontSize: '20',
        theme: 'dark',
      },
    }
    delete (legacyPreset.settings as Partial<typeof legacyPreset.settings>).themeStyle
    delete (legacyPreset.settings as Partial<typeof legacyPreset.settings>).colorScheme

    storage.setItem(legacyReadingPresetsStorageKey, JSON.stringify({
      version: 1,
      presets: [legacyPreset],
    }))

    expect(readPersistedReadingPresets(storage)).toEqual([
      expect.objectContaining({
        name: 'Renamed by rollback',
        settings: expect.objectContaining({
          fontSize: '20',
          themeStyle: 'brutal',
          colorScheme: 'dark',
        }),
      }),
    ])

    const damagedPresets = JSON.parse(storage.getItem(readingPresetsStorageKey) ?? '{}')
    storage.setItem(readingPresetsStorageKey, JSON.stringify({
      ...damagedPresets,
      presets: damagedPresets.presets.map((storedPreset: { settings: object }) => ({
        ...storedPreset,
        settings: {
          ...storedPreset.settings,
          fontSize: 'invalid',
        },
      })),
    }))

    expect(readPersistedReadingPresets(storage)[0]).toMatchObject({
      name: 'Renamed by rollback',
      settings: {
        themeStyle: 'brutal',
        colorScheme: 'dark',
      },
    })

    storage.setItem(legacyReadingPresetsStorageKey, JSON.stringify({
      version: 1,
      presets: [{
        ...legacyPreset,
        settings: {
          ...legacyPreset.settings,
          theme: 'light',
        },
      }],
    }))

    expect(readPersistedReadingPresets(storage)[0]?.settings).toMatchObject({
      themeStyle: 'default',
      colorScheme: 'light',
    })

    const revision = JSON.parse(storage.getItem(readingPresetsStorageKey) ?? '{}').compatibilityRevision
    storage.setItem(readingPresetsStorageKey, JSON.stringify({
      version: 2,
      compatibilityRevision: revision,
      presets: [{
        ...preset!,
        settings: {
          ...preset!.settings,
          themeStyle: 'invalid',
        },
      }],
    }))
    storage.setItem(legacyReadingPresetsStorageKey, JSON.stringify({
      version: 1,
      compatibilityRevision: revision,
      presets: [{
        ...preset!,
        settings: {
          ...preset!.settings,
          theme: 'dark',
          themeStyle: 'brutal',
          colorScheme: 'dark',
        },
      }],
    }))

    expect(readPersistedReadingPresets(storage)[0]?.settings).toMatchObject({
      themeStyle: 'brutal',
      colorScheme: 'dark',
    })
  })

  it('defaults to Brutal with system color and can switch style without changing color', () => {
    const settings = useReadingSettings({ root, storage, systemDark: false })

    expect(readingThemeStyleOptions.map(option => option.id)).toEqual(['brutal', 'default'])
    expect(readingColorSchemeOptions.map(option => option.id).slice(0, 3)).toEqual(['system', 'light', 'dark'])
    expect(settings.state.themeStyle).toBe('brutal')
    expect(settings.state.colorScheme).toBe('system')
    expect(root.dataset.readingStyle).toBe('brutal')
    expect(root.dataset.readingScheme).toBe('system')
    expect(root.classList.contains('brutal')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(settings.effectiveColorScheme.value).toBe('light')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(readPersistedReadingSettings(storage)).toBeNull()

    settings.syncSystemColorScheme(true)

    expect(root.classList.contains('brutal')).toBe(true)
    expect(root.classList.contains('dark')).toBe(true)
    expect(settings.effectiveColorScheme.value).toBe('dark')

    const preset = settings.savePreset('Brutal preset')

    expect(readPersistedReadingPresets(storage)[0]?.settings).toMatchObject({
      themeStyle: 'brutal',
      colorScheme: 'system',
    })

    const restoredRoot = document.createElement('html')
    const restored = useReadingSettings({ root: restoredRoot, storage, systemDark: true })
    restored.applyCurrent()

    expect(restored.state.themeStyle).toBe('brutal')
    expect(restored.state.colorScheme).toBe('system')
    expect(restoredRoot.dataset.readingStyle).toBe('brutal')
    expect(restoredRoot.dataset.readingScheme).toBe('system')
    expect(restoredRoot.classList.contains('brutal')).toBe(true)
    expect(restoredRoot.classList.contains('dark')).toBe(true)
    expect(restored.applyPreset(preset?.id ?? '')).toBe(true)

    restored.updateThemeStyle('default')

    expect(restoredRoot.classList.contains('brutal')).toBe(false)
    expect(restoredRoot.classList.contains('dark')).toBe(true)
    expect(restoredRoot.dataset.readingStyle).toBe('default')
    expect(restoredRoot.dataset.readingScheme).toBe('system')
    expect(readPersistedReadingSettings(storage)).toMatchObject({
      themeStyle: 'default',
      colorScheme: 'system',
    })

    restored.reset()

    expect(restoredRoot.classList.contains('brutal')).toBe(true)
    expect(restoredRoot.classList.contains('dark')).toBe(true)
    expect(restoredRoot.dataset.readingStyle).toBe('brutal')
    expect(restoredRoot.dataset.readingScheme).toBe('system')
    expect(readPersistedReadingSettings(storage)).toBeNull()
  })

  it('persists outline position without writing typography or theme overrides', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateOutlinePosition('left')

    expect(settings.state.outlinePosition).toBe('left')
    expect(root.style.cssText).toBe('')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.outlinePosition).toBe('left')
    expect(persisted).toMatchObject({
      themeStyle: 'brutal',
      colorScheme: 'system',
    })
    expect(persisted?.tokenOverrides).toBeUndefined()
  })

  it('persists Brutal contrast without writing fixed theme colors', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateContrast('soft')

    expect(settings.state.contrast).toBe('soft')
    expect(root.dataset.readingStyle).toBe('brutal')
    expect(root.dataset.readingScheme).toBe('system')
    expect(root.dataset.readingContrast).toBe('soft')
    expect(root.style.cssText).toBe('')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted).toMatchObject({
      themeStyle: 'brutal',
      colorScheme: 'system',
    })
    expect(persisted?.contrast).toBe('soft')
    expect(persisted?.tokenOverrides).toBeUndefined()
  })

  it('persists a custom theme and can auto-fix it to AA contrast', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateColorScheme('custom')
    settings.updateCustomTheme({
      bg: '#ffffff',
      fg: '#bbbbbb',
      accent: '#cccccc',
    })

    expect(root.dataset.readingStyle).toBe('brutal')
    expect(root.dataset.readingScheme).toBe('custom')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('#ffffff')
    expect(root.style.getPropertyValue('--reading-fg')).toBe('#bbbbbb')
    expect(root.style.getPropertyValue('--reading-accent')).toBe('#cccccc')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted).toMatchObject({
      themeStyle: 'brutal',
      colorScheme: 'custom',
    })
    expect(persisted?.customTheme).toEqual({
      bg: '#ffffff',
      fg: '#bbbbbb',
      accent: '#cccccc',
    })

    settings.autoFixCustomTheme()

    const fixed = readPersistedReadingSettings(storage)?.customTheme

    expect(fixed).toBeDefined()
    expect(contrastRatio(fixed?.fg ?? '', fixed?.bg ?? '')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixed?.accent ?? '', fixed?.bg ?? '')).toBeGreaterThanOrEqual(4.5)
    expect(root.style.getPropertyValue('--reading-fg')).toBe(fixed?.fg)
    expect(root.style.getPropertyValue('--reading-accent')).toBe(fixed?.accent)

    const fixedTokens = deriveCustomThemeTokenOverrides(fixed ?? { bg: '', fg: '', accent: '' })

    expect(contrastRatio(fixedTokens['--reading-fg-muted'], fixedTokens['--reading-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixedTokens['--reading-link'], fixedTokens['--reading-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixedTokens['--reading-accent-contrast'], fixedTokens['--reading-accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixedTokens['--reading-focus'], fixedTokens['--reading-bg'])).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(fixedTokens['--reading-code-fg'], fixedTokens['--reading-code-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('chooses the reachable AA endpoint for mid-gray custom colors', () => {
    const fixed = fixCustomThemeToAA({
      bg: '#777777',
      fg: '#777777',
      accent: '#777777',
    })

    expect(contrastRatio(fixed.fg, fixed.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixed.accent, fixed.bg)).toBeGreaterThanOrEqual(4.5)
    expect(fixed.fg).not.toBe('#ffffff')
    expect(fixed.accent).not.toBe('#ffffff')
  })

  it('derives the semantic color scheme from a custom reading background', () => {
    const settings = useReadingSettings({ root, storage, systemDark: false })

    settings.updateColorScheme('custom')
    settings.updateCustomTheme({
      bg: '#000000',
      fg: '#ffffff',
      accent: '#ffffff',
    })

    expect(settings.effectiveColorScheme.value).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)

    settings.updateCustomTheme({
      bg: '#ffffff',
      fg: '#111111',
      accent: '#66569d',
    })

    expect(settings.effectiveColorScheme.value).toBe('light')
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('saves, applies, renames, and deletes named reading presets', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateFontSize('22')
    settings.updateLetterSpacing('loose')
    settings.updateColorScheme('custom')
    settings.updateCustomTheme({
      bg: '#ffffff',
      fg: '#111111',
      accent: '#767676',
    })

    const preset = settings.savePreset(' Focus preset ')

    expect(preset?.name).toBe('Focus preset')
    expect(settings.activePresetName.value).toBe('Focus preset')
    expect(settings.savePreset('Focus preset')).toBeNull()
    expect(readPersistedReadingPresets(storage)).toHaveLength(1)

    settings.reset()

    expect(root.style.getPropertyValue('--reading-font-size')).toBe('')
    expect(settings.applyPreset(preset?.id ?? '')).toBe(true)
    expect(root.style.getPropertyValue('--reading-font-size')).toBe('22px')
    expect(root.style.getPropertyValue('--reading-letter-spacing')).toBe('0.03em')
    expect(root.dataset.readingStyle).toBe('brutal')
    expect(root.dataset.readingScheme).toBe('custom')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('#ffffff')
    expect(settings.activePresetName.value).toBe('Focus preset')

    expect(settings.renamePreset(preset?.id ?? '', 'Renamed preset')).toBe(true)
    expect(readPersistedReadingPresets(storage)[0]?.name).toBe('Renamed preset')
    expect(settings.activePresetName.value).toBe('Renamed preset')
    expect(settings.deletePreset(preset?.id ?? '')).toBe(true)
    expect(readPersistedReadingPresets(storage)).toHaveLength(0)
  })

  it('migrates a legacy system theme to Brutal while preserving fontBody', () => {
    storage.setItem('miru:reading-settings:v1', JSON.stringify({
      version: 1,
      presetId: 'system',
      fontBody: '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    }))

    const settings = useReadingSettings({ root, storage })

    expect(settings.state.fontFamily).toBe('system-sans')
    expect(settings.state.themeStyle).toBe('brutal')
    expect(settings.state.colorScheme).toBe('system')
  })

  it('keeps legacy system settings and named presets on the same Brutal mapping', () => {
    storage.setItem('miru:reading-settings:v1', JSON.stringify({
      version: 1,
      presetId: 'system',
      tokenOverrides: {
        '--reading-font-size': '20px',
      },
    }))
    storage.setItem('miru:reading-presets:v1', JSON.stringify({
      version: 1,
      presets: [{
        id: 'preset-legacy-system',
        name: 'Legacy system',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        settings: {
          fontSize: '20',
          theme: 'system',
        },
      }],
    }))

    const settings = useReadingSettings({ root, storage, systemDark: false })

    expect(settings.state.themeStyle).toBe('brutal')
    expect(settings.state.colorScheme).toBe('system')
    expect(settings.activePresetName.value).toBe('Legacy system')
    expect(settings.applyPreset('preset-legacy-system')).toBe(true)
    expect(settings.state.themeStyle).toBe('brutal')
    expect(settings.activePresetName.value).toBe('Legacy system')
  })

  it('migrates a legacy pinned color into independent Default style and color state', () => {
    storage.setItem('miru:reading-settings:v1', JSON.stringify({
      version: 1,
      presetId: 'dark',
    }))

    const settings = useReadingSettings({ root, storage, systemDark: false })

    expect(settings.state.themeStyle).toBe('default')
    expect(settings.state.colorScheme).toBe('dark')
    expect(root.classList.contains('brutal')).toBe(false)
    expect(root.classList.contains('dark')).toBe(true)
    expect(readPersistedReadingSettings(storage)).toMatchObject({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'dark',
    })
  })

  it('offers curated optional font options and restores them from token overrides', () => {
    const optionIds = readingFontFamilyOptions.map(option => option.id)

    expect(optionIds).toContain('literata')
    expect(optionIds).toContain('lxgw-wenkai')
    expect(optionIds).toContain('atkinson')

    const settings = useReadingSettings({ root, storage })

    settings.updateFontFamily('literata')

    expect(root.style.getPropertyValue('--reading-font-body')).toContain('"Literata Variable"')
    expect(root.style.getPropertyValue('--reading-font-body')).toContain('"Songti SC"')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.fontFamily).toBeUndefined()
    expect(persisted?.tokenOverrides?.['--reading-font-body']).toContain('"Literata Variable"')

    const restored = useReadingSettings({ root: document.createElement('html'), storage })

    expect(restored.state.fontFamily).toBe('literata')
  })

  it('offers LXGW WenKai as an optional Chinese font and restores it from token overrides', () => {
    const settings = useReadingSettings({ root, storage })

    settings.updateFontFamily('lxgw-wenkai')

    expect(root.style.getPropertyValue('--reading-font-body')).toContain('"LXGW WenKai"')
    expect(root.style.getPropertyValue('--reading-font-body')).toContain('"Songti SC"')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.fontFamily).toBeUndefined()
    expect(persisted?.tokenOverrides?.['--reading-font-body']).toContain('"LXGW WenKai"')

    const restored = useReadingSettings({ root: document.createElement('html'), storage })

    expect(restored.state.fontFamily).toBe('lxgw-wenkai')
  })

  it('stores an uploaded local font without cloning its file blob', async () => {
    const { store } = createMockLocalFontStore([])
    const addFont = vi.mocked(store.addFont)
    addFont.mockImplementation(async input => ({
      ...createLocalFontRecord('font-uploaded', input.name),
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.file.size,
      blob: input.file,
    }))
    installFontFaceMock()
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'Quiet Serif.woff2', {
      type: 'font/woff2',
    })
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    await expect(settings.uploadLocalFont(file)).resolves.toBe(true)

    expect(addFont).toHaveBeenCalledOnce()
    expect(addFont.mock.calls[0]?.[0]).toMatchObject({
      fileName: file.name,
      mimeType: file.type,
      name: 'Quiet Serif',
    })
    expect(addFont.mock.calls[0]?.[0].file).toBe(file)
  })

  it('reports a local font initialization failure and retries it', async () => {
    const localFont = createLocalFontRecord('font-retry', 'Retry Serif')
    const { store, listFonts } = createMockLocalFontStore([localFont])
    listFonts.mockRejectedValueOnce(new Error('simulated list failure'))
    installFontFaceMock()
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'system',
      fontFamily: createLocalFontFamilyId(localFont.id),
    }, storage)
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    await expect(settings.initializeLocalFonts()).resolves.toBeUndefined()

    expect(settings.localFonts.value).toEqual([])
    expect(settings.state.fontFamily).toBe(createLocalFontFamilyId(localFont.id))
    expect(readPersistedReadingSettings(storage)?.fontFamily).toBe(createLocalFontFamilyId(localFont.id))
    expect(settings.localFontMessage.value).toEqual({
      kind: 'error',
      text: '本地字体暂时无法读取。已保留当前字体设置,请稍后重试。',
    })

    await expect(settings.initializeLocalFonts()).resolves.toBeUndefined()

    expect(listFonts).toHaveBeenCalledTimes(2)
    expect(settings.localFonts.value.map(font => font.id)).toEqual([localFont.id])
    expect(settings.state.fontFamily).toBe(createLocalFontFamilyId(localFont.id))
    expect(root.style.getPropertyValue('--reading-font-body')).toContain('MiruLocalFont-font-retry')
    expect(settings.localFontMessage.value).toBeNull()
  })

  it('retries local font initialization after the resource module becomes available', async () => {
    const localFont = createLocalFontRecord('font-module-retry', 'Module Retry')
    const { store, listFonts } = createMockLocalFontStore([localFont])
    const localFontsModule = await import('@/features/settings/localFonts')
    const loadLocalFontsModule = vi.fn()
      .mockRejectedValueOnce(new Error('simulated module failure'))
      .mockResolvedValueOnce(localFontsModule)
    const settings = useReadingSettings({
      root,
      storage,
      localFontStore: store,
      loadLocalFontsModule,
    })

    await expect(settings.initializeLocalFonts()).resolves.toBeUndefined()

    expect(listFonts).not.toHaveBeenCalled()
    expect(settings.localFontMessage.value).toEqual({
      kind: 'error',
      text: '本地字体资源暂时无法加载。当前阅读不受影响,请重新加载页面后再试。',
    })

    await expect(settings.initializeLocalFonts()).resolves.toBeUndefined()

    expect(loadLocalFontsModule).toHaveBeenCalledTimes(2)
    expect(listFonts).toHaveBeenCalledOnce()
    expect(settings.localFonts.value.map(font => font.id)).toEqual([localFont.id])
    expect(settings.localFontMessage.value).toBeNull()
  })

  it('reconciles a slow local font snapshot after a newer upload', async () => {
    const storedFont = createLocalFontRecord('font-stored', 'Stored Serif')
    const uploadedFont = createLocalFontRecord('font-uploaded-later', 'Uploaded Later')
    const storedMetadata = stripLocalFontBlob(storedFont)
    const uploadedMetadata = stripLocalFontBlob(uploadedFont)
    const firstList = createDeferred<LocalFontMetadata[]>()
    const { store, listFonts } = createMockLocalFontStore([storedFont])
    listFonts
      .mockImplementationOnce(() => firstList.promise)
      .mockResolvedValueOnce([storedMetadata, uploadedMetadata])
    vi.mocked(store.addFont).mockResolvedValueOnce(uploadedFont)
    installFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    const initialization = settings.initializeLocalFonts()
    await vi.waitFor(() => expect(listFonts).toHaveBeenCalledOnce())
    await expect(settings.uploadLocalFont(new File(['font'], 'Uploaded Later.woff2', {
      type: 'font/woff2',
    }))).resolves.toBe(true)
    firstList.resolve([storedMetadata])
    await initialization

    expect(listFonts).toHaveBeenCalledTimes(2)
    expect(settings.localFonts.value.map(font => font.id)).toEqual([storedFont.id, uploadedFont.id])
    expect(settings.state.fontFamily).toBe(createLocalFontFamilyId(uploadedFont.id))
  })

  it('does not let a slow upload override a newer font choice', async () => {
    const uploadedFont = createLocalFontRecord('font-slow-upload', 'Slow Upload')
    const { store } = createMockLocalFontStore([])
    vi.mocked(store.addFont).mockResolvedValueOnce(uploadedFont)
    const fontLoading = installDeferredFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    const upload = settings.uploadLocalFont(new File(['font'], 'Slow Upload.woff2', {
      type: 'font/woff2',
    }))
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    settings.updateFontFamily('system-sans')
    fontLoading.resolveNext()
    await expect(upload).resolves.toBe(true)

    expect(settings.localFonts.value.map(font => font.id)).toEqual([uploadedFont.id])
    expect(settings.state.fontFamily).toBe('system-sans')
    expect(root.style.getPropertyValue('--reading-font-body')).toContain('Segoe UI')
    expect(readPersistedReadingSettings(storage)?.fontFamily).toBeUndefined()
  })

  it('keeps a local font unchanged when renaming fails and allows retrying', async () => {
    const localFont = createLocalFontRecord('font-rename', 'Original Serif')
    const { blob: _blob, ...renamedMetadata } = {
      ...localFont,
      name: 'Renamed Serif',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    const { store } = createMockLocalFontStore([localFont])
    const renameFont = vi.mocked(store.renameFont)
    renameFont
      .mockRejectedValueOnce(new Error('simulated rename failure'))
      .mockResolvedValueOnce(renamedMetadata)
    const settings = useReadingSettings({ root, storage, localFontStore: store })
    await settings.initializeLocalFonts()

    await expect(settings.renameLocalFont(localFont.id, 'Renamed Serif')).resolves.toBe(false)

    expect(settings.localFonts.value.map(font => font.name)).toEqual(['Original Serif'])
    expect(settings.localFontMessage.value).toEqual({
      kind: 'error',
      text: '字体名称暂时无法保存。原名称已保留,请稍后重试。',
    })

    await expect(settings.renameLocalFont(localFont.id, 'Renamed Serif')).resolves.toBe(true)

    expect(renameFont).toHaveBeenCalledTimes(2)
    expect(settings.localFonts.value.map(font => font.name)).toEqual(['Renamed Serif'])
    expect(settings.localFontMessage.value).toEqual({
      kind: 'info',
      text: '已重命名为「Renamed Serif」。',
    })
  })

  it('does not let an older font activation failure overwrite newer mutation feedback', async () => {
    const localFont = createLocalFontRecord('font-stale-message', 'Original Name')
    const renamedMetadata = {
      ...stripLocalFontBlob(localFont),
      name: 'New Name',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    const { store } = createMockLocalFontStore([localFont])
    vi.mocked(store.renameFont).mockResolvedValueOnce(renamedMetadata)
    const settings = useReadingSettings({ root, storage, localFontStore: store })
    await settings.initializeLocalFonts()
    const fontLoading = installDeferredFontFaceMock()

    settings.updateFontFamily(createLocalFontFamilyId(localFont.id))
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    await expect(settings.renameLocalFont(localFont.id, 'New Name')).resolves.toBe(true)
    fontLoading.rejectNext(new Error('simulated stale font failure'))
    await vi.waitFor(() => expect(settings.state.fontFamily).toBe('serif'))

    expect(settings.localFontMessage.value).toEqual({
      kind: 'info',
      text: '已重命名为「New Name」。',
    })
  })

  it('keeps a local font available when deletion fails and allows retrying', async () => {
    const localFont = createLocalFontRecord('font-delete', 'Persistent Serif')
    const { store } = createMockLocalFontStore([localFont])
    const deleteFont = vi.mocked(store.deleteFont)
    deleteFont
      .mockRejectedValueOnce(new Error('simulated delete failure'))
      .mockResolvedValueOnce(undefined)
    const settings = useReadingSettings({ root, storage, localFontStore: store })
    await settings.initializeLocalFonts()
    const fontFaces = installFontFaceMock()
    settings.updateFontFamily(createLocalFontFamilyId(localFont.id))
    await vi.waitFor(() => expect(fontFaces.size).toBe(1))

    await expect(settings.deleteLocalFont(localFont.id)).resolves.toBe(false)

    expect(settings.localFonts.value.map(font => font.id)).toEqual([localFont.id])
    expect(settings.state.fontFamily).toBe(createLocalFontFamilyId(localFont.id))
    expect(readPersistedReadingSettings(storage)?.fontFamily).toBe(createLocalFontFamilyId(localFont.id))
    expect(root.style.getPropertyValue('--reading-font-body')).toContain('MiruLocalFont-font-delete')
    expect(fontFaces.size).toBe(1)
    expect(settings.localFontMessage.value).toEqual({
      kind: 'error',
      text: '字体暂时无法删除。当前字体已保留,请稍后重试。',
    })

    await expect(settings.deleteLocalFont(localFont.id)).resolves.toBe(true)

    expect(deleteFont).toHaveBeenCalledTimes(2)
    expect(settings.localFonts.value).toEqual([])
    expect(settings.state.fontFamily).toBe('serif')
    expect(root.style.getPropertyValue('--reading-font-body')).toBe('')
    expect(fontFaces.size).toBe(0)
    expect(settings.localFontMessage.value).toEqual({
      kind: 'info',
      text: '已删除字体「Persistent Serif」。',
    })
  })

  it('reports when an invalid uploaded font cannot be removed from local storage', async () => {
    const localFont = createLocalFontRecord('font-orphan', 'Broken Serif')
    const { store } = createMockLocalFontStore([])
    vi.mocked(store.addFont).mockResolvedValueOnce(localFont)
    vi.mocked(store.deleteFont).mockRejectedValueOnce(new Error('simulated cleanup failure'))
    installRejectedFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'Broken Serif.woff2', {
      type: 'font/woff2',
    })

    await expect(settings.uploadLocalFont(file)).resolves.toBe(false)

    expect(store.deleteFont).toHaveBeenCalledWith(localFont.id)
    expect(settings.localFonts.value.map(font => font.id)).toEqual([localFont.id])
    expect(settings.state.fontFamily).toBe('serif')
    expect(settings.localFontMessage.value).toEqual({
      kind: 'error',
      text: '字体无法解析,且暂时无法从本机删除。已保留在「管理我的字体」中,请稍后删除。',
    })
  })

  it('removes an invalid upload discovered by concurrent initialization after cleanup succeeds', async () => {
    const invalidFont = createLocalFontRecord('font-invalid-concurrent', 'Invalid Concurrent')
    const invalidMetadata = stripLocalFontBlob(invalidFont)
    const { store, listFonts } = createMockLocalFontStore([])
    vi.mocked(store.addFont).mockResolvedValueOnce(invalidFont)
    listFonts.mockResolvedValueOnce([invalidMetadata])
    vi.mocked(store.deleteFont).mockResolvedValueOnce(undefined)
    const fontLoading = installDeferredFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    const upload = settings.uploadLocalFont(new File(['invalid'], 'Invalid Concurrent.woff2', {
      type: 'font/woff2',
    }))
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    await settings.initializeLocalFonts()
    expect(settings.localFonts.value.map(font => font.id)).toEqual([invalidFont.id])

    fontLoading.rejectNext(new Error('simulated invalid font'))
    await expect(upload).resolves.toBe(false)

    expect(store.deleteFont).toHaveBeenCalledWith(invalidFont.id)
    expect(settings.localFonts.value).toEqual([])
    expect(settings.state.fontFamily).toBe('serif')
  })

  it('does not revive an in-flight upload deleted before font registration finishes', async () => {
    const uploadedFont = createLocalFontRecord('font-deleted-upload', 'Deleted Upload')
    const uploadedMetadata = stripLocalFontBlob(uploadedFont)
    const { store, listFonts } = createMockLocalFontStore([])
    vi.mocked(store.addFont).mockResolvedValueOnce(uploadedFont)
    listFonts.mockResolvedValueOnce([uploadedMetadata])
    vi.mocked(store.deleteFont).mockResolvedValueOnce(undefined)
    const fontLoading = installDeferredFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    const upload = settings.uploadLocalFont(new File(['font'], 'Deleted Upload.woff2', {
      type: 'font/woff2',
    }))
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    await settings.initializeLocalFonts()
    expect(settings.localFonts.value.map(font => font.id)).toEqual([uploadedFont.id])

    await expect(settings.deleteLocalFont(uploadedFont.id)).resolves.toBe(true)
    fontLoading.resolveNext()
    await expect(upload).resolves.toBe(false)

    expect(settings.localFonts.value).toEqual([])
    expect(settings.state.fontFamily).toBe('serif')
    expect(fontLoading.fontFaces.size).toBe(0)
    expect(store.deleteFont).toHaveBeenCalledWith(uploadedFont.id)
  })

  it('does not overwrite a newer rename when an in-flight upload finishes', async () => {
    const uploadedFont = createLocalFontRecord('font-renamed-upload', 'Original Upload')
    const uploadedMetadata = stripLocalFontBlob(uploadedFont)
    const renamedMetadata = {
      ...uploadedMetadata,
      name: 'Renamed Upload',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    const { store, listFonts } = createMockLocalFontStore([])
    vi.mocked(store.addFont).mockResolvedValueOnce(uploadedFont)
    listFonts.mockResolvedValueOnce([uploadedMetadata])
    vi.mocked(store.renameFont).mockResolvedValueOnce(renamedMetadata)
    const fontLoading = installDeferredFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    const upload = settings.uploadLocalFont(new File(['font'], 'Original Upload.woff2', {
      type: 'font/woff2',
    }))
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    await settings.initializeLocalFonts()
    await expect(settings.renameLocalFont(uploadedFont.id, 'Renamed Upload')).resolves.toBe(true)

    fontLoading.resolveNext()
    await expect(upload).resolves.toBe(true)

    expect(settings.localFonts.value.map(font => font.name)).toEqual(['Renamed Upload'])
    expect(settings.localFontMessage.value).toEqual({
      kind: 'info',
      text: '已重命名为「Renamed Upload」。',
    })
  })

  it('does not restore font metadata when a rename overlaps deletion', async () => {
    const dbName = `miru:test-reading-settings-fonts:${crypto.randomUUID()}`
    const store = createLocalFontStore({ dbName })

    try {
      const font = await store.addFont({
        file: new Blob(['font'], { type: 'font/woff2' }),
        fileName: 'Concurrent Serif.woff2',
        mimeType: 'font/woff2',
        name: 'Concurrent Serif',
      })
      const renaming = store.renameFont(font.id, 'Renamed Too Late')
      const deleting = store.deleteFont(font.id)

      await Promise.all([renaming, deleting])

      expect(await store.listFonts()).toEqual([])
      expect(await store.getFont(font.id)).toBeNull()
    }
    finally {
      await store.close().catch(() => undefined)
      await deleteLocalFontsDatabase(dbName)
    }
  })

  it('loads only the selected local font at startup and lazily loads another on selection', async () => {
    const first = createLocalFontRecord('font-one', 'Quiet Serif')
    const second = createLocalFontRecord('font-two', 'Reading Sans')
    const { store, getFont, listFonts } = createMockLocalFontStore([first, second])
    const addedFontFaces = installFontFaceMock()
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'system',
      fontFamily: createLocalFontFamilyId(second.id),
    }, storage)
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    await settings.initializeLocalFonts()

    expect(listFonts).toHaveBeenCalledOnce()
    expect(settings.localFonts.value.map(font => font.id)).toEqual([first.id, second.id])
    expect(getFont).toHaveBeenCalledTimes(1)
    expect(getFont).toHaveBeenCalledWith(second.id)
    expect(Array.from(addedFontFaces, fontFace => fontFace.family)).toEqual([
      'MiruLocalFont-font-two',
    ])

    settings.updateFontFamily(createLocalFontFamilyId(first.id))

    await vi.waitFor(() => {
      expect(getFont).toHaveBeenCalledTimes(2)
      expect(addedFontFaces.size).toBe(2)
    })
    expect(getFont).toHaveBeenLastCalledWith(first.id)
    expect(Array.from(addedFontFaces, fontFace => fontFace.family)).toEqual([
      'MiruLocalFont-font-two',
      'MiruLocalFont-font-one',
    ])
  })

  it('does not let a slow startup font restore overwrite a newer font choice', async () => {
    const localFont = createLocalFontRecord('font-slow', 'Slow Serif')
    const { store } = createMockLocalFontStore([localFont])
    const fontLoading = installDeferredFontFaceMock()
    writePersistedReadingSettings({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'system',
      fontFamily: createLocalFontFamilyId(localFont.id),
    }, storage)
    const settings = useReadingSettings({ root, storage, localFontStore: store })

    const initialization = settings.initializeLocalFonts()
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    settings.updateFontFamily('system-sans')
    fontLoading.resolveNext()
    await initialization

    expect(settings.state.fontFamily).toBe('system-sans')
    expect(fontLoading.fontFaces.size).toBe(0)
  })

  it('discards a font registration that finishes after the font was deleted', async () => {
    const localFont = createLocalFontRecord('font-deleted', 'Deleted Serif')
    const { store } = createMockLocalFontStore([localFont])
    const fontLoading = installDeferredFontFaceMock()
    const settings = useReadingSettings({ root, storage, localFontStore: store })
    await settings.initializeLocalFonts()

    settings.updateFontFamily(createLocalFontFamilyId(localFont.id))
    await vi.waitFor(() => expect(fontLoading.pendingLoads).toHaveLength(1))
    await settings.deleteLocalFont(localFont.id)
    fontLoading.resolveNext()
    await vi.waitFor(() => expect(settings.state.fontFamily).toBe('serif'))

    expect(settings.localFonts.value).toHaveLength(0)
    expect(fontLoading.fontFaces.size).toBe(0)
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
    expect(root.dataset.readingStyle).toBe('brutal')
    expect(root.dataset.readingScheme).toBe('system')
    expect(root.dataset.readingContrast).toBeUndefined()
    expect(settings.state.outlinePosition).toBe('right')

    const persisted = readPersistedReadingSettings(storage)

    expect(persisted?.remoteImageMode).toBe('block')
    expect(persisted?.tokenOverrides).toBeUndefined()
    expect(persisted?.outlinePosition).toBeUndefined()
    expect(JSON.parse(storage.getItem('miru:reading-settings:v2') ?? '{}')).toMatchObject({
      version: 2,
      remoteImageMode: 'block',
    })
    expect(JSON.parse(storage.getItem('miru:reading-settings:v1') ?? '{}')).toMatchObject({
      version: 1,
      remoteImageMode: 'block',
    })
  })

  it('ignores malformed persisted settings safely', () => {
    storage.setItem('miru:reading-settings:v1', '{bad json')

    const settings = useReadingSettings({ root, storage })

    expect(settings.state.fontSize).toBe('18')
    expect(settings.state.themeStyle).toBe('brutal')
    expect(settings.state.colorScheme).toBe('system')
    expect(settings.state.contrast).toBe('standard')
    expect(settings.state.outlinePosition).toBe('right')
  })

  it('drops persisted token values that can load external resources', () => {
    storage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'sepia',
      tokenOverrides: {
        '--reading-bg': 'url(https://attacker.invalid/pixel)',
        '--reading-font-size': 'url(https://attacker.invalid/font)',
        '--reading-unknown': 'red',
      },
    }))

    const persisted = readPersistedReadingSettings(storage)
    const settings = useReadingSettings({ root, storage })

    expect(persisted?.tokenOverrides).toBeUndefined()
    expect(settings.state.colorScheme).toBe('sepia')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('#efe1bd')
  })

  it('delegates light and dark palettes to Theme tokens and keeps Sepia contrasts at AA', () => {
    const settings = useReadingSettings({ root, storage, systemDark: true })

    settings.updateColorScheme('light')

    expect(root.classList.contains('dark')).toBe(false)
    expect(settings.effectiveColorScheme.value).toBe('light')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(root.style.getPropertyValue('--reading-link-hover')).toBe('')

    settings.updateColorScheme('dark')

    expect(root.classList.contains('dark')).toBe(true)
    expect(settings.effectiveColorScheme.value).toBe('dark')
    expect(root.style.getPropertyValue('--reading-bg')).toBe('')
    expect(root.style.getPropertyValue('--reading-link-hover')).toBe('')

    for (const contrast of ['soft', 'standard', 'strong'] as const) {
      const overrides = sepiaContrastTokenOverrides.sepia[contrast]
      const fg = overrides['--reading-fg'] ?? sepiaThemeTokenOverrides['--reading-fg']
      const bg = sepiaThemeTokenOverrides['--reading-bg']

      expect(
        contrastRatio(fg, bg),
        `sepia ${contrast} body contrast`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

function createLocalFontRecord(id: string, name: string): LocalFontRecord {
  const timestamp = '2026-01-01T00:00:00.000Z'

  return {
    id,
    name,
    fileName: `${name}.woff2`,
    mimeType: 'font/woff2',
    byteSize: 4,
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: 2,
    blob: new Blob(['font'], { type: 'font/woff2' }),
  }
}

function stripLocalFontBlob(record: LocalFontRecord): LocalFontMetadata {
  const { blob: _blob, ...metadata } = record
  return metadata
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function createMockLocalFontStore(records: LocalFontRecord[]) {
  const metadata = records.map(({ blob: _blob, ...record }) => record satisfies LocalFontMetadata)
  const recordsById = new Map(records.map(record => [record.id, record]))
  const listFonts = vi.fn(async () => metadata)
  const getFont = vi.fn(async (id: string) => recordsById.get(id) ?? null)
  const store = {
    addFont: vi.fn(),
    close: vi.fn(),
    countFonts: vi.fn(),
    deleteFont: vi.fn(),
    getFont,
    listFonts,
    renameFont: vi.fn(),
  } as unknown as ReturnType<typeof createLocalFontStore>

  return { store, getFont, listFonts }
}

function installFontFaceMock(): Set<FontFace> {
  const fontFaces = new Set<FontFace>()
  const fontSet = {
    add(fontFace: FontFace) {
      fontFaces.add(fontFace)
      return fontSet
    },
    delete(fontFace: FontFace) {
      return fontFaces.delete(fontFace)
    },
    [Symbol.iterator]() {
      return fontFaces[Symbol.iterator]()
    },
  } as unknown as FontFaceSet

  class TestFontFace {
    family: string

    constructor(family: string) {
      this.family = family
    }

    async load(): Promise<this> {
      return this
    }
  }

  vi.stubGlobal('FontFace', TestFontFace)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fontSet,
  })
  return fontFaces
}

function installDeferredFontFaceMock() {
  const fontFaces = new Set<FontFace>()
  const pendingLoads: Array<{
    reject: (reason?: unknown) => void
    resolve: () => void
  }> = []
  const fontSet = {
    add(fontFace: FontFace) {
      fontFaces.add(fontFace)
      return fontSet
    },
    delete(fontFace: FontFace) {
      return fontFaces.delete(fontFace)
    },
    [Symbol.iterator]() {
      return fontFaces[Symbol.iterator]()
    },
  } as unknown as FontFaceSet

  class DeferredFontFace {
    family: string

    constructor(family: string) {
      this.family = family
    }

    load(): Promise<this> {
      return new Promise((resolve, reject) => pendingLoads.push({
        reject,
        resolve: () => resolve(this),
      }))
    }
  }

  vi.stubGlobal('FontFace', DeferredFontFace)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fontSet,
  })

  return {
    fontFaces,
    pendingLoads,
    resolveNext() {
      const pending = pendingLoads.shift()
      if (!pending) {
        throw new Error('No pending font load')
      }
      pending.resolve()
    },
    rejectNext(reason?: unknown) {
      const pending = pendingLoads.shift()
      if (!pending) {
        throw new Error('No pending font load')
      }
      pending.reject(reason)
    },
  }
}

function installRejectedFontFaceMock(): void {
  const fontSet = {
    add() {
      return fontSet
    },
    delete() {
      return false
    },
    [Symbol.iterator]() {
      return [][Symbol.iterator]()
    },
  } as unknown as FontFaceSet

  class RejectedFontFace {
    family: string

    constructor(family: string) {
      this.family = family
    }

    async load(): Promise<this> {
      throw new Error('simulated font parse failure')
    }
  }

  vi.stubGlobal('FontFace', RejectedFontFace)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fontSet,
  })
}

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
