export type ReadingTokenName = `--reading-${string}`
export type ReadingThemeStyleId = 'brutal' | 'default'
export type ReadingColorSchemeId = 'system' | 'light' | 'dark' | 'sepia' | 'custom'
export type ReadingContrastId = 'soft' | 'standard' | 'strong'

export interface ReadingCustomThemeState {
  bg: string
  fg: string
  accent: string
}

export const readingTypographyTokenNames = [
  '--reading-font-size',
  '--reading-measure',
  '--reading-line-height',
  '--reading-letter-spacing',
  '--reading-paragraph-gap',
  '--reading-page-margin',
  '--reading-font-body',
] as const satisfies readonly ReadingTokenName[]

export const readingPaletteTokenNames = [
  '--reading-bg',
  '--reading-fg',
  '--reading-fg-muted',
  '--reading-link',
  '--reading-link-hover',
  '--reading-accent',
  '--reading-accent-contrast',
  '--reading-focus',
  '--reading-focus-shadow',
  '--reading-rule',
  '--reading-code-fg',
  '--reading-code-bg',
] as const satisfies readonly ReadingTokenName[]

export type ReadingPaletteTokenName = (typeof readingPaletteTokenNames)[number]
export type ReadingPalette = Partial<Record<ReadingPaletteTokenName, string>>

export interface StoredReadingThemeCandidate {
  version?: unknown
  presetId?: unknown
  themeStyle?: unknown
  colorScheme?: unknown
  contrast?: unknown
  customTheme?: unknown
  tokenOverrides?: unknown
  fontFamily?: unknown
  fontBody?: unknown
  remoteImageMode?: unknown
  outlinePosition?: unknown
  compatibilityRevision?: unknown
}

export type CompatibilityReadResult<T> =
  | { status: 'missing' }
  | { status: 'invalid', candidate?: T }
  | { status: 'valid', candidate: T }

export type StoredReadingThemeReadResult = CompatibilityReadResult<StoredReadingThemeCandidate>

interface ReadingThemeContract {
  settingsStorageKey: string
  legacySettingsStorageKey: string
  defaultThemeStyle: ReadingThemeStyleId
  defaultColorScheme: ReadingColorSchemeId
  defaultContrast: ReadingContrastId
  defaultCustomTheme: ReadingCustomThemeState
  baseThemeColors: Record<ReadingThemeStyleId, Record<'light' | 'dark', string>>
  sepiaPalette: Record<ReadingPaletteTokenName, string>
  sepiaContrast: Record<ReadingContrastId, ReadingPalette>
}

export interface ResolvedReadingTheme {
  themeStyle: ReadingThemeStyleId
  colorScheme: ReadingColorSchemeId
  contrast: ReadingContrastId
  customTheme: ReadingCustomThemeState
  effectiveColorScheme: 'light' | 'dark'
  palette: ReadingPalette
  themeColor: string
}

export const readingThemeContract = {
  settingsStorageKey: 'miru:reading-settings:v2',
  legacySettingsStorageKey: 'miru:reading-settings:v1',
  defaultThemeStyle: 'brutal',
  defaultColorScheme: 'system',
  defaultContrast: 'standard',
  defaultCustomTheme: {
    bg: '#faf8f4',
    fg: '#191713',
    accent: '#66569d',
  },
  baseThemeColors: {
    brutal: {
      light: '#fcf6ea',
      dark: '#161412',
    },
    default: {
      light: '#faf8f4',
      dark: '#121019',
    },
  },
  sepiaPalette: {
    '--reading-bg': '#efe1bd',
    '--reading-fg': '#463b29',
    '--reading-fg-muted': '#64553e',
    '--reading-link': '#66569d',
    '--reading-link-hover': '#55468d',
    '--reading-accent': '#83502d',
    '--reading-accent-contrast': '#ffffff',
    '--reading-focus': '#66569d',
    '--reading-focus-shadow': '0 0 0 4px color-mix(in srgb, #66569d 22%, transparent)',
    '--reading-rule': '#c4a466',
    '--reading-code-fg': '#463b29',
    '--reading-code-bg': '#e2cb99',
  },
  sepiaContrast: {
    soft: {
      '--reading-fg': '#66553c',
      '--reading-fg-muted': '#705f45',
    },
    standard: {},
    strong: {
      '--reading-fg': '#2a2012',
      '--reading-fg-muted': '#3e3220',
      '--reading-rule': '#ab8b48',
    },
  },
} as const satisfies ReadingThemeContract

