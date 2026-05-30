import { computed, readonly, reactive, shallowRef } from 'vue'

import {
  clearPersistedReadingSettings,
  clearReadingToken,
  readPersistedReadingSettings,
  setReadingToken,
  writePersistedReadingSettings,
} from '@/lib/theme/tokens'
import type { PersistedReadingSettings, ReadingTokenName } from '@/lib/theme/tokens'

import {
  createLocalFontFamilyId,
  customizableReadingTokens,
  defaultReadingSettings,
  deriveCustomThemeTokenOverrides,
  fixCustomThemeToAA,
  isLocalFontFamilyId,
  isReadingFontFamilyId,
  localFontIdFromFamilyId,
  normalizeHexColor,
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
  PresetReadingThemeChoice,
  ReadingContrastId,
  ReadingCustomThemeState,
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
import {
  arePresetSnapshotsEqual,
  createReadingPresetId,
  createSnapshotFromSettings,
  normalizePresetName,
  readPersistedReadingPresets,
  writePersistedReadingPresets,
} from './readingPresets'
import type { ReadingPreset, ReadingPresetSnapshot } from './readingPresets'
import {
  createLocalFontFace,
  createLocalFontFaceFamily,
  createLocalFontOption,
  createLocalFontStore,
  normalizeLocalFontName,
  validateLocalFontFile,
} from './localFonts'
import type { LocalFontOption, LocalFontRecord } from './localFonts'

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
  customTheme: ReadingCustomThemeState
}

export interface ReadingSettingsMessage {
  kind: 'info' | 'warning' | 'error'
  text: string
}

