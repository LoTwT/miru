import {
  defaultReadingSettings,
  readingContrastOptions,
  readingFontFamilyOptions,
  readingFontSizeOptions,
  readingLetterSpacingOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  readingPageMarginOptions,
  readingParagraphGapOptions,
} from './readingSettingsOptions'
import type {
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
  ReadingThemeChoice,
} from './readingSettingsOptions'

export interface ReadingPresetSnapshot {
  fontSize: ReadingFontSizeId
  measure: ReadingMeasureId
  lineHeight: ReadingLineHeightId
  letterSpacing: ReadingLetterSpacingId
  paragraphGap: ReadingParagraphGapId
  pageMargin: ReadingPageMarginId
  fontFamily: ReadingFontFamilyId
  theme: ReadingThemeChoice
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

interface PersistedReadingPresets {
  version: 1
  presets: ReadingPreset[]
}

const readingPresetsStorageKey = 'miru:reading-presets:v1'
const maxPresetNameLength = 32

export function readPersistedReadingPresets(storage: Storage = localStorage): ReadingPreset[] {
  const raw = storage.getItem(readingPresetsStorageKey)

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedReadingPresets>

    if (parsed.version !== 1 || !Array.isArray(parsed.presets)) {
      return []
    }

    return parsed.presets
      .map(sanitizePreset)
      .filter((preset): preset is ReadingPreset => Boolean(preset))
  }
  catch {
    return []
  }
}

export function writePersistedReadingPresets(presets: readonly ReadingPreset[], storage: Storage = localStorage): void {
  if (presets.length === 0) {
    storage.removeItem(readingPresetsStorageKey)
    return
  }

  storage.setItem(readingPresetsStorageKey, JSON.stringify({
    version: 1,
    presets,
  }))
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
    theme: settings.theme,
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
    && snapshot.theme === otherSnapshot.theme
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

function sanitizeSnapshot(value: unknown): ReadingPresetSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const snapshot = value as Partial<ReadingPresetSnapshot>

  return {
    fontSize: matchOption(readingFontSizeOptions, snapshot.fontSize) ?? defaultReadingSettings.fontSize,
    measure: matchOption(readingMeasureOptions, snapshot.measure) ?? defaultReadingSettings.measure,
    lineHeight: matchOption(readingLineHeightOptions, snapshot.lineHeight) ?? defaultReadingSettings.lineHeight,
    letterSpacing: matchOption(readingLetterSpacingOptions, snapshot.letterSpacing) ?? defaultReadingSettings.letterSpacing,
    paragraphGap: matchOption(readingParagraphGapOptions, snapshot.paragraphGap) ?? defaultReadingSettings.paragraphGap,
    pageMargin: matchOption(readingPageMarginOptions, snapshot.pageMargin) ?? defaultReadingSettings.pageMargin,
    fontFamily: matchOption(readingFontFamilyOptions, snapshot.fontFamily) ?? defaultReadingSettings.fontFamily,
    theme: isReadingThemeChoice(snapshot.theme) ? snapshot.theme : defaultReadingSettings.theme,
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

function isReadingThemeChoice(value: unknown): value is ReadingThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'sepia' || value === 'custom'
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}
