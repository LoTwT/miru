import { computed, readonly, reactive } from 'vue'

import {
  clearPersistedReadingSettings,
  clearReadingToken,
  readPersistedReadingSettings,
  setReadingToken,
  writePersistedReadingSettings,
} from '@/lib/theme/tokens'
import type { PersistedReadingSettings, ReadingTokenName } from '@/lib/theme/tokens'

import {
  customizableReadingTokens,
  defaultReadingSettings,
  readingFontFamilyOptions,
  readingFontSizeOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  themeTokenOverridesByChoice,
} from './readingSettingsOptions'
import type {
  ReadingFontFamilyId,
  ReadingFontSizeId,
  ReadingLineHeightId,
  ReadingMeasureId,
  ReadingOutlinePositionId,
  ReadingThemeChoice,
} from './readingSettingsOptions'

export interface ReadingCustomizationState {
  fontSize: ReadingFontSizeId
  measure: ReadingMeasureId
  lineHeight: ReadingLineHeightId
  fontFamily: ReadingFontFamilyId
  theme: ReadingThemeChoice
  outlinePosition: ReadingOutlinePositionId
}

export function useReadingSettings(options: {
  root?: HTMLElement
  storage?: Storage
} = {}) {
  const root = options.root ?? document.documentElement
  const storage = options.storage ?? localStorage
  const persisted = readPersistedReadingSettings(storage)
  const remoteImageMode = persisted?.remoteImageMode
  const state = reactive<ReadingCustomizationState>(stateFromPersistedSettings(persisted))

  const isDefault = computed(() =>
    state.fontSize === defaultReadingSettings.fontSize
    && state.measure === defaultReadingSettings.measure
    && state.lineHeight === defaultReadingSettings.lineHeight
    && state.fontFamily === defaultReadingSettings.fontFamily
    && state.theme === defaultReadingSettings.theme
    && state.outlinePosition === defaultReadingSettings.outlinePosition,
  )

  function applyCurrent(): void {
    const overrides = buildTokenOverrides(state)

    clearInlineReadingOverrides(root)
    syncThemeAttribute(root, state.theme)

    for (const [token, value] of Object.entries(overrides)) {
      setReadingToken(token as ReadingTokenName, value, root)
    }
  }

  function updateFontSize(value: ReadingFontSizeId): void {
    state.fontSize = value
    commit()
  }

  function updateMeasure(value: ReadingMeasureId): void {
    state.measure = value
    commit()
  }

  function updateLineHeight(value: ReadingLineHeightId): void {
    state.lineHeight = value
    commit()
  }

  function updateFontFamily(value: ReadingFontFamilyId): void {
    state.fontFamily = value
    commit()
  }

  function updateTheme(value: ReadingThemeChoice): void {
    state.theme = value
    commit()
  }

  function updateOutlinePosition(value: ReadingOutlinePositionId): void {
    state.outlinePosition = value
    commit()
  }

  function reset(): void {
    state.fontSize = defaultReadingSettings.fontSize
    state.measure = defaultReadingSettings.measure
    state.lineHeight = defaultReadingSettings.lineHeight
    state.fontFamily = defaultReadingSettings.fontFamily
    state.theme = defaultReadingSettings.theme
    state.outlinePosition = defaultReadingSettings.outlinePosition

    clearInlineReadingOverrides(root)
    syncThemeAttribute(root, state.theme)

    if (remoteImageMode) {
      writePersistedReadingSettings({ version: 1, remoteImageMode }, storage)
      return
    }

    clearPersistedReadingSettings(storage)
  }

  function commit(): void {
    applyCurrent()
    persist()
  }

  function persist(): void {
    const tokenOverrides = buildTokenOverrides(state)
    const hasTokenOverrides = Object.keys(tokenOverrides).length > 0
    const hasOutlinePositionOverride = state.outlinePosition !== defaultReadingSettings.outlinePosition

    if (!hasTokenOverrides && state.theme === 'system' && !hasOutlinePositionOverride && !remoteImageMode) {
      clearPersistedReadingSettings(storage)
      return
    }

    const settings: PersistedReadingSettings = {
      version: 1,
      presetId: state.theme,
      tokenOverrides: hasTokenOverrides ? tokenOverrides : undefined,
      fontBody: state.fontFamily === 'sans'
        ? readingFontFamilyOptions.find(option => option.id === 'sans')?.tokenValue
        : undefined,
      remoteImageMode,
      outlinePosition: hasOutlinePositionOverride ? state.outlinePosition : undefined,
    }

    writePersistedReadingSettings(settings, storage)
  }

  return {
    state: readonly(state),
    isDefault,
    applyCurrent,
    reset,
    updateFontSize,
    updateMeasure,
    updateLineHeight,
    updateFontFamily,
    updateTheme,
    updateOutlinePosition,
  }
}

