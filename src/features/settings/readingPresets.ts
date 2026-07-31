import {
  createReadingCompatibilityRevision,
  migrateLegacyReadingTheme,
  selectCompatibilitySnapshot,
} from '@/lib/theme/readingThemeContract'
import type { CompatibilityReadResult } from '@/lib/theme/readingThemeContract'

import {
  defaultReadingSettings,
  isReadingColorScheme,
  isReadingFontFamilyId,
  isReadingThemeStyle,
  readingContrastOptions,
  readingFontSizeOptions,
  readingLetterSpacingOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  readingPageMarginOptions,
  readingParagraphGapOptions,
} from './readingSettingsOptions'
import type {
  ReadingColorSchemeId,
  ReadingContrastId,
  ReadingCustomThemeState,
  ReadingFontFamilyId,
  ReadingFontSizeId,
  ReadingLetterSpacingId,
  ReadingLineHeightId,
  ReadingMeasureId,
  ReadingOutlinePositionId,
  ReadingPageMarginId,
  ReadingParagraphGapId,
  ReadingThemeStyleId,
} from './readingSettingsOptions'

export interface ReadingPresetSnapshot {
  fontSize: ReadingFontSizeId
  measure: ReadingMeasureId
  lineHeight: ReadingLineHeightId
  letterSpacing: ReadingLetterSpacingId
  paragraphGap: ReadingParagraphGapId
  pageMargin: ReadingPageMarginId
  fontFamily: ReadingFontFamilyId
  themeStyle: ReadingThemeStyleId
  colorScheme: ReadingColorSchemeId
  contrast: ReadingContrastId
  outlinePosition: ReadingOutlinePositionId
  customTheme: ReadingCustomThemeState
}

export interface ReadingPreset {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  settings: ReadingPresetSnapshot
}

interface StoredReadingPresets {
  version?: unknown
  presets?: unknown
  compatibilityRevision?: unknown
}

interface SanitizedReadingPresets {
  presets: ReadingPreset[]
  compatibilityRevision?: unknown
  independentThemePresetIds: string[]
}

export const readingPresetsStorageKey = 'miru:reading-presets:v2'
export const legacyReadingPresetsStorageKey = 'miru:reading-presets:v1'
const maxPresetNameLength = 32

export function readPersistedReadingPresets(storage: Storage = localStorage): ReadingPreset[] {
  const primary = readStoredReadingPresets(storage, readingPresetsStorageKey, 2)
  const legacy = readStoredReadingPresets(storage, legacyReadingPresetsStorageKey, 1)

  return selectCompatibilitySnapshot(primary, legacy, reconcileLegacyReadingPresets)?.presets ?? []
}

function readStoredReadingPresets(
  storage: Storage,
  storageKey: string,
  expectedVersion: 1 | 2,
): CompatibilityReadResult<SanitizedReadingPresets> {
  let raw: string | null

  try {
    raw = storage.getItem(storageKey)
  }
  catch {
    return { status: 'invalid' }
  }

  if (raw === null) {
    return { status: 'missing' }
  }

  try {
    const parsed = JSON.parse(raw) as StoredReadingPresets

    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || parsed.version !== expectedVersion
      || !Array.isArray(parsed.presets)
    ) {
      return { status: 'invalid' }
    }

    const presets = parsed.presets
      .map(sanitizePreset)
      .filter((preset): preset is ReadingPreset => Boolean(preset))

    if (parsed.presets.length > 0 && presets.length === 0) {
      return { status: 'invalid' }
    }

    const candidate: SanitizedReadingPresets = {
      presets,
      independentThemePresetIds: parsed.presets
        .filter(hasIndependentThemeAxes)
        .map((preset) => {
          return typeof preset === 'object' && preset && 'id' in preset && typeof preset.id === 'string'
            ? preset.id
            : ''
        })
        .filter(Boolean),
      ...(Object.prototype.hasOwnProperty.call(parsed, 'compatibilityRevision')
        ? { compatibilityRevision: parsed.compatibilityRevision }
        : {}),
    }

    const hasValidV2Envelope = (
      parsed.compatibilityRevision === undefined
      || (
        typeof parsed.compatibilityRevision === 'string'
        && parsed.compatibilityRevision.length > 0
      )
    ) && parsed.presets.every(isValidV2Preset)

    return expectedVersion === 2 && !hasValidV2Envelope
      ? { status: 'invalid', candidate }
      : { status: 'valid', candidate }
  }
  catch {
    return { status: 'invalid' }
  }
}

