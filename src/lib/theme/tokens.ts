import {
  createReadingCompatibilityRevision,
  isReadingColorScheme,
  isReadingContrast,
  legacyReadingSettingsStorageKey,
  readingSettingsStorageKey,
  parseStoredReadingThemeCandidate,
  resolveReadingThemeState,
  sanitizeStoredCustomTheme,
  sanitizeStoredReadingTokenOverrides,
  selectStoredReadingThemeCandidate,
} from './readingThemeContract'
import type {
  ReadingTokenName,
  StoredReadingThemeCandidate,
  StoredReadingThemeReadResult,
} from './readingThemeContract'

export {
  legacyReadingSettingsStorageKey,
  migrateLegacyReadingTheme,
  readingPaletteTokenNames,
  readingSettingsStorageKey,
  readingTypographyTokenNames,
} from './readingThemeContract'
export type { ReadingTokenName } from './readingThemeContract'

export interface PersistedReadingSettings {
  version: 2
  themeStyle?: 'brutal' | 'default'
  colorScheme?: 'system' | 'light' | 'dark' | 'sepia' | 'custom'
  tokenOverrides?: Record<ReadingTokenName, string>
  fontFamily?: string
  fontBody?: string
  customTheme?: {
    bg: string
    fg: string
    accent: string
  }
  remoteImageMode?: 'auto' | 'prompt' | 'block'
  contrast?: 'soft' | 'standard' | 'strong'
  outlinePosition?: 'left' | 'right'
}

export function setReadingToken(token: `--reading-${string}`, value: string, root: HTMLElement = document.documentElement): void {
  root.style.setProperty(token, value)
}

export function clearReadingToken(token: ReadingTokenName, root: HTMLElement = document.documentElement): void {
  root.style.removeProperty(token)
}

export function writePersistedReadingSettings(
  settings: PersistedReadingSettings,
  storage: Storage = localStorage,
): void {
  const compatibilityRevision = createReadingCompatibilityRevision()

  storage.setItem(
    legacyReadingSettingsStorageKey,
    JSON.stringify(createLegacyReadingSettings(settings, compatibilityRevision)),
  )
  storage.setItem(readingSettingsStorageKey, JSON.stringify({
    ...settings,
    compatibilityRevision,
  }))
}

export function clearPersistedReadingSettings(storage: Storage = localStorage): void {
  storage.removeItem(legacyReadingSettingsStorageKey)
  storage.removeItem(readingSettingsStorageKey)
}

export function readPersistedReadingSettings(storage: Storage = localStorage): PersistedReadingSettings | null {
  const primary = readStoredReadingSettings(storage, readingSettingsStorageKey, 2)
  const legacy = readStoredReadingSettings(storage, legacyReadingSettingsStorageKey, 1)
  const selected = selectStoredReadingThemeCandidate(primary, legacy)

  return selected ? sanitizeReadingSettings(selected) : null
}

function readStoredReadingSettings(
  storage: Storage,
  storageKey: string,
  expectedVersion: 1 | 2,
): StoredReadingThemeReadResult {
  try {
    return parseStoredReadingThemeCandidate(storage.getItem(storageKey), expectedVersion)
  }
  catch {
    return { status: 'invalid' }
  }
}

function sanitizeReadingSettings(parsed: StoredReadingThemeCandidate): PersistedReadingSettings {
  const resolvedTheme = resolveReadingThemeState(parsed, false)

  return {
    version: 2,
    themeStyle: resolvedTheme.themeStyle,
    colorScheme: resolvedTheme.colorScheme,
    tokenOverrides: sanitizeStoredReadingTokenOverrides(parsed.tokenOverrides),
    fontFamily: typeof parsed.fontFamily === 'string' ? parsed.fontFamily : undefined,
    fontBody: typeof parsed.fontBody === 'string' ? parsed.fontBody : undefined,
    customTheme: sanitizeStoredCustomTheme(parsed.customTheme),
    remoteImageMode: isRemoteImageMode(parsed.remoteImageMode) ? parsed.remoteImageMode : undefined,
    contrast: isReadingContrast(parsed.contrast) ? parsed.contrast : undefined,
    outlinePosition: isOutlinePosition(parsed.outlinePosition) ? parsed.outlinePosition : undefined,
  }
}

function createLegacyReadingSettings(
  settings: PersistedReadingSettings,
  compatibilityRevision: string,
) {
  return {
    version: 1 as const,
    presetId: isReadingColorScheme(settings.colorScheme)
      ? settings.colorScheme
      : undefined,
    themeStyle: settings.themeStyle,
    colorScheme: settings.colorScheme,
    tokenOverrides: settings.tokenOverrides,
    fontFamily: settings.fontFamily,
    fontBody: settings.fontBody,
    customTheme: settings.customTheme,
    remoteImageMode: settings.remoteImageMode,
    contrast: settings.contrast,
    outlinePosition: settings.outlinePosition,
    compatibilityRevision,
  }
}

function isRemoteImageMode(value: unknown): value is PersistedReadingSettings['remoteImageMode'] {
  return value === 'auto' || value === 'prompt' || value === 'block'
}

function isOutlinePosition(value: unknown): value is PersistedReadingSettings['outlinePosition'] {
  return value === 'left' || value === 'right'
}
