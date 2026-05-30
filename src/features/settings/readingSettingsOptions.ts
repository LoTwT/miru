import { darkReadingTheme, defaultReadingTheme } from '@/lib/theme/tokens'
import type { ReadingTokenName } from '@/lib/theme/tokens'

export type ReadingFontSizeId = '15' | '16' | '17' | '18' | '19' | '20' | '22' | '24'
export type ReadingMeasureId = '55' | '65' | '75'
export type ReadingLineHeightId = '1.5' | '1.7' | '1.9'
export type ReadingLetterSpacingId = 'tight' | 'standard' | 'loose'
export type ReadingParagraphGapId = 'compact' | 'standard' | 'loose'
export type ReadingPageMarginId = 'compact' | 'standard' | 'spacious'
export type ReadingBuiltInFontFamilyId = 'serif' | 'system-serif' | 'system-sans' | 'mono'
export type ReadingLocalFontFamilyId = `local:${string}`
export type ReadingFontFamilyId = ReadingBuiltInFontFamilyId | ReadingLocalFontFamilyId
export type ReadingThemeChoice = 'system' | 'light' | 'dark' | 'sepia' | 'custom'
export type PresetReadingThemeChoice = Exclude<ReadingThemeChoice, 'system' | 'custom'>
export type ReadingContrastId = 'soft' | 'standard' | 'strong'
export type ReadingOutlinePositionId = 'left' | 'right'

export interface ReadingSettingOption<T extends string> {
  id: T
  label: string
  ariaLabel: string
  tokenValue: string
}

export interface ReadingCustomThemeState {
  bg: string
  fg: string
  accent: string
}

export interface ReadingCustomThemeCheck {
  id: keyof ReadingCustomThemeState
  label: string
  ratio: number
  passes: boolean
}

export const defaultCustomTheme = {
  bg: '#fbf8f1',
  fg: '#24211d',
  accent: '#9d5f34',
} as const satisfies ReadingCustomThemeState

export const serifFontStack = '"Newsreader", Georgia, "Songti SC", "Noto Serif CJK SC", serif'
export const systemSerifFontStack = 'Georgia, "Songti SC", "Noto Serif CJK SC", serif'
export const systemSansFontStack = '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif'
export const monoFontStack = '"Space Mono", ui-monospace, SFMono-Regular, Menlo, "PingFang SC", "Noto Sans CJK SC", monospace'
export const localFontFamilyPrefix = 'local:'

export const readingFontSizeOptions = [
  { id: '15', label: '15', ariaLabel: '字号 15px', tokenValue: '15px' },
  { id: '16', label: 'A', ariaLabel: '字号 很小', tokenValue: '16px' },
  { id: '17', label: '17', ariaLabel: '字号 17px', tokenValue: '17px' },
  { id: '18', label: 'A', ariaLabel: '字号 默认', tokenValue: '18px' },
  { id: '19', label: '19', ariaLabel: '字号 19px', tokenValue: '19px' },
  { id: '20', label: 'A', ariaLabel: '字号 大', tokenValue: '20px' },
  { id: '22', label: 'A', ariaLabel: '字号 很大', tokenValue: '22px' },
  { id: '24', label: 'A', ariaLabel: '字号 最大', tokenValue: '24px' },
] as const satisfies readonly ReadingSettingOption<ReadingFontSizeId>[]

export const readingMeasureOptions = [
  { id: '55', label: '窄', ariaLabel: '行宽 窄', tokenValue: '55ch' },
  { id: '65', label: '中', ariaLabel: '行宽 默认', tokenValue: '65ch' },
  { id: '75', label: '宽', ariaLabel: '行宽 宽', tokenValue: '75ch' },
] as const satisfies readonly ReadingSettingOption<ReadingMeasureId>[]

export const readingLineHeightOptions = [
  { id: '1.5', label: '紧', ariaLabel: '行距 紧', tokenValue: '1.5' },
  { id: '1.7', label: '中', ariaLabel: '行距 默认', tokenValue: '1.7' },
  { id: '1.9', label: '松', ariaLabel: '行距 松', tokenValue: '1.9' },
] as const satisfies readonly ReadingSettingOption<ReadingLineHeightId>[]

export const readingLetterSpacingOptions = [
  { id: 'tight', label: '紧', ariaLabel: '字间距 紧', tokenValue: '-0.01em' },
  { id: 'standard', label: '标准', ariaLabel: '字间距 标准', tokenValue: '0' },
  { id: 'loose', label: '松', ariaLabel: '字间距 松', tokenValue: '0.03em' },
] as const satisfies readonly ReadingSettingOption<ReadingLetterSpacingId>[]

export const readingParagraphGapOptions = [
  { id: 'compact', label: '紧', ariaLabel: '段间距 紧', tokenValue: '0.8em' },
  { id: 'standard', label: '标准', ariaLabel: '段间距 标准', tokenValue: '1.12em' },
  { id: 'loose', label: '松', ariaLabel: '段间距 松', tokenValue: '1.55em' },
] as const satisfies readonly ReadingSettingOption<ReadingParagraphGapId>[]