function stateFromPersistedSettings(settings: PersistedReadingSettings | null): ReadingCustomizationState {
  const tokenOverrides = settings?.tokenOverrides

  return {
    fontSize: matchTokenValue(readingFontSizeOptions, tokenOverrides?.['--reading-font-size'])
      ?? defaultReadingSettings.fontSize,
    measure: matchTokenValue(readingMeasureOptions, tokenOverrides?.['--reading-measure'])
      ?? defaultReadingSettings.measure,
    lineHeight: matchTokenValue(readingLineHeightOptions, tokenOverrides?.['--reading-line-height'])
      ?? defaultReadingSettings.lineHeight,
    fontFamily: matchTokenValue(readingFontFamilyOptions, settings?.fontBody ?? tokenOverrides?.['--reading-font-body'])
      ?? defaultReadingSettings.fontFamily,
    theme: isReadingThemeChoice(settings?.presetId) ? settings.presetId : defaultReadingSettings.theme,
    outlinePosition: matchSimpleValue(readingOutlinePositionOptions, settings?.outlinePosition)
      ?? defaultReadingSettings.outlinePosition,
  }
}

function matchTokenValue<T extends string>(
  options: readonly { id: T, tokenValue: string }[],
  value: string | undefined,
): T | undefined {
  return options.find(option => option.tokenValue === value)?.id
}

function matchSimpleValue<T extends string>(
  options: readonly { id: T }[],
  value: string | undefined,
): T | undefined {
  return options.find(option => option.id === value)?.id
}

function buildTokenOverrides(state: ReadingCustomizationState): Record<ReadingTokenName, string> {
  const tokenOverrides: Record<ReadingTokenName, string> = {}

  addTypographyOverride(tokenOverrides, '--reading-font-size', readingFontSizeOptions, state.fontSize, defaultReadingSettings.fontSize)
  addTypographyOverride(tokenOverrides, '--reading-measure', readingMeasureOptions, state.measure, defaultReadingSettings.measure)
  addTypographyOverride(
    tokenOverrides,
    '--reading-line-height',
    readingLineHeightOptions,
    state.lineHeight,
    defaultReadingSettings.lineHeight,
  )
  addTypographyOverride(
    tokenOverrides,
    '--reading-font-body',
    readingFontFamilyOptions,
    state.fontFamily,
    defaultReadingSettings.fontFamily,
  )

  if (state.theme !== 'system') {
    Object.assign(tokenOverrides, themeTokenOverridesByChoice[state.theme])
  }

  return tokenOverrides
}

function addTypographyOverride<T extends string>(
  tokenOverrides: Record<ReadingTokenName, string>,
  token: ReadingTokenName,
  options: readonly { id: T, tokenValue: string }[],
  value: T,
  defaultValue: T,
): void {
  if (value === defaultValue) {
    return
  }

  const tokenValue = options.find(option => option.id === value)?.tokenValue

  if (tokenValue) {
    tokenOverrides[token] = tokenValue
  }
}

function clearInlineReadingOverrides(root: HTMLElement): void {
  for (const token of customizableReadingTokens) {
    clearReadingToken(token, root)
  }
}

function isReadingThemeChoice(value: unknown): value is ReadingThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'sepia'
}

function syncThemeAttribute(root: HTMLElement, theme: ReadingThemeChoice): void {
  if (theme === 'system') {
    delete root.dataset.readingTheme
    return
  }

  root.dataset.readingTheme = theme
}