export function writePersistedReadingPresets(presets: readonly ReadingPreset[], storage: Storage = localStorage): void {
  if (presets.length === 0) {
    storage.removeItem(legacyReadingPresetsStorageKey)
    storage.removeItem(readingPresetsStorageKey)
    return
  }

  const compatibilityRevision = createReadingCompatibilityRevision()

  storage.setItem(legacyReadingPresetsStorageKey, JSON.stringify({
    version: 1,
    presets: presets.map(createLegacyReadingPreset),
    compatibilityRevision,
  }))
  storage.setItem(readingPresetsStorageKey, JSON.stringify({
    version: 2,
    presets,
    compatibilityRevision,
  }))
}

function createLegacyReadingPreset(preset: ReadingPreset): Omit<ReadingPreset, 'settings'> & {
  settings: ReadingPresetSnapshot & {
    theme: ReadingColorSchemeId
  }
} {
  return {
    ...preset,
    settings: {
      ...preset.settings,
      theme: preset.settings.colorScheme,
      customTheme: { ...preset.settings.customTheme },
    },
  }
}

function reconcileLegacyReadingPresets(
  primary: SanitizedReadingPresets,
  legacy: SanitizedReadingPresets,
): SanitizedReadingPresets {
  if (typeof legacy.compatibilityRevision === 'string' && legacy.compatibilityRevision.length > 0) {
    return legacy
  }

  const primaryById = new Map(primary.presets.map(preset => [preset.id, preset]))
  const primaryIndependentThemePresetIds = new Set(primary.independentThemePresetIds)
  const independentThemePresetIds = new Set(legacy.independentThemePresetIds)

  return {
    ...legacy,
    presets: legacy.presets.map((legacyPreset) => {
      const primaryPreset = primaryById.get(legacyPreset.id)

      if (
        !primaryPreset
        || !primaryIndependentThemePresetIds.has(legacyPreset.id)
        || independentThemePresetIds.has(legacyPreset.id)
        || legacyPreset.settings.colorScheme !== primaryPreset.settings.colorScheme
      ) {
        return legacyPreset
      }

      return {
        ...legacyPreset,
        settings: {
          ...legacyPreset.settings,
          themeStyle: primaryPreset.settings.themeStyle,
          colorScheme: primaryPreset.settings.colorScheme,
        },
      }
    }),
  }
}

export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, maxPresetNameLength)
}

export function createReadingPresetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `preset-${crypto.randomUUID()}`
  }

  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSnapshotFromSettings(settings: ReadingPresetSnapshot): ReadingPresetSnapshot {
  return {
    fontSize: settings.fontSize,
    measure: settings.measure,
    lineHeight: settings.lineHeight,
    letterSpacing: settings.letterSpacing,
    paragraphGap: settings.paragraphGap,
    pageMargin: settings.pageMargin,
    fontFamily: settings.fontFamily,
    themeStyle: settings.themeStyle,
    colorScheme: settings.colorScheme,
    contrast: settings.contrast,
    outlinePosition: settings.outlinePosition,
    customTheme: { ...settings.customTheme },
  }
}

export function arePresetSnapshotsEqual(
  snapshot: ReadingPresetSnapshot,
  otherSnapshot: ReadingPresetSnapshot,
): boolean {
  return snapshot.fontSize === otherSnapshot.fontSize
    && snapshot.measure === otherSnapshot.measure
    && snapshot.lineHeight === otherSnapshot.lineHeight
    && snapshot.letterSpacing === otherSnapshot.letterSpacing
    && snapshot.paragraphGap === otherSnapshot.paragraphGap
    && snapshot.pageMargin === otherSnapshot.pageMargin
    && snapshot.fontFamily === otherSnapshot.fontFamily
    && snapshot.themeStyle === otherSnapshot.themeStyle
    && snapshot.colorScheme === otherSnapshot.colorScheme
    && snapshot.contrast === otherSnapshot.contrast
    && snapshot.outlinePosition === otherSnapshot.outlinePosition
    && snapshot.customTheme.bg === otherSnapshot.customTheme.bg
    && snapshot.customTheme.fg === otherSnapshot.customTheme.fg
    && snapshot.customTheme.accent === otherSnapshot.customTheme.accent
}

function sanitizePreset(value: unknown): ReadingPreset | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const preset = value as Partial<ReadingPreset>
  const name = normalizePresetName(typeof preset.name === 'string' ? preset.name : '')
  const settings = sanitizeSnapshot(preset.settings)

  if (!preset.id || typeof preset.id !== 'string' || !name || !settings) {
    return null
  }

  return {
    id: preset.id,
    name,
    createdAt: typeof preset.createdAt === 'string' ? preset.createdAt : new Date(0).toISOString(),
    updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date(0).toISOString(),
    settings,
  }
}