export const readingPageMarginOptions = [
  { id: 'compact', label: '紧凑', ariaLabel: '页边距 紧凑', tokenValue: 'clamp(1rem, 3vw, 2.75rem)' },
  { id: 'standard', label: '适中', ariaLabel: '页边距 适中', tokenValue: 'clamp(1.25rem, 4vw, 4rem)' },
  { id: 'spacious', label: '宽松', ariaLabel: '页边距 宽松', tokenValue: 'clamp(2rem, 7vw, 6rem)' },
] as const satisfies readonly ReadingSettingOption<ReadingPageMarginId>[]

export const readingFontFamilyOptions = [
  { id: 'serif', label: 'Newsreader', ariaLabel: '正文字体 Newsreader', tokenValue: serifFontStack },
  { id: 'system-serif', label: '系统衬线', ariaLabel: '正文字体 系统衬线', tokenValue: systemSerifFontStack },
  { id: 'system-sans', label: '系统无衬线', ariaLabel: '正文字体 系统无衬线', tokenValue: systemSansFontStack },
  { id: 'mono', label: 'Space Mono', ariaLabel: '正文字体 Space Mono', tokenValue: monoFontStack },
] as const satisfies readonly ReadingSettingOption<ReadingBuiltInFontFamilyId>[]

export const readingThemeOptions = [
  { id: 'system', label: '跟随系统', ariaLabel: '主题 跟随系统' },
  { id: 'light', label: '浅', ariaLabel: '主题 浅色' },
  { id: 'dark', label: '深', ariaLabel: '主题 深色' },
  { id: 'sepia', label: 'Sepia', ariaLabel: '主题 Sepia' },
  { id: 'custom', label: '自定义', ariaLabel: '主题 自定义' },
] as const

export const readingContrastOptions = [
  { id: 'soft', label: '柔和', ariaLabel: '对比 柔和' },
  { id: 'standard', label: '标准', ariaLabel: '对比 标准' },
  { id: 'strong', label: '醒目', ariaLabel: '对比 醒目' },
] as const

export const readingOutlinePositionOptions = [
  { id: 'left', label: '左', ariaLabel: '大纲位置 左' },
  { id: 'right', label: '右', ariaLabel: '大纲位置 右' },
] as const

export const defaultReadingSettings = {
  fontSize: '18',
  measure: '65',
  lineHeight: '1.7',
  letterSpacing: 'standard',
  paragraphGap: 'standard',
  pageMargin: 'standard',
  fontFamily: 'serif',
  theme: 'system',
  contrast: 'standard',
  outlinePosition: 'right',
  customTheme: defaultCustomTheme,
} as const

export const customizableTypographyTokens = [
  '--reading-font-size',
  '--reading-measure',
  '--reading-line-height',
  '--reading-letter-spacing',
  '--reading-paragraph-gap',
  '--reading-page-margin',
  '--reading-font-body',
] as const satisfies readonly ReadingTokenName[]

export const customizableThemeTokens = [
  '--reading-bg',
  '--reading-fg',
  '--reading-fg-muted',
  '--reading-link',
  '--reading-link-hover',
  '--reading-accent',
  '--reading-rule',
  '--reading-code-fg',
  '--reading-code-bg',
] as const satisfies readonly ReadingTokenName[]

export const customizableReadingTokens = [
  ...customizableTypographyTokens,
  ...customizableThemeTokens,
] as const satisfies readonly ReadingTokenName[]

export const lightThemeTokenOverrides = pickThemeTokens(defaultReadingTheme.tokens)
export const darkThemeTokenOverrides = pickThemeTokens(darkReadingTheme.tokens)

export const sepiaThemeTokenOverrides = {
  '--reading-bg': '#efe1bd',
  '--reading-fg': '#463b29',
  '--reading-fg-muted': '#64553e',
  '--reading-link': '#66569d',
  '--reading-link-hover': '#55468d',
  '--reading-accent': '#83502d',
  '--reading-rule': '#c4a466',
  '--reading-code-fg': '#463b29',
  '--reading-code-bg': '#e2cb99',
} as const satisfies Record<(typeof customizableThemeTokens)[number], string>

export const themeTokenOverridesByChoice = {
  light: lightThemeTokenOverrides,
  dark: darkThemeTokenOverrides,
  sepia: sepiaThemeTokenOverrides,
} as const