export const readingSettingsStorageKey = readingThemeContract.settingsStorageKey
export const legacyReadingSettingsStorageKey = readingThemeContract.legacySettingsStorageKey
const readingTypographyTokenNameSet = new Set<ReadingTokenName>(readingTypographyTokenNames)
const readingPaletteTokenNameSet = new Set<ReadingTokenName>(readingPaletteTokenNames)

export function isReadingThemeStyle(value: unknown): value is ReadingThemeStyleId {
  return value === 'brutal' || value === 'default'
}

export function isReadingColorScheme(value: unknown): value is ReadingColorSchemeId {
  return value === 'system'
    || value === 'light'
    || value === 'dark'
    || value === 'sepia'
    || value === 'custom'
}

export function isReadingContrast(value: unknown): value is ReadingContrastId {
  return value === 'soft' || value === 'standard' || value === 'strong'
}

export function migrateLegacyReadingTheme(
  presetId: unknown,
): Partial<Pick<ResolvedReadingTheme, 'themeStyle' | 'colorScheme'>> {
  if (presetId === 'brutal' || presetId === 'system') {
    return {
      themeStyle: 'brutal',
      colorScheme: 'system',
    }
  }

  if (
    presetId === 'light'
    || presetId === 'dark'
    || presetId === 'sepia'
    || presetId === 'custom'
  ) {
    return {
      themeStyle: 'default',
      colorScheme: presetId,
    }
  }

  return {}
}

export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()

  if (/^#[\da-f]{6}$/.test(normalized)) {
    return normalized
  }

  if (/^#[\da-f]{3}$/.test(normalized)) {
    const red = normalized[1] ?? '0'
    const green = normalized[2] ?? '0'
    const blue = normalized[3] ?? '0'
    return `#${red}${red}${green}${green}${blue}${blue}`
  }

  return undefined
}

export function sanitizeStoredCustomTheme(value: unknown): ReadingCustomThemeState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const customTheme = value as Partial<ReadingCustomThemeState>
  const bg = typeof customTheme.bg === 'string' && /^#[\da-f]{6}$/i.test(customTheme.bg)
    ? customTheme.bg.toLowerCase()
    : undefined
  const fg = typeof customTheme.fg === 'string' && /^#[\da-f]{6}$/i.test(customTheme.fg)
    ? customTheme.fg.toLowerCase()
    : undefined
  const accent = typeof customTheme.accent === 'string' && /^#[\da-f]{6}$/i.test(customTheme.accent)
    ? customTheme.accent.toLowerCase()
    : undefined

  return bg && fg && accent
    ? { bg, fg, accent }
    : undefined
}

