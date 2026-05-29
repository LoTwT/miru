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
  readingLetterSpacingOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingPageMarginOptions,
  readingOutlinePositionOptions,
  readingParagraphGapOptions,
  resolveThemeTokenOverrides,
} from './readingSettingsOptions'
import type {
  ReadingContrastId,
  ReadingFontFamilyId,
  ReadingFontSizeId,
  ReadingLetterSpacingId,
  ReadingLineHeightId,
  ReadingMeasureId,
  ReadingPageMarginId,
  ReadingParagraphGapId,
  ReadingOutlinePositionId,
  ReadingThemeChoice,
} from './readingSettingsOptions'

export interface ReadingCustomizationState {
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
    && state.letterSpacing === defaultReadingSettings.letterSpacing
    && state.paragraphGap === defaultReadingSettings.paragraphGap
    && state.pageMargin === defaultReadingSettings.pageMargin
    && state.fontFamily === defaultReadingSettings.fontFamily
    && state.theme === defaultReadingSettings.theme
    && state.contrast === defaultReadingSettings.contrast
    && state.outlinePosition === defaultReadingSettings.outlinePosition,
  )

  function applyCurrent(): void {
    const overrides = buildTokenOverrides(state)

    clearInlineReadingOverrides(root)
    syncThemeAttribute(root, state.theme)
    syncContrastAttribute(root, state.contrast)

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

  function updateLetterSpacing(value: ReadingLetterSpacingId): void {
    state.letterSpacing = value
    commit()
  }

  function updateParagraphGap(value: ReadingParagraphGapId): void {
    state.paragraphGap = value
    commit()
  }

  function updatePageMargin(value: ReadingPageMarginId): void {
    state.pageMargin = value
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

  function updateContrast(value: ReadingContrastId): void {
    state.contrast = value
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
    state.letterSpacing = defaultReadingSettings.letterSpacing
    state.paragraphGap = defaultReadingSettings.paragraphGap
    state.pageMargin = defaultReadingSettings.pageMargin
    state.fontFamily = defaultReadingSettings.fontFamily
    state.theme = defaultReadingSettings.theme
    state.contrast = defaultReadingSettings.contrast
    state.outlinePosition = defaultReadingSettings.outlinePosition

    clearInlineReadingOverrides(root)
    syncThemeAttribute(root, state.theme)
    syncContrastAttribute(root, state.contrast)

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
    const hasContrastOverride = state.contrast !== defaultReadingSettings.contrast

    if (!hasTokenOverrides && state.theme === 'system' && !hasOutlinePositionOverride && !hasContrastOverride && !remoteImageMode) {
      clearPersistedReadingSettings(storage)
      return
    }

    const settings: PersistedReadingSettings = {
      version: 1,
      presetId: state.theme,
      tokenOverrides: hasTokenOverrides ? tokenOverrides : undefined,
      remoteImageMode,
      contrast: hasContrastOverride ? state.contrast : undefined,
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
    updateLetterSpacing,
    updateParagraphGap,
    updatePageMargin,
    updateFontFamily,
    updateTheme,
    updateContrast,
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
    letterSpacing: matchTokenValue(readingLetterSpacingOptions, tokenOverrides?.['--reading-letter-spacing'])
      ?? defaultReadingSettings.letterSpacing,
    paragraphGap: matchTokenValue(readingParagraphGapOptions, tokenOverrides?.['--reading-paragraph-gap'])
      ?? defaultReadingSettings.paragraphGap,
    pageMargin: matchTokenValue(readingPageMarginOptions, tokenOverrides?.['--reading-page-margin'])
      ?? defaultReadingSettings.pageMargin,
    fontFamily: matchTokenValue(readingFontFamilyOptions, tokenOverrides?.['--reading-font-body'] ?? settings?.fontBody)
      ?? defaultReadingSettings.fontFamily,
    theme: isReadingThemeChoice(settings?.presetId) ? settings.presetId : defaultReadingSettings.theme,
    contrast: isReadingContrast(settings?.contrast) ? settings.contrast : defaultReadingSettings.contrast,
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
    '--reading-letter-spacing',
    readingLetterSpacingOptions,
    state.letterSpacing,
    defaultReadingSettings.letterSpacing,
  )
  addTypographyOverride(
    tokenOverrides,
    '--reading-paragraph-gap',
    readingParagraphGapOptions,
    state.paragraphGap,
    defaultReadingSettings.paragraphGap,
  )
  addTypographyOverride(
    tokenOverrides,
    '--reading-page-margin',
    readingPageMarginOptions,
    state.pageMargin,
    defaultReadingSettings.pageMargin,
  )
  addTypographyOverride(
    tokenOverrides,
    '--reading-font-body',
    readingFontFamilyOptions,
    state.fontFamily,
    defaultReadingSettings.fontFamily,
  )

  if (state.theme !== 'system') {
    Object.assign(tokenOverrides, resolveThemeTokenOverrides(state.theme, state.contrast))
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

function isReadingContrast(value: unknown): value is ReadingContrastId {
  return value === 'soft' || value === 'standard' || value === 'strong'
}

function syncThemeAttribute(root: HTMLElement, theme: ReadingThemeChoice): void {
  if (theme === 'system') {
    delete root.dataset.readingTheme
    return
  }

  root.dataset.readingTheme = theme
}

function syncContrastAttribute(root: HTMLElement, contrast: ReadingContrastId): void {
  if (contrast === 'standard') {
    delete root.dataset.readingContrast
    return
  }

  root.dataset.readingContrast = contrast
}