export function useReadingSettings(options: {
  root?: HTMLElement
  storage?: Storage
  localFontStore?: ReturnType<typeof createLocalFontStore>
} = {}) {
  const root = options.root ?? document.documentElement
  const storage = options.storage ?? localStorage
  const localFontStore = options.localFontStore ?? createLocalFontStore()
  const persisted = readPersistedReadingSettings(storage)
  const remoteImageMode = persisted?.remoteImageMode
  const state = reactive<ReadingCustomizationState>(stateFromPersistedSettings(persisted))
  const presets = shallowRef<ReadingPreset[]>(readPersistedReadingPresets(storage))
  const localFonts = shallowRef<LocalFontOption[]>([])
  const localFontMessage = shallowRef<ReadingSettingsMessage | null>(null)

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
    && state.outlinePosition === defaultReadingSettings.outlinePosition
    && isSameCustomTheme(state.customTheme, defaultReadingSettings.customTheme),
  )
  const activePresetName = computed(() => {
    if (isDefault.value) {
      return '默认'
    }

    const currentSnapshot = createSnapshotFromSettings(state)
    return presets.value.find(preset => arePresetSnapshotsEqual(preset.settings, currentSnapshot))?.name ?? '自定义（未保存）'
  })

  async function initializeLocalFonts(): Promise<void> {
    const records = await localFontStore.listFonts()
    const registeredFonts: LocalFontOption[] = []

    for (const record of records) {
      const registered = await registerLocalFont(record)

      if (registered) {
        registeredFonts.push(registered)
      }
    }

    localFonts.value = registeredFonts
    const normalizedFontFamily = fallbackMissingLocalFont(state.fontFamily, localFonts.value)

    if (normalizedFontFamily !== state.fontFamily) {
      state.fontFamily = normalizedFontFamily
      commit()
      return
    }

    applyCurrent()
  }

  function applyCurrent(): void {
    const overrides = buildTokenOverrides(state, localFonts.value)

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
    state.fontFamily = fallbackMissingLocalFont(value, localFonts.value)
    commit()
  }

  function updateTheme(value: ReadingThemeChoice): void {
    state.theme = value
    commit()
  }

  function updateCustomTheme(value: Partial<ReadingCustomThemeState>): void {
    state.customTheme = {
      ...state.customTheme,
      ...normalizeCustomTheme(value),
    }
    commit()
  }

  function autoFixCustomTheme(): void {
    state.customTheme = fixCustomThemeToAA(state.customTheme)
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
    state.customTheme = { ...defaultReadingSettings.customTheme }

    clearInlineReadingOverrides(root)
    syncThemeAttribute(root, state.theme)
    syncContrastAttribute(root, state.contrast)

    if (remoteImageMode) {
      writePersistedReadingSettings({ version: 1, remoteImageMode }, storage)
      return
    }

    clearPersistedReadingSettings(storage)
  }

  function savePreset(name: string): ReadingPreset | null {
    const normalizedName = normalizePresetName(name)

    if (!normalizedName || hasPresetName(normalizedName)) {
      return null
    }

    const timestamp = new Date().toISOString()
    const preset: ReadingPreset = {
      id: createReadingPresetId(),
      name: normalizedName,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: createSnapshotFromSettings(state),
    }

    presets.value = [preset, ...presets.value]
    persistPresets()
    return preset
  }

  function applyPreset(id: string): boolean {
    const preset = presets.value.find(item => item.id === id)

    if (!preset) {
      return false
    }

    applySnapshotToState(state, preset.settings, localFonts.value)
    commit()
    return true
  }

  async function uploadLocalFont(file: File): Promise<boolean> {
    const validation = validateLocalFontFile(file)

    if (!validation.ok) {
      localFontMessage.value = { kind: 'error', text: validation.error }
      return false
    }

    const name = normalizeLocalFontName(file.name)

    if (!name) {
      localFontMessage.value = { kind: 'error', text: '字体名称不能为空。' }
      return false
    }

    if (hasLocalFontName(name)) {
      localFontMessage.value = { kind: 'error', text: '已有同名字体,请先重命名或删除。' }
      return false
    }

    let record: LocalFontRecord

    try {
      const fileBlob = new Blob([await file.arrayBuffer()], { type: file.type })
      record = await localFontStore.addFont({
        file: fileBlob,
        fileName: file.name,
        mimeType: file.type,
        name,
      })
    }
    catch {
      localFontMessage.value = { kind: 'error', text: '字体无法保存到本机,请稍后再试。' }
      return false
    }

    const registered = await registerLocalFont(record)

    if (!registered) {
      await localFontStore.deleteFont(record.id)
      localFontMessage.value = { kind: 'error', text: '字体无法解析,请换一个字体文件。' }
      return false
    }

    localFonts.value = [...localFonts.value, registered]
    state.fontFamily = createLocalFontFamilyId(registered.id)
    localFontMessage.value = validation.warning
      ? { kind: 'warning', text: validation.warning }
      : { kind: 'info', text: `已添加字体「${registered.name}」。` }
    commit()
    return true
  }

  async function renameLocalFont(id: string, name: string): Promise<boolean> {
    const normalizedName = normalizeLocalFontName(name)

    if (!normalizedName) {
      localFontMessage.value = { kind: 'error', text: '字体名称不能为空。' }
      return false
    }

    if (hasLocalFontName(normalizedName, id)) {
      localFontMessage.value = { kind: 'error', text: '已有同名字体,不会覆盖。' }
      return false
    }

    const nextRecord = await localFontStore.renameFont(id, normalizedName)

    if (!nextRecord) {
      localFontMessage.value = { kind: 'error', text: '没有找到这个字体。' }
      return false
    }

    const nextOption = createLocalFontOption(nextRecord)
    localFonts.value = localFonts.value.map(font => font.id === id ? nextOption : font)
    localFontMessage.value = { kind: 'info', text: `已重命名为「${nextOption.name}」。` }
    return true
  }

  async function deleteLocalFont(id: string): Promise<boolean> {
    const existing = localFonts.value.find(font => font.id === id)

    if (!existing) {
      localFontMessage.value = { kind: 'error', text: '没有找到这个字体。' }
      return false
    }

    await localFontStore.deleteFont(id)
    unloadLocalFontFace(id)
    localFonts.value = localFonts.value.filter(font => font.id !== id)

    if (state.fontFamily === createLocalFontFamilyId(id)) {
      state.fontFamily = defaultReadingSettings.fontFamily
      commit()
    }

    localFontMessage.value = { kind: 'info', text: `已删除字体「${existing.name}」。` }
    return true
  }

  function renamePreset(id: string, name: string): boolean {
    const normalizedName = normalizePresetName(name)

    if (!normalizedName || hasPresetName(normalizedName, id)) {
      return false
    }

    const presetExists = presets.value.some(preset => preset.id === id)

    if (!presetExists) {
      return false
    }

    const timestamp = new Date().toISOString()
    const nextPresets = presets.value.map((preset) => {
      if (preset.id !== id) {
        return preset
      }

      return {
        ...preset,
        name: normalizedName,
        updatedAt: timestamp,
      }
    })

    presets.value = nextPresets
    persistPresets()
    return true
  }

  function deletePreset(id: string): boolean {
    const nextPresets = presets.value.filter(preset => preset.id !== id)

    if (nextPresets.length === presets.value.length) {
      return false
    }

    presets.value = nextPresets
    persistPresets()
    return true
  }

  function hasPresetName(name: string, ignoredPresetId?: string): boolean {
    const normalizedName = normalizePresetName(name).toLowerCase()
    return presets.value.some(preset => preset.id !== ignoredPresetId && preset.name.toLowerCase() === normalizedName)
  }

  function hasLocalFontName(name: string, ignoredFontId?: string): boolean {
    const normalizedName = normalizeLocalFontName(name).toLowerCase()
    return localFonts.value.some(font => font.id !== ignoredFontId && font.name.toLowerCase() === normalizedName)
  }

  function persistPresets(): void {
    writePersistedReadingPresets(presets.value, storage)
  }

  function commit(): void {
    applyCurrent()
    persist()
  }

  function persist(): void {
    const tokenOverrides = buildTokenOverrides(state, localFonts.value)
    const hasTokenOverrides = Object.keys(tokenOverrides).length > 0
    const hasOutlinePositionOverride = state.outlinePosition !== defaultReadingSettings.outlinePosition
    const hasContrastOverride = state.contrast !== defaultReadingSettings.contrast
    const hasCustomThemeOverride = !isSameCustomTheme(state.customTheme, defaultReadingSettings.customTheme)

    if (
      !hasTokenOverrides
      && state.theme === 'system'
      && !hasOutlinePositionOverride
      && !hasContrastOverride
      && !hasCustomThemeOverride
      && !remoteImageMode
    ) {
      clearPersistedReadingSettings(storage)
      return
    }

    const settings: PersistedReadingSettings = {
      version: 1,
      presetId: state.theme,
      tokenOverrides: hasTokenOverrides ? tokenOverrides : undefined,
      fontFamily: isLocalFontFamilyId(state.fontFamily) ? state.fontFamily : undefined,
      customTheme: hasCustomThemeOverride || state.theme === 'custom'
        ? { ...state.customTheme }
        : undefined,
      remoteImageMode,
      contrast: hasContrastOverride ? state.contrast : undefined,
      outlinePosition: hasOutlinePositionOverride ? state.outlinePosition : undefined,
    }

    writePersistedReadingSettings(settings, storage)
  }

  return {
    state: readonly(state),
    presets: readonly(presets),
    localFonts: readonly(localFonts),
    localFontMessage: readonly(localFontMessage),
    isDefault,
    activePresetName,
    initializeLocalFonts,
    applyCurrent,
    reset,
    savePreset,
    applyPreset,
    renamePreset,
    deletePreset,
    uploadLocalFont,
    renameLocalFont,
    deleteLocalFont,
    updateFontSize,
    updateMeasure,
    updateLineHeight,
    updateLetterSpacing,
    updateParagraphGap,
    updatePageMargin,
    updateFontFamily,
    updateTheme,
    updateCustomTheme,
    autoFixCustomTheme,
    updateContrast,
    updateOutlinePosition,
  }
}