export function sanitizeStoredReadingTokenOverrides(
  value: unknown,
): Record<ReadingTokenName, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const result: Record<ReadingTokenName, string> = {}

  for (const [key, tokenValue] of Object.entries(value)) {
    if (
      key.startsWith('--reading-')
      && typeof tokenValue === 'string'
      && isSafePersistedReadingTokenValue(key as ReadingTokenName, tokenValue)
    ) {
      result[key as ReadingTokenName] = tokenValue
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeStoredCustomThemeFromTokenOverrides(value: unknown): ReadingCustomThemeState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const tokenOverrides = value as Record<string, unknown>

  return sanitizeStoredCustomTheme({
    bg: tokenOverrides['--reading-bg'],
    fg: tokenOverrides['--reading-fg'],
    accent: tokenOverrides['--reading-accent'],
  })
}

function isSafePersistedReadingTokenValue(token: ReadingTokenName, value: string): boolean {
  if (readingPaletteTokenNameSet.has(token)) {
    if (token === '--reading-focus-shadow') {
      return /^0 0 0 4px color-mix\(in srgb, #[\da-f]{6} 22%, transparent\)$/i.test(value)
    }

    return /^#[\da-f]{6}$/i.test(value)
  }

  if (!readingTypographyTokenNameSet.has(token)) {
    return false
  }

  return !/[;{}\r\n]/.test(value)
    && !/(?:url|image-set)\s*\(/i.test(value)
}

export function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA)
  const luminanceB = relativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

export function deriveCustomThemeTokenOverrides(
  customTheme: ReadingCustomThemeState,
  contract: ReadingThemeContract = readingThemeContract,
): Record<ReadingPaletteTokenName, string> {
  const bg = normalizeHexColor(customTheme.bg) ?? contract.defaultCustomTheme.bg
  const fg = normalizeHexColor(customTheme.fg) ?? contract.defaultCustomTheme.fg
  const accent = normalizeHexColor(customTheme.accent) ?? contract.defaultCustomTheme.accent
  const muted = ensureContrast(mixHex(fg, bg, 0.28), bg, 4.5, contract)
  const focus = ensureContrast(accent, bg, 3, contract)
  const codeBg = tintTowardTextWithContrast(bg, fg, 0.08, 4.5, contract)

  return {
    '--reading-bg': bg,
    '--reading-fg': fg,
    '--reading-fg-muted': muted,
    '--reading-link': accent,
    '--reading-link-hover': ensureContrast(mixHex(accent, fg, 0.18), bg, 4.5, contract),
    '--reading-accent': accent,
    '--reading-accent-contrast': bestContrastingText(accent),
    '--reading-focus': focus,
    '--reading-focus-shadow': `0 0 0 4px color-mix(in srgb, ${focus} 22%, transparent)`,
    '--reading-rule': muted,
    '--reading-code-fg': fg,
    '--reading-code-bg': codeBg,
  }
}

export function resolveSepiaThemeTokenOverrides(
  contrast: ReadingContrastId,
  contract: ReadingThemeContract = readingThemeContract,
): Record<ReadingPaletteTokenName, string> {
  return {
    ...contract.sepiaPalette,
    ...contract.sepiaContrast[contrast],
  }
}

export function isDarkReadingBackground(
  color: string,
  contract: ReadingThemeContract = readingThemeContract,
): boolean {
  const background = normalizeHexColor(color) ?? contract.defaultCustomTheme.bg
  return contrastRatio('#ffffff', background) > contrastRatio('#000000', background)
}

export function fixCustomThemeToAA(
  customTheme: ReadingCustomThemeState,
  contract: ReadingThemeContract = readingThemeContract,
): ReadingCustomThemeState {
  const bg = normalizeHexColor(customTheme.bg) ?? contract.defaultCustomTheme.bg

  return {
    bg,
    fg: ensureContrast(customTheme.fg, bg, 4.5, contract),
    accent: ensureContrast(customTheme.accent, bg, 4.5, contract),
  }
}

export function resolveReadingThemeState(
  candidate: unknown,
  systemDark: boolean,
  contract: ReadingThemeContract = readingThemeContract,
): ResolvedReadingTheme {
  const settings = candidate && typeof candidate === 'object'
    ? candidate as StoredReadingThemeCandidate
    : {}
  let themeStyle = contract.defaultThemeStyle
  let colorScheme = contract.defaultColorScheme

  if (settings.version === 1) {
    const migrated = migrateLegacyReadingTheme(settings.presetId)
    themeStyle = isReadingThemeStyle(settings.themeStyle)
      ? settings.themeStyle
      : migrated.themeStyle ?? themeStyle
    colorScheme = isReadingColorScheme(settings.colorScheme)
      ? settings.colorScheme
      : migrated.colorScheme ?? colorScheme
  }
  else if (settings.version === 2) {
    themeStyle = isReadingThemeStyle(settings.themeStyle)
      ? settings.themeStyle
      : themeStyle
    colorScheme = isReadingColorScheme(settings.colorScheme)
      ? settings.colorScheme
      : colorScheme
  }

  const contrast = isReadingContrast(settings.contrast)
    ? settings.contrast
    : contract.defaultContrast
  const customTheme = sanitizeStoredCustomTheme(settings.customTheme)
    ?? sanitizeStoredCustomThemeFromTokenOverrides(settings.tokenOverrides)
    ?? { ...contract.defaultCustomTheme }
  const palette: ReadingPalette = colorScheme === 'sepia'
    ? resolveSepiaThemeTokenOverrides(contrast, contract)
    : colorScheme === 'custom'
      ? deriveCustomThemeTokenOverrides(customTheme, contract)
      : {}
  const effectiveColorScheme = colorScheme === 'dark'
    || (colorScheme === 'custom' && isDarkReadingBackground(customTheme.bg, contract))
    || (colorScheme === 'system' && systemDark)
    ? 'dark'
    : 'light'
  const themeColor = palette['--reading-bg']
    ?? contract.baseThemeColors[themeStyle][effectiveColorScheme]

  return {
    themeStyle,
    colorScheme,
    contrast,
    customTheme,
    effectiveColorScheme,
    palette,
    themeColor,
  }
}

export function applyResolvedReadingTheme(
  root: HTMLElement,
  resolved: ResolvedReadingTheme,
  themeColorMeta?: HTMLMetaElement | null,
): void {
  root.classList.toggle('brutal', resolved.themeStyle === 'brutal')
  root.classList.toggle('dark', resolved.effectiveColorScheme === 'dark')
  root.dataset.readingStyle = resolved.themeStyle
  root.dataset.readingScheme = resolved.colorScheme

  if (resolved.contrast === 'standard') {
    delete root.dataset.readingContrast
  }
  else {
    root.dataset.readingContrast = resolved.contrast
  }

  if (themeColorMeta) {
    themeColorMeta.content = resolved.themeColor
  }
}

export function applyReadingPalette(root: HTMLElement, palette: ReadingPalette): void {
  for (const [token, value] of Object.entries(palette)) {
    if (typeof value === 'string') {
      root.style.setProperty(token, value)
    }
  }
}

export function createReadingCompatibilityRevision(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function parseStoredReadingThemeCandidate(
  raw: string | null,
  expectedVersion: 1 | 2,
): StoredReadingThemeReadResult {
  if (raw === null) {
    return { status: 'missing' }
  }

  try {
    const candidate = JSON.parse(raw) as unknown

    if (!isMeaningfulStoredReadingThemeCandidate(candidate, expectedVersion)) {
      return { status: 'invalid' }
    }

    if (expectedVersion === 2 && !hasValidV2ReadingThemeFields(candidate)) {
      return { status: 'invalid', candidate }
    }

    return { status: 'valid', candidate }
  }
  catch {
    return { status: 'invalid' }
  }
}

export function selectCompatibilitySnapshot<T extends { compatibilityRevision?: unknown }>(
  primary: CompatibilityReadResult<T>,
  legacy: CompatibilityReadResult<T>,
  reconcileLegacy?: (primary: T, legacy: T) => T,
): T | null {
  if (primary.status !== 'valid') {
    if (
      primary.status === 'invalid'
      && primary.candidate
      && Object.prototype.hasOwnProperty.call(primary.candidate, 'compatibilityRevision')
      && legacy.status === 'missing'
    ) {
      return null
    }

    if (legacy.status === 'valid') {
      return primary.status === 'invalid' && primary.candidate && reconcileLegacy
        ? reconcileLegacy(primary.candidate, legacy.candidate)
        : legacy.candidate
    }

    if (primary.status === 'invalid' && primary.candidate) {
      return primary.candidate
    }

    return legacy.status === 'invalid' && legacy.candidate
      ? legacy.candidate
      : null
  }

  const primaryRevision = typeof primary.candidate.compatibilityRevision === 'string'
    ? primary.candidate.compatibilityRevision
    : ''

  if (!primaryRevision) {
    return primary.candidate
  }

  if (legacy.status === 'missing') {
    return null
  }

  if (legacy.status === 'invalid') {
    return primary.candidate
  }

  if (legacy.candidate.compatibilityRevision === primaryRevision) {
    return primary.candidate
  }

  return reconcileLegacy
    ? reconcileLegacy(primary.candidate, legacy.candidate)
    : legacy.candidate
}

export function selectStoredReadingThemeCandidate(
  primary: StoredReadingThemeReadResult,
  legacy: StoredReadingThemeReadResult,
): StoredReadingThemeCandidate | null {
  return selectCompatibilitySnapshot(primary, legacy, reconcileLegacyReadingThemeCandidate)
}

export function runInitialReadingTheme(
  scope: Window,
  contract: ReadingThemeContract = readingThemeContract,
): void {
  const primary = readStoredThemeCandidate(scope, contract.settingsStorageKey, 2)
  const legacy = readStoredThemeCandidate(scope, contract.legacySettingsStorageKey, 1)
  const settings = selectStoredReadingThemeCandidate(primary, legacy) ?? {}
  const systemDark = typeof scope.matchMedia === 'function'
    && scope.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = resolveReadingThemeState(settings, systemDark, contract)
  const root = scope.document.documentElement
  const themeColorMeta = scope.document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')

  applyResolvedReadingTheme(root, resolved, themeColorMeta)
  applyReadingPalette(root, resolved.palette)
}

function isMeaningfulStoredReadingThemeCandidate(
  value: unknown,
  expectedVersion: 1 | 2,
): value is StoredReadingThemeCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as StoredReadingThemeCandidate
  if (candidate.version !== expectedVersion) {
    return false
  }

  const legacyTheme = expectedVersion === 1
    ? migrateLegacyReadingTheme(candidate.presetId)
    : {}

  return isReadingThemeStyle(candidate.themeStyle)
    || isReadingColorScheme(candidate.colorScheme)
    || legacyTheme.themeStyle !== undefined
    || legacyTheme.colorScheme !== undefined
    || isReadingContrast(candidate.contrast)
    || sanitizeStoredCustomTheme(candidate.customTheme) !== undefined
    || sanitizeStoredReadingTokenOverrides(candidate.tokenOverrides) !== undefined
    || typeof candidate.fontFamily === 'string'
    || typeof candidate.fontBody === 'string'
    || candidate.remoteImageMode === 'auto'
    || candidate.remoteImageMode === 'prompt'
    || candidate.remoteImageMode === 'block'
    || candidate.outlinePosition === 'left'
    || candidate.outlinePosition === 'right'
}

function hasValidV2ReadingThemeFields(candidate: StoredReadingThemeCandidate): boolean {
  return (candidate.themeStyle === undefined || isReadingThemeStyle(candidate.themeStyle))
    && (candidate.colorScheme === undefined || isReadingColorScheme(candidate.colorScheme))
    && (candidate.contrast === undefined || isReadingContrast(candidate.contrast))
    && (candidate.customTheme === undefined || sanitizeStoredCustomTheme(candidate.customTheme) !== undefined)
    && (candidate.tokenOverrides === undefined || hasOnlySafeStoredReadingTokenOverrides(candidate.tokenOverrides))
    && (candidate.fontFamily === undefined || typeof candidate.fontFamily === 'string')
    && (candidate.fontBody === undefined || typeof candidate.fontBody === 'string')
    && (
      candidate.remoteImageMode === undefined
      || candidate.remoteImageMode === 'auto'
      || candidate.remoteImageMode === 'prompt'
      || candidate.remoteImageMode === 'block'
    )
    && (
      candidate.outlinePosition === undefined
      || candidate.outlinePosition === 'left'
      || candidate.outlinePosition === 'right'
    )
    && (
      candidate.compatibilityRevision === undefined
      || (
        typeof candidate.compatibilityRevision === 'string'
        && candidate.compatibilityRevision.length > 0
      )
    )
}

function hasOnlySafeStoredReadingTokenOverrides(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.entries(value).every(([key, tokenValue]) => {
    return key.startsWith('--reading-')
      && typeof tokenValue === 'string'
      && isSafePersistedReadingTokenValue(key as ReadingTokenName, tokenValue)
  })
}

function reconcileLegacyReadingThemeCandidate(
  primary: StoredReadingThemeCandidate,
  legacy: StoredReadingThemeCandidate,
): StoredReadingThemeCandidate {
  if (
    (typeof legacy.compatibilityRevision === 'string' && legacy.compatibilityRevision.length > 0)
    || isReadingThemeStyle(legacy.themeStyle)
    || isReadingColorScheme(legacy.colorScheme)
  ) {
    return legacy
  }

  if (
    !isReadingThemeStyle(primary.themeStyle)
    || !isReadingColorScheme(primary.colorScheme)
  ) {
    return legacy
  }

  const legacyTheme = migrateLegacyReadingTheme(legacy.presetId)

  if (
    legacyTheme.colorScheme === undefined
    || legacyTheme.colorScheme !== primary.colorScheme
  ) {
    return legacy
  }

  return {
    ...legacy,
    themeStyle: primary.themeStyle,
    colorScheme: primary.colorScheme,
  }
}

function readStoredThemeCandidate(
  scope: Window,
  storageKey: string,
  expectedVersion: 1 | 2,
): StoredReadingThemeReadResult {
  try {
    return parseStoredReadingThemeCandidate(scope.localStorage.getItem(storageKey), expectedVersion)
  }
  catch {
    return { status: 'invalid' }
  }
}

function ensureContrast(
  color: string,
  bg: string,
  targetRatio: number,
  contract: ReadingThemeContract = readingThemeContract,
): string {
  const normalizedColor = normalizeHexColor(color) ?? contract.defaultCustomTheme.fg
  const normalizedBg = normalizeHexColor(bg) ?? contract.defaultCustomTheme.bg

  if (contrastRatio(normalizedColor, normalizedBg) >= targetRatio) {
    return normalizedColor
  }

  const target = bestContrastingText(normalizedBg)

  for (let step = 1; step <= 100; step += 1) {
    const candidate = mixHex(normalizedColor, target, step / 100)

    if (contrastRatio(candidate, normalizedBg) >= targetRatio) {
      return candidate
    }
  }

  return target
}

function bestContrastingText(bg: string): '#000000' | '#ffffff' {
  return contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg)
    ? '#000000'
    : '#ffffff'
}

function tintTowardTextWithContrast(
  bg: string,
  fg: string,
  preferredAmount: number,
  targetRatio: number,
  contract: ReadingThemeContract = readingThemeContract,
): string {
  const normalizedBg = normalizeHexColor(bg) ?? contract.defaultCustomTheme.bg
  const normalizedFg = normalizeHexColor(fg) ?? contract.defaultCustomTheme.fg
  const preferred = mixHex(normalizedBg, normalizedFg, preferredAmount)

  if (contrastRatio(normalizedFg, preferred) >= targetRatio) {
    return preferred
  }

  for (let step = Math.floor(preferredAmount * 100) - 1; step >= 0; step -= 1) {
    const candidate = mixHex(normalizedBg, normalizedFg, step / 100)

    if (contrastRatio(normalizedFg, candidate) >= targetRatio) {
      return candidate
    }
  }

  return normalizedBg
}

function mixHex(colorA: string, colorB: string, amountB: number): string {
  const [redA, greenA, blueA] = hexToRgb(colorA)
  const [redB, greenB, blueB] = hexToRgb(colorB)
  const amountA = 1 - amountB

  return rgbToHex([
    Math.round((redA * amountA) + (redB * amountB)),
    Math.round((greenA * amountA) + (greenB * amountB)),
    Math.round((blueA * amountA) + (blueB * amountB)),
  ])
}

function relativeLuminance(hexColor: string): number {
  const [red, green, blue] = hexToRgb(hexColor).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function hexToRgb(hexColor: string): [number, number, number] {
  const normalized = normalizeHexColor(hexColor) ?? '#000000'

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

function rgbToHex([red, green, blue]: [number, number, number]): string {
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`
}

function toHexChannel(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
}
