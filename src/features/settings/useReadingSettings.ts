import { computed, readonly, reactive, shallowRef } from 'vue'

import {
  clearPersistedReadingSettings,
  clearReadingToken,
  readPersistedReadingSettings,
  setReadingToken,
  writePersistedReadingSettings,
} from '@/lib/theme/tokens'
import type { PersistedReadingSettings, ReadingTokenName } from '@/lib/theme/tokens'
import { loadOptionalReadingFont } from '@/lib/theme/fonts'
import {
  applyResolvedReadingTheme,
  isReadingContrast,
  resolveReadingThemeState,
} from '@/lib/theme/readingThemeContract'
import type { ReadingPalette } from '@/lib/theme/readingThemeContract'

import {
  createLocalFontFamilyId,
  createLocalFontFaceFamily,
  customizableReadingTokens,
  defaultReadingSettings,
  fixCustomThemeToAA,
  isReadingColorScheme,
  isLocalFontFamilyId,
  isReadingFontFamilyId,
  isReadingThemeStyle,
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
  ReadingPageMarginId,
  ReadingParagraphGapId,
  ReadingOutlinePositionId,
  ReadingThemeStyleId,
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
import type { createLocalFontStore, LocalFontOption, LocalFontRecord } from './localFonts'

type LocalFontStore = ReturnType<typeof createLocalFontStore>
type LocalFontsModule = typeof import('./localFonts')
type LocalFontRegistrationResult =
  | { status: 'ready', option: LocalFontOption }
  | { status: 'invalid' | 'unavailable' }
type EnsuredLocalFontResult = 'ready' | 'missing' | 'invalid' | 'unavailable' | 'stale'

export interface ReadingCustomizationState {
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

export interface ReadingSettingsMessage {
  kind: 'info' | 'warning' | 'error'
  text: string
}

export function useReadingSettings(options: {
  root?: HTMLElement
  storage?: Storage
  localFontStore?: LocalFontStore
  loadLocalFontsModule?: () => Promise<LocalFontsModule>
  systemDark?: boolean
} = {}) {
  const root = options.root ?? document.documentElement
  const storage = options.storage ?? localStorage
  const providedLocalFontStore = options.localFontStore
  const loadLocalFonts = options.loadLocalFontsModule ?? loadLocalFontsModule
  const systemDark = shallowRef(options.systemDark ?? resolveSystemDarkScheme())
  const persisted = readPersistedReadingSettings(storage)
  const remoteImageMode = persisted?.remoteImageMode
  const state = reactive<ReadingCustomizationState>(stateFromPersistedSettings(persisted))
  const presets = shallowRef<ReadingPreset[]>(readPersistedReadingPresets(storage))
  const localFonts = shallowRef<LocalFontOption[]>([])
  const localFontMessage = shallowRef<ReadingSettingsMessage | null>(null)
  const registeredLocalFontIds = new Set<string>()
  const pendingLocalFontRegistrations = new Map<string, Promise<EnsuredLocalFontResult>>()
  const localFontRegistrationGenerations = new Map<string, number>()
  let localFontStorePromise: Promise<LocalFontStore> | null = null
  let localFontsInitializationPromise: Promise<void> | null = null
  let fontFamilyLoadSequence = 0
  let localFontCollectionRevision = 0
  let localFontOperationSequence = 0
  let localFontUploadSequence = 0
  const resolvedTheme = computed(() => resolveReadingThemeState({
    version: 2,
    themeStyle: state.themeStyle,
    colorScheme: state.colorScheme,
    contrast: state.contrast,
    customTheme: state.customTheme,
  }, systemDark.value))
  const effectiveColorScheme = computed<'light' | 'dark'>(() => resolvedTheme.value.effectiveColorScheme)
  const hasActiveLocalFont = computed(() => isLocalFontFamilyId(state.fontFamily))

  const isDefault = computed(() =>
    state.fontSize === defaultReadingSettings.fontSize
    && state.measure === defaultReadingSettings.measure
    && state.lineHeight === defaultReadingSettings.lineHeight
    && state.letterSpacing === defaultReadingSettings.letterSpacing
    && state.paragraphGap === defaultReadingSettings.paragraphGap
    && state.pageMargin === defaultReadingSettings.pageMargin
    && state.fontFamily === defaultReadingSettings.fontFamily
    && state.themeStyle === defaultReadingSettings.themeStyle
    && state.colorScheme === defaultReadingSettings.colorScheme
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

  function getLocalFontStore(localFontsModule?: LocalFontsModule): Promise<LocalFontStore> {
    if (providedLocalFontStore) {
      return Promise.resolve(providedLocalFontStore)
    }

    if (localFontStorePromise) {
      return localFontStorePromise
    }

    const loading = (localFontsModule ? Promise.resolve(localFontsModule) : loadLocalFonts())
      .then(({ createLocalFontStore }) => createLocalFontStore())
    localFontStorePromise = loading
    void loading.catch(() => {
      if (localFontStorePromise === loading) {
        localFontStorePromise = null
      }
    })
    return loading
  }

  function initializeLocalFonts(): Promise<void> {
    if (localFontsInitializationPromise) {
      return localFontsInitializationPromise
    }

    const result = performLocalFontInitialization()
    const initialization = result.then(() => undefined)
    localFontsInitializationPromise = initialization
    void result.then((initialized) => {
      if (!initialized && localFontsInitializationPromise === initialization) {
        localFontsInitializationPromise = null
      }
    }, () => {
      if (localFontsInitializationPromise === initialization) {
        localFontsInitializationPromise = null
      }
    })
    return initialization
  }

  async function performLocalFontInitialization(): Promise<boolean> {
    const operationSequence = beginLocalFontOperation()
    const loadSequence = ++fontFamilyLoadSequence
    let localFontsModule: LocalFontsModule

    try {
      localFontsModule = await loadLocalFonts()
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '本地字体资源暂时无法加载。当前阅读不受影响,请重新加载页面后再试。',
      })
      return false
    }

    let localFontStore: LocalFontStore

    try {
      localFontStore = await getLocalFontStore(localFontsModule)
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '本地字体暂时无法读取。已保留当前字体设置,请稍后重试。',
      })
      return false
    }

    while (true) {
      const collectionRevision = localFontCollectionRevision
      let nextLocalFonts: LocalFontOption[]

      try {
        const records = await localFontStore.listFonts()
        nextLocalFonts = records.map(localFontsModule.createLocalFontOption)
      }
      catch {
        setLocalFontMessage(operationSequence, {
          kind: 'error',
          text: '本地字体暂时无法读取。已保留当前字体设置,请稍后重试。',
        })
        return false
      }

      if (collectionRevision !== localFontCollectionRevision) {
        continue
      }

      localFonts.value = nextLocalFonts
      break
    }

    if (loadSequence !== fontFamilyLoadSequence) {
      return true
    }

    let normalizedFontFamily = fallbackMissingLocalFont(state.fontFamily, localFonts.value)

    if (isLocalFontFamilyId(normalizedFontFamily)) {
      const localFontId = localFontIdFromFamilyId(normalizedFontFamily)
      const registration = await ensureLocalFontRegistered(localFontId)
      if (loadSequence !== fontFamilyLoadSequence) {
        if (state.fontFamily !== normalizedFontFamily) {
          unloadLocalFontFace(localFontId)
          registeredLocalFontIds.delete(localFontId)
        }
        return true
      }

      if (registration === 'unavailable') {
        setLocalFontMessage(operationSequence, {
          kind: 'error',
          text: '本地字体暂时无法读取。已保留当前字体设置,请稍后重试。',
        })
        return false
      }

      if (registration === 'stale') {
        return true
      }

      if (registration !== 'ready') {
        normalizedFontFamily = defaultReadingSettings.fontFamily
        setLocalFontMessage(operationSequence, { kind: 'error', text: '当前字体无法加载,已恢复默认字体。' })
      }
    }

    await loadOptionalReadingFont(normalizedFontFamily)
    if (loadSequence !== fontFamilyLoadSequence) {
      return true
    }

    if (normalizedFontFamily !== state.fontFamily) {
      state.fontFamily = normalizedFontFamily
      commit()
      return true
    }

    applyCurrent()
    clearLocalFontMessage(operationSequence)
    return true
  }

  function applyCurrent(): void {
    const currentTheme = resolvedTheme.value
    const overrides = buildTokenOverrides(state, localFonts.value, currentTheme.palette)

    clearInlineReadingOverrides(root)
    applyResolvedReadingTheme(root, currentTheme, resolveThemeColorMeta(root))

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
    const operationSequence = beginLocalFontOperation()
    const loadSequence = ++fontFamilyLoadSequence
    state.fontFamily = fallbackMissingLocalFont(value, localFonts.value)
    void loadOptionalReadingFont(state.fontFamily)
    commit()

    if (isLocalFontFamilyId(state.fontFamily)) {
      void activateLocalFontFamily(state.fontFamily, loadSequence, operationSequence)
    }
  }

  function updateThemeStyle(value: ReadingThemeStyleId): void {
    state.themeStyle = value
    commit()
  }

  function updateColorScheme(value: ReadingColorSchemeId): void {
    state.colorScheme = value
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

  function syncSystemColorScheme(isDark: boolean): void {
    systemDark.value = isDark
    applyResolvedReadingTheme(root, resolvedTheme.value, resolveThemeColorMeta(root))
  }

  function reset(): void {
    fontFamilyLoadSequence += 1
    state.fontSize = defaultReadingSettings.fontSize
    state.measure = defaultReadingSettings.measure
    state.lineHeight = defaultReadingSettings.lineHeight
    state.letterSpacing = defaultReadingSettings.letterSpacing
    state.paragraphGap = defaultReadingSettings.paragraphGap
    state.pageMargin = defaultReadingSettings.pageMargin
    state.fontFamily = defaultReadingSettings.fontFamily
    state.themeStyle = defaultReadingSettings.themeStyle
    state.colorScheme = defaultReadingSettings.colorScheme
    state.contrast = defaultReadingSettings.contrast
    state.outlinePosition = defaultReadingSettings.outlinePosition
    state.customTheme = { ...defaultReadingSettings.customTheme }

    applyCurrent()

    if (remoteImageMode) {
      writePersistedReadingSettings({ version: 2, remoteImageMode }, storage)
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

    const operationSequence = beginLocalFontOperation()
    const loadSequence = ++fontFamilyLoadSequence
    applySnapshotToState(state, preset.settings, localFonts.value)
    void loadOptionalReadingFont(state.fontFamily)
    commit()

    if (isLocalFontFamilyId(state.fontFamily)) {
      void activateLocalFontFamily(state.fontFamily, loadSequence, operationSequence)
    }
    return true
  }

  async function uploadLocalFont(file: File): Promise<boolean> {
    const operationSequence = beginLocalFontOperation()
    const familyLoadSequence = fontFamilyLoadSequence
    const uploadSequence = ++localFontUploadSequence
    let localFontsModule: LocalFontsModule

    try {
      localFontsModule = await loadLocalFonts()
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '本地字体资源暂时无法加载。当前阅读不受影响,请重新加载页面后再试。',
      })
      return false
    }

    const { normalizeLocalFontName, validateLocalFontFile } = localFontsModule
    const validation = validateLocalFontFile(file)

    if (!validation.ok) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: validation.error })
      return false
    }

    const name = normalizeLocalFontName(file.name)

    if (!name) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: '字体名称不能为空。' })
      return false
    }

    if (hasLocalFontName(name)) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: '已有同名字体,请先重命名或删除。' })
      return false
    }

    let record: LocalFontRecord
    let localFontStore: LocalFontStore

    try {
      localFontStore = await getLocalFontStore(localFontsModule)
      record = await localFontStore.addFont({
        file,
        fileName: file.name,
        mimeType: file.type,
        name,
      })
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '字体无法保存到本机,请稍后再试。',
      })
      return false
    }

    const registrationGeneration = localFontRegistrationGenerations.get(record.id) ?? 0
    const registration = await registerLocalFont(record, localFontsModule)

    if ((localFontRegistrationGenerations.get(record.id) ?? 0) !== registrationGeneration) {
      unloadLocalFontFace(record.id)
      registeredLocalFontIds.delete(record.id)
      return false
    }

    if (registration.status !== 'ready') {
      try {
        await localFontStore.deleteFont(record.id)
        localFonts.value = localFonts.value.filter(font => font.id !== record.id)
        localFontCollectionRevision += 1
        setLocalFontMessage(operationSequence, { kind: 'error', text: '字体无法解析,请换一个字体文件。' })
      }
      catch {
        localFonts.value = upsertLocalFontOption(localFonts.value, localFontsModule.createLocalFontOption(record))
        localFontCollectionRevision += 1
        setLocalFontMessage(operationSequence, {
          kind: 'error',
          text: '字体无法解析,且暂时无法从本机删除。已保留在「管理我的字体」中,请稍后删除。',
        })
      }
      return false
    }

    const option = localFonts.value.find(font => font.id === record.id) ?? registration.option
    registeredLocalFontIds.add(record.id)
    localFonts.value = upsertLocalFontOption(localFonts.value, option)
    localFontCollectionRevision += 1
    if (uploadSequence === localFontUploadSequence && familyLoadSequence === fontFamilyLoadSequence) {
      fontFamilyLoadSequence += 1
      state.fontFamily = createLocalFontFamilyId(option.id)
      commit()
    }
    setLocalFontMessage(operationSequence, validation.warning
      ? { kind: 'warning', text: validation.warning }
      : { kind: 'info', text: `已添加字体「${option.name}」。` })
    return true
  }

  async function renameLocalFont(id: string, name: string): Promise<boolean> {
    const operationSequence = beginLocalFontOperation()
    let localFontsModule: LocalFontsModule

    try {
      localFontsModule = await loadLocalFonts()
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '本地字体资源暂时无法加载。当前阅读不受影响,请重新加载页面后再试。',
      })
      return false
    }

    const { createLocalFontOption, normalizeLocalFontName } = localFontsModule
    const normalizedName = normalizeLocalFontName(name)

    if (!normalizedName) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: '字体名称不能为空。' })
      return false
    }

    if (hasLocalFontName(normalizedName, id)) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: '已有同名字体,不会覆盖。' })
      return false
    }

    let nextRecord: Awaited<ReturnType<LocalFontStore['renameFont']>>

    try {
      const localFontStore = await getLocalFontStore(localFontsModule)
      nextRecord = await localFontStore.renameFont(id, normalizedName)
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '字体名称暂时无法保存。原名称已保留,请稍后重试。',
      })
      return false
    }

    if (!nextRecord) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: '没有找到这个字体。' })
      return false
    }

    const nextOption = createLocalFontOption(nextRecord)
    localFonts.value = localFonts.value.map(font => font.id === id ? nextOption : font)
    localFontCollectionRevision += 1
    setLocalFontMessage(operationSequence, { kind: 'info', text: `已重命名为「${nextOption.name}」。` })
    return true
  }

  async function deleteLocalFont(id: string): Promise<boolean> {
    const operationSequence = beginLocalFontOperation()
    const existing = localFonts.value.find(font => font.id === id)

    if (!existing) {
      setLocalFontMessage(operationSequence, { kind: 'error', text: '没有找到这个字体。' })
      return false
    }

    try {
      const localFontStore = await getLocalFontStore()
      await localFontStore.deleteFont(id)
    }
    catch {
      setLocalFontMessage(operationSequence, {
        kind: 'error',
        text: '字体暂时无法删除。当前字体已保留,请稍后重试。',
      })
      return false
    }

    invalidateLocalFontRegistration(id)
    localFonts.value = localFonts.value.filter(font => font.id !== id)
    localFontCollectionRevision += 1

    if (state.fontFamily === createLocalFontFamilyId(id)) {
      fontFamilyLoadSequence += 1
      state.fontFamily = defaultReadingSettings.fontFamily
      commit()
    }

    setLocalFontMessage(operationSequence, { kind: 'info', text: `已删除字体「${existing.name}」。` })
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
    const normalizedName = name.toLowerCase()
    return localFonts.value.some(font => font.id !== ignoredFontId && font.name.toLowerCase() === normalizedName)
  }

  function persistPresets(): void {
    writePersistedReadingPresets(presets.value, storage)
  }

  function commit(): void {
    applyCurrent()
    persist()
  }

  async function activateLocalFontFamily(
    fontFamily: ReadingFontFamilyId,
    loadSequence: number,
    operationSequence: number,
  ): Promise<void> {
    if (!isLocalFontFamilyId(fontFamily)) {
      return
    }

    const localFontId = localFontIdFromFamilyId(fontFamily)

    const registration = await ensureLocalFontRegistered(localFontId)

    if (loadSequence !== fontFamilyLoadSequence || state.fontFamily !== fontFamily) {
      return
    }

    if (registration === 'unavailable' || registration === 'stale') {
      if (registration === 'unavailable') {
        setLocalFontMessage(operationSequence, {
          kind: 'error',
          text: '本地字体暂时无法读取。已保留当前字体设置,请稍后重试。',
        })
      }
      return
    }

    if (registration !== 'ready') {
      state.fontFamily = defaultReadingSettings.fontFamily
      setLocalFontMessage(operationSequence, { kind: 'error', text: '这个字体无法加载,已恢复默认字体。' })
      commit()
      return
    }

    applyCurrent()
  }

  function ensureLocalFontRegistered(id: string): Promise<EnsuredLocalFontResult> {
    if (registeredLocalFontIds.has(id) || hasRegisteredLocalFontFace(id)) {
      registeredLocalFontIds.add(id)
      return Promise.resolve('ready')
    }

    const pendingRegistration = pendingLocalFontRegistrations.get(id)

    if (pendingRegistration) {
      return pendingRegistration
    }

    const registrationGeneration = localFontRegistrationGenerations.get(id) ?? 0
    const registration = (async () => {
      try {
        const localFontStore = await getLocalFontStore()
        const record = await localFontStore.getFont(id)

        if (!record) {
          return 'missing'
        }

        const registration = await registerLocalFont(record, undefined, loadLocalFonts)

        if (registration.status !== 'ready') {
          return registration.status
        }

        if (
          (localFontRegistrationGenerations.get(id) ?? 0) !== registrationGeneration
          || !localFonts.value.some(font => font.id === id)
        ) {
          unloadLocalFontFace(id)
          registeredLocalFontIds.delete(id)
          return 'stale'
        }

        registeredLocalFontIds.add(id)
        return 'ready'
      }
      catch {
        return 'unavailable'
      }
    })().finally(() => pendingLocalFontRegistrations.delete(id))

    pendingLocalFontRegistrations.set(id, registration)
    return registration
  }

  function invalidateLocalFontRegistration(id: string): void {
    localFontRegistrationGenerations.set(id, (localFontRegistrationGenerations.get(id) ?? 0) + 1)
    registeredLocalFontIds.delete(id)
    unloadLocalFontFace(id)
  }

  function beginLocalFontOperation(): number {
    localFontOperationSequence += 1
    localFontMessage.value = null
    return localFontOperationSequence
  }

  function setLocalFontMessage(sequence: number, message: ReadingSettingsMessage): void {
    if (sequence === localFontOperationSequence) {
      localFontMessage.value = message
    }
  }

  function clearLocalFontMessage(sequence: number): void {
    if (sequence === localFontOperationSequence) {
      localFontMessage.value = null
    }
  }

  function persist(): void {
    const tokenOverrides = buildTokenOverrides(state, localFonts.value, resolvedTheme.value.palette)
    const hasTokenOverrides = Object.keys(tokenOverrides).length > 0
    const hasOutlinePositionOverride = state.outlinePosition !== defaultReadingSettings.outlinePosition
    const hasContrastOverride = state.contrast !== defaultReadingSettings.contrast
    const hasCustomThemeOverride = !isSameCustomTheme(state.customTheme, defaultReadingSettings.customTheme)

    if (
      !hasTokenOverrides
      && state.themeStyle === defaultReadingSettings.themeStyle
      && state.colorScheme === defaultReadingSettings.colorScheme
      && !hasOutlinePositionOverride
      && !hasContrastOverride
      && !hasCustomThemeOverride
      && !remoteImageMode
    ) {
      clearPersistedReadingSettings(storage)
      return
    }

    const settings: PersistedReadingSettings = {
      version: 2,
      themeStyle: state.themeStyle,
      colorScheme: state.colorScheme,
      tokenOverrides: hasTokenOverrides ? tokenOverrides : undefined,
      fontFamily: isLocalFontFamilyId(state.fontFamily) ? state.fontFamily : undefined,
      customTheme: hasCustomThemeOverride || state.colorScheme === 'custom'
        ? { ...state.customTheme }
        : undefined,
      remoteImageMode,
      contrast: hasContrastOverride ? state.contrast : undefined,
      outlinePosition: hasOutlinePositionOverride ? state.outlinePosition : undefined,
    }

    writePersistedReadingSettings(settings, storage)
  }

  applyCurrent()

  return {
    state: readonly(state),
    presets: readonly(presets),
    localFonts: readonly(localFonts),
    localFontMessage: readonly(localFontMessage),
    isDefault,
    effectiveColorScheme,
    hasActiveLocalFont,
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
    updateThemeStyle,
    updateColorScheme,
    updateCustomTheme,
    autoFixCustomTheme,
    updateContrast,
    updateOutlinePosition,
    syncSystemColorScheme,
  }
}