async function registerLocalFont(record: LocalFontRecord): Promise<LocalFontOption | null> {
  try {
    const fontFace = await createLocalFontFace(record)
    document.fonts.add(fontFace)
    return createLocalFontOption(record)
  }
  catch {
    return null
  }
}

function unloadLocalFontFace(id: string): void {
  const fontFaceFamily = createLocalFontFaceFamily(id)

  for (const fontFace of Array.from(document.fonts)) {
    if (fontFace.family === fontFaceFamily) {
      document.fonts.delete(fontFace)
    }
  }
}

function applySnapshotToState(
  state: ReadingCustomizationState,
  snapshot: ReadingPresetSnapshot,
  localFonts: readonly LocalFontOption[],
): void {
  state.fontSize = snapshot.fontSize
  state.measure = snapshot.measure
  state.lineHeight = snapshot.lineHeight
  state.letterSpacing = snapshot.letterSpacing
  state.paragraphGap = snapshot.paragraphGap
  state.pageMargin = snapshot.pageMargin
  state.fontFamily = fallbackMissingLocalFont(snapshot.fontFamily, localFonts)
  state.theme = snapshot.theme
  state.contrast = snapshot.contrast
  state.outlinePosition = snapshot.outlinePosition
  state.customTheme = { ...snapshot.customTheme }
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
    fontFamily: isReadingFontFamilyId(settings?.fontFamily)
      ? settings.fontFamily
      : matchTokenValue(readingFontFamilyOptions, tokenOverrides?.['--reading-font-body'] ?? settings?.fontBody)
      ?? defaultReadingSettings.fontFamily,
    theme: isReadingThemeChoice(settings?.presetId) ? settings.presetId : defaultReadingSettings.theme,
    contrast: isReadingContrast(settings?.contrast) ? settings.contrast : defaultReadingSettings.contrast,
    outlinePosition: matchSimpleValue(readingOutlinePositionOptions, settings?.outlinePosition)
      ?? defaultReadingSettings.outlinePosition,
    customTheme: stateCustomThemeFromPersisted(settings),
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

function buildTokenOverrides(
  state: ReadingCustomizationState,
  localFonts: readonly LocalFontOption[] = [],
): Record<ReadingTokenName, string> {
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
  addFontFamilyOverride(tokenOverrides, state.fontFamily, localFonts)

  if (state.theme === 'custom') {
    Object.assign(tokenOverrides, deriveCustomThemeTokenOverrides(state.customTheme))
  }
  else if (state.theme !== 'system') {
    Object.assign(tokenOverrides, resolveThemeTokenOverrides(state.theme as PresetReadingThemeChoice, state.contrast))
  }

  return tokenOverrides
}

function addFontFamilyOverride(
  tokenOverrides: Record<ReadingTokenName, string>,
  value: ReadingFontFamilyId,
  localFonts: readonly LocalFontOption[],
): void {
  if (value === defaultReadingSettings.fontFamily) {
    return
  }

  const tokenValue = resolveFontFamilyTokenValue(value, localFonts)

  if (tokenValue) {
    tokenOverrides['--reading-font-body'] = tokenValue
  }
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

function resolveFontFamilyTokenValue(
  value: ReadingFontFamilyId,
  localFonts: readonly LocalFontOption[],
): string | undefined {
  if (isLocalFontFamilyId(value)) {
    const localFontId = localFontIdFromFamilyId(value)
    return localFonts.find(font => font.id === localFontId)?.fontStack
  }

  return readingFontFamilyOptions.find(option => option.id === value)?.tokenValue
}

function fallbackMissingLocalFont(
  value: ReadingFontFamilyId,
  localFonts: readonly LocalFontOption[],
): ReadingFontFamilyId {
  if (!isLocalFontFamilyId(value)) {
    return value
  }

  const localFontId = localFontIdFromFamilyId(value)
  return localFonts.some(font => font.id === localFontId) ? value : defaultReadingSettings.fontFamily
}

function clearInlineReadingOverrides(root: HTMLElement): void {
  for (const token of customizableReadingTokens) {
    clearReadingToken(token, root)
  }
}

function stateCustomThemeFromPersisted(settings: PersistedReadingSettings | null): ReadingCustomThemeState {
  if (settings?.customTheme) {
    return { ...settings.customTheme }
  }

  const tokenOverrides = settings?.tokenOverrides
  const bg = normalizeHexColor(tokenOverrides?.['--reading-bg'])
  const fg = normalizeHexColor(tokenOverrides?.['--reading-fg'])
  const accent = normalizeHexColor(tokenOverrides?.['--reading-accent'])

  if (settings?.presetId === 'custom' && bg && fg && accent) {
    return { bg, fg, accent }
  }

  return { ...defaultReadingSettings.customTheme }
}

function normalizeCustomTheme(value: Partial<ReadingCustomThemeState>): Partial<ReadingCustomThemeState> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, color]) => [key, normalizeHexColor(color)])
      .filter((entry): entry is [keyof ReadingCustomThemeState, string] => typeof entry[1] === 'string'),
  ) as Partial<ReadingCustomThemeState>
}

function isSameCustomTheme(
  customTheme: ReadingCustomThemeState,
  otherCustomTheme: ReadingCustomThemeState,
): boolean {
  return customTheme.bg === otherCustomTheme.bg
    && customTheme.fg === otherCustomTheme.fg
    && customTheme.accent === otherCustomTheme.accent
}

function isReadingThemeChoice(value: unknown): value is ReadingThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'sepia' || value === 'custom'
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