function isValidV2Preset(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const preset = value as Partial<ReadingPreset>
  const settings = preset.settings

  return typeof preset.id === 'string'
    && preset.id.length > 0
    && typeof preset.name === 'string'
    && normalizePresetName(preset.name).length > 0
    && typeof preset.createdAt === 'string'
    && typeof preset.updatedAt === 'string'
    && Boolean(settings)
    && typeof settings === 'object'
    && matchOption(readingFontSizeOptions, settings.fontSize) !== undefined
    && matchOption(readingMeasureOptions, settings.measure) !== undefined
    && matchOption(readingLineHeightOptions, settings.lineHeight) !== undefined
    && matchOption(readingLetterSpacingOptions, settings.letterSpacing) !== undefined
    && matchOption(readingParagraphGapOptions, settings.paragraphGap) !== undefined
    && matchOption(readingPageMarginOptions, settings.pageMargin) !== undefined
    && isReadingFontFamilyId(settings.fontFamily)
    && isReadingThemeStyle(settings.themeStyle)
    && isReadingColorScheme(settings.colorScheme)
    && matchOption(readingContrastOptions, settings.contrast) !== undefined
    && matchOption(readingOutlinePositionOptions, settings.outlinePosition) !== undefined
    && sanitizeCustomTheme(settings.customTheme) !== null
}

function hasIndependentThemeAxes(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const preset = value as { settings?: unknown }
  if (!preset.settings || typeof preset.settings !== 'object' || Array.isArray(preset.settings)) {
    return false
  }

  const settings = preset.settings as { themeStyle?: unknown, colorScheme?: unknown }
  return isReadingThemeStyle(settings.themeStyle) && isReadingColorScheme(settings.colorScheme)
}

function sanitizeSnapshot(value: unknown): ReadingPresetSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const snapshot = value as Partial<ReadingPresetSnapshot> & { theme?: unknown }
  const legacyTheme = migrateLegacyReadingTheme(snapshot.theme)

  return {
    fontSize: matchOption(readingFontSizeOptions, snapshot.fontSize) ?? defaultReadingSettings.fontSize,
    measure: matchOption(readingMeasureOptions, snapshot.measure) ?? defaultReadingSettings.measure,
    lineHeight: matchOption(readingLineHeightOptions, snapshot.lineHeight) ?? defaultReadingSettings.lineHeight,
    letterSpacing: matchOption(readingLetterSpacingOptions, snapshot.letterSpacing) ?? defaultReadingSettings.letterSpacing,
    paragraphGap: matchOption(readingParagraphGapOptions, snapshot.paragraphGap) ?? defaultReadingSettings.paragraphGap,
    pageMargin: matchOption(readingPageMarginOptions, snapshot.pageMargin) ?? defaultReadingSettings.pageMargin,
    fontFamily: isReadingFontFamilyId(snapshot.fontFamily) ? snapshot.fontFamily : defaultReadingSettings.fontFamily,
    themeStyle: isReadingThemeStyle(snapshot.themeStyle)
      ? snapshot.themeStyle
      : legacyTheme.themeStyle ?? defaultReadingSettings.themeStyle,
    colorScheme: isReadingColorScheme(snapshot.colorScheme)
      ? snapshot.colorScheme
      : legacyTheme.colorScheme ?? defaultReadingSettings.colorScheme,
    contrast: matchOption(readingContrastOptions, snapshot.contrast) ?? defaultReadingSettings.contrast,
    outlinePosition: matchOption(readingOutlinePositionOptions, snapshot.outlinePosition) ?? defaultReadingSettings.outlinePosition,
    customTheme: sanitizeCustomTheme(snapshot.customTheme) ?? { ...defaultReadingSettings.customTheme },
  }
}

function matchOption<T extends string>(options: readonly { id: T }[], value: unknown): T | undefined {
  return options.find(option => option.id === value)?.id
}

function sanitizeCustomTheme(value: unknown): ReadingCustomThemeState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const customTheme = value as Partial<ReadingCustomThemeState>

  if (isHexColor(customTheme.bg) && isHexColor(customTheme.fg) && isHexColor(customTheme.accent)) {
    return {
      bg: customTheme.bg.toLowerCase(),
      fg: customTheme.fg.toLowerCase(),
      accent: customTheme.accent.toLowerCase(),
    }
  }

  return null
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}