export const contrastTokenOverridesByThemeAndChoice = {
  light: {
    soft: {
      '--reading-fg': '#4a453d',
      '--reading-fg-muted': '#71695f',
    },
    standard: {},
    strong: {
      '--reading-fg': '#17130f',
      '--reading-fg-muted': '#322d26',
      '--reading-rule': '#c7b8a0',
    },
  },
  dark: {
    soft: {
      '--reading-fg': '#cfc5b8',
      '--reading-fg-muted': '#9f9587',
    },
    standard: {},
    strong: {
      '--reading-fg': '#fff8ed',
      '--reading-fg-muted': '#cdc2b3',
    },
  },
  sepia: {
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
} as const satisfies Record<
  PresetReadingThemeChoice,
  Record<ReadingContrastId, Partial<Record<(typeof customizableThemeTokens)[number], string>>>
>

export function resolveThemeTokenOverrides(
  theme: PresetReadingThemeChoice,
  contrast: ReadingContrastId,
): Record<(typeof customizableThemeTokens)[number], string> {
  return {
    ...themeTokenOverridesByChoice[theme],
    ...contrastTokenOverridesByThemeAndChoice[theme][contrast],
  }
}

export function deriveCustomThemeTokenOverrides(
  customTheme: ReadingCustomThemeState,
): Record<(typeof customizableThemeTokens)[number], string> {
  const bg = normalizeHexColor(customTheme.bg) ?? defaultCustomTheme.bg
  const fg = normalizeHexColor(customTheme.fg) ?? defaultCustomTheme.fg
  const accent = normalizeHexColor(customTheme.accent) ?? defaultCustomTheme.accent
  const muted = ensureContrast(mixHex(fg, bg, 0.28), bg)
  const link = accent
  const codeBg = tintTowardTextWithContrast(bg, fg)

  return {
    '--reading-bg': bg,
    '--reading-fg': fg,
    '--reading-fg-muted': muted,
    '--reading-link': link,
    '--reading-link-hover': ensureContrast(mixHex(link, fg, 0.18), bg),
    '--reading-accent': accent,
    '--reading-rule': muted,
    '--reading-code-fg': fg,
    '--reading-code-bg': codeBg,
  }
}

export function getCustomThemeChecks(customTheme: ReadingCustomThemeState): ReadingCustomThemeCheck[] {
  const tokens = deriveCustomThemeTokenOverrides(customTheme)
  const bg = tokens['--reading-bg']
  const fgRatio = contrastRatio(tokens['--reading-fg'], bg)
  const accentRatio = contrastRatio(tokens['--reading-accent'], bg)

  return [
    { id: 'fg', label: '正文', ratio: fgRatio, passes: fgRatio >= 4.5 },
    { id: 'accent', label: '强调', ratio: accentRatio, passes: accentRatio >= 4.5 },
    { id: 'bg', label: '背景', ratio: 21, passes: true },
  ]
}

export function hasReadableCustomTheme(customTheme: ReadingCustomThemeState): boolean {
  return getCustomThemeChecks(customTheme).every(check => check.passes)
}

export function fixCustomThemeToAA(customTheme: ReadingCustomThemeState): ReadingCustomThemeState {
  const bg = normalizeHexColor(customTheme.bg) ?? defaultCustomTheme.bg

  return {
    bg,
    fg: ensureContrast(customTheme.fg, bg),
    accent: ensureContrast(customTheme.accent, bg),
  }
}

export function normalizeHexColor(value: string | undefined): string | undefined {
  if (!value) {
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

export function createLocalFontFamilyId(id: string): ReadingLocalFontFamilyId {
  return `${localFontFamilyPrefix}${id}`
}

export function isReadingFontFamilyId(value: unknown): value is ReadingFontFamilyId {
  return isBuiltInReadingFontFamilyId(value) || isLocalFontFamilyId(value)
}

export function isBuiltInReadingFontFamilyId(value: unknown): value is ReadingBuiltInFontFamilyId {
  return typeof value === 'string' && readingFontFamilyOptions.some(option => option.id === value)
}

export function isLocalFontFamilyId(value: unknown): value is ReadingLocalFontFamilyId {
  return typeof value === 'string' && value.startsWith(localFontFamilyPrefix) && value.length > localFontFamilyPrefix.length
}

export function localFontIdFromFamilyId(value: ReadingLocalFontFamilyId): string {
  return value.slice(localFontFamilyPrefix.length)
}

export function buildUploadedFontStack(fontFaceFamily: string): string {
  return `"${fontFaceFamily.replace(/"/g, '\\"')}", ${serifFontStack}`
}

export function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA)
  const luminanceB = relativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

function pickThemeTokens(tokens: Record<ReadingTokenName, string>): Record<(typeof customizableThemeTokens)[number], string> {
  return Object.fromEntries(customizableThemeTokens.map(token => [token, tokens[token]])) as Record<
    (typeof customizableThemeTokens)[number],
    string
  >
}

function ensureContrast(color: string, bg: string, targetRatio = 4.5): string {
  const normalizedColor = normalizeHexColor(color) ?? defaultCustomTheme.fg
  const normalizedBg = normalizeHexColor(bg) ?? defaultCustomTheme.bg

  if (contrastRatio(normalizedColor, normalizedBg) >= targetRatio) {
    return normalizedColor
  }

  const target = relativeLuminance(normalizedBg) > 0.5 ? '#000000' : '#ffffff'

  for (let step = 1; step <= 100; step += 1) {
    const candidate = mixHex(normalizedColor, target, step / 100)

    if (contrastRatio(candidate, normalizedBg) >= targetRatio) {
      return candidate
    }
  }

  return target
}

function tintTowardTextWithContrast(bg: string, fg: string, preferredAmount = 0.08, targetRatio = 4.5): string {
  const normalizedBg = normalizeHexColor(bg) ?? defaultCustomTheme.bg
  const normalizedFg = normalizeHexColor(fg) ?? defaultCustomTheme.fg
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