async function registerLocalFont(
  record: LocalFontRecord,
  providedModule?: LocalFontsModule,
  loadModule: () => Promise<LocalFontsModule> = loadLocalFontsModule,
): Promise<LocalFontRegistrationResult> {
  let localFontsModule: LocalFontsModule

  try {
    localFontsModule = providedModule ?? await loadModule()
  }
  catch {
    return { status: 'unavailable' }
  }

  try {
    const fontFace = await localFontsModule.createLocalFontFace(record)
    document.fonts.add(fontFace)
    return { status: 'ready', option: localFontsModule.createLocalFontOption(record) }
  }
  catch {
    return { status: 'invalid' }
  }
}

function upsertLocalFontOption(
  localFonts: readonly LocalFontOption[],
  option: LocalFontOption,
): LocalFontOption[] {
  const existingIndex = localFonts.findIndex(font => font.id === option.id)

  if (existingIndex === -1) {
    return [...localFonts, option]
  }

  return localFonts.map(font => font.id === option.id ? option : font)
}

function hasRegisteredLocalFontFace(id: string): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return false
  }

  const fontFaceFamily = createLocalFontFaceFamily(id)
  return Array.from(document.fonts).some(fontFace => fontFace.family === fontFaceFamily)
}

function unloadLocalFontFace(id: string): void {
  const fontFaceFamily = createLocalFontFaceFamily(id)

  for (const fontFace of Array.from(document.fonts)) {
    if (fontFace.family === fontFaceFamily) {
      document.fonts.delete(fontFace)
    }
  }
}

function loadLocalFontsModule() {
  return import('./localFonts')
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
  state.themeStyle = snapshot.themeStyle
  state.colorScheme = snapshot.colorScheme
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
    themeStyle: isReadingThemeStyle(settings?.themeStyle)
      ? settings.themeStyle
      : defaultReadingSettings.themeStyle,
    colorScheme: isReadingColorScheme(settings?.colorScheme)
      ? settings.colorScheme
      : defaultReadingSettings.colorScheme,
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
  themePalette: ReadingPalette = {},
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
  Object.assign(tokenOverrides, themePalette)

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

  if (settings?.colorScheme === 'custom' && bg && fg && accent) {
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

function resolveSystemDarkScheme(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveThemeColorMeta(root: HTMLElement): HTMLMetaElement | null {
  const document = root.ownerDocument
  return document.documentElement === root
    ? document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    : null
}
