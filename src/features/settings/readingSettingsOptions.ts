import { readingTypographyTokenNames } from '@/lib/theme/tokens'
import {
  contrastRatio,
  deriveCustomThemeTokenOverrides,
  fixCustomThemeToAA,
  isDarkReadingBackground,
  isReadingColorScheme,
  isReadingThemeStyle,
  normalizeHexColor,
  readingPaletteTokenNames,
  readingThemeContract,
  resolveSepiaThemeTokenOverrides,
} from '@/lib/theme/readingThemeContract'
import type {
  ReadingColorSchemeId,
  ReadingContrastId,
  ReadingCustomThemeState,
  ReadingThemeStyleId,
  ReadingTokenName,
} from '@/lib/theme/readingThemeContract'

export {
  contrastRatio,
  deriveCustomThemeTokenOverrides,
  fixCustomThemeToAA,
  isDarkReadingBackground,
  isReadingColorScheme,
  isReadingThemeStyle,
  normalizeHexColor,
  resolveSepiaThemeTokenOverrides,
} from '@/lib/theme/readingThemeContract'
export type {
  ReadingColorSchemeId,
  ReadingContrastId,
  ReadingCustomThemeState,
  ReadingThemeStyleId,
} from '@/lib/theme/readingThemeContract'

export type ReadingFontSizeId = '15' | '16' | '17' | '18' | '19' | '20' | '22' | '24'
export type ReadingMeasureId = '55' | '65' | '75'
export type ReadingLineHeightId = '1.5' | '1.7' | '1.9'
export type ReadingLetterSpacingId = 'tight' | 'standard' | 'loose'
export type ReadingParagraphGapId = 'compact' | 'standard' | 'loose'
export type ReadingPageMarginId = 'compact' | 'standard' | 'spacious'
export type ReadingBuiltInFontFamilyId = 'serif' | 'literata' | 'lxgw-wenkai' | 'atkinson' | 'system-serif' | 'system-sans' | 'mono'
export type ReadingLocalFontFamilyId = `local:${string}`
export type ReadingFontFamilyId = ReadingBuiltInFontFamilyId | ReadingLocalFontFamilyId
export type ReadingOutlinePositionId = 'left' | 'right'

export interface ReadingSettingOption<T extends string> {
  id: T
  label: string
  ariaLabel: string
  tokenValue: string
  badge?: string
  confirmDownload?: {
    message: string
    sizeLabel: string
  }
  previewTokenValue?: string
}

export interface ReadingCustomThemeCheck {
  id: keyof ReadingCustomThemeState
  label: string
  ratio: number
  passes: boolean
}

export const defaultCustomTheme = readingThemeContract.defaultCustomTheme

export const serifFontStack = '"Newsreader", Georgia, "Songti SC", "Noto Serif CJK SC", serif'
export const literataFontStack = '"Literata Variable", "Newsreader", Georgia, "Songti SC", "Noto Serif CJK SC", serif'
export const lxgwWenkaiFontStack = '"LXGW WenKai", "Songti SC", "Noto Serif CJK SC", serif'
export const atkinsonFontStack = '"Atkinson Hyperlegible", -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif'
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
  { id: 'standard', label: '标准', ariaLabel: '段间距 标准', tokenValue: '1.2em' },
  { id: 'loose', label: '松', ariaLabel: '段间距 松', tokenValue: '1.55em' },
] as const satisfies readonly ReadingSettingOption<ReadingParagraphGapId>[]

export const readingPageMarginOptions = [
  { id: 'compact', label: '紧凑', ariaLabel: '页边距 紧凑', tokenValue: 'clamp(1rem, 3vw, 2.75rem)' },
  { id: 'standard', label: '适中', ariaLabel: '页边距 适中', tokenValue: 'var(--layout-page-gutter)' },
  { id: 'spacious', label: '宽松', ariaLabel: '页边距 宽松', tokenValue: 'clamp(2rem, 7vw, 6rem)' },
] as const satisfies readonly ReadingSettingOption<ReadingPageMarginId>[]

export const readingFontFamilyOptions = [
  { id: 'serif', label: 'Newsreader', ariaLabel: '正文字体 Newsreader', tokenValue: serifFontStack },
  {
    id: 'literata',
    label: 'Literata',
    ariaLabel: '正文字体 Literata',
    tokenValue: literataFontStack,
    previewTokenValue: '"Literata Preview", "Newsreader", Georgia, serif',
  },
  {
    id: 'lxgw-wenkai',
    label: '霞鹜文楷',
    ariaLabel: '正文字体 霞鹜文楷',
    tokenValue: lxgwWenkaiFontStack,
    previewTokenValue: '"LXGW WenKai Preview", "Songti SC", "Noto Serif CJK SC", serif',
    badge: '大字体',
    confirmDownload: {
      message: '霞鹜文楷是中文大字体,首次启用会从本站下载约 8.8MB 到本机缓存。字体不会上传,也不会进入离线预缓存。',
      sizeLabel: '约 8.8MB',
    },
  },
  {
    id: 'atkinson',
    label: 'Atkinson',
    ariaLabel: '正文字体 Atkinson Hyperlegible',
    tokenValue: atkinsonFontStack,
    previewTokenValue: '"Atkinson Hyperlegible Preview", -apple-system, "Segoe UI", sans-serif',
  },
  { id: 'system-serif', label: '系统衬线', ariaLabel: '正文字体 系统衬线', tokenValue: systemSerifFontStack },
  { id: 'system-sans', label: '系统无衬线', ariaLabel: '正文字体 系统无衬线', tokenValue: systemSansFontStack },
  { id: 'mono', label: 'Space Mono', ariaLabel: '正文字体 Space Mono', tokenValue: monoFontStack },
] as const satisfies readonly ReadingSettingOption<ReadingBuiltInFontFamilyId>[]

export const confirmedOptionalFontStorageKey = 'miru:confirmed-optional-fonts:v1'

export function getReadingFontFamilyOption(value: ReadingFontFamilyId): ReadingSettingOption<ReadingBuiltInFontFamilyId> | undefined {
  return readingFontFamilyOptions.find(option => option.id === value)
}

export function requiresReadingFontDownloadConfirmation(value: ReadingFontFamilyId): boolean {
  return Boolean(getReadingFontFamilyOption(value)?.confirmDownload)
}

export const readingThemeStyleOptions = [
  { id: 'brutal', label: 'Brutal', ariaLabel: '主题风格 Brutal' },
  { id: 'default', label: 'Default', ariaLabel: '主题风格 Default' },
] as const

export const readingColorSchemeOptions = [
  { id: 'system', label: '自动', ariaLabel: '配色 跟随系统' },
  { id: 'light', label: '浅', ariaLabel: '配色 浅色' },
  { id: 'dark', label: '深', ariaLabel: '配色 深色' },
  { id: 'sepia', label: 'Sepia', ariaLabel: '配色 Sepia' },
  { id: 'custom', label: '自定义', ariaLabel: '配色 自定义' },
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
  themeStyle: readingThemeContract.defaultThemeStyle,
  colorScheme: readingThemeContract.defaultColorScheme,
  contrast: readingThemeContract.defaultContrast,
  outlinePosition: 'right',
  customTheme: defaultCustomTheme,
} as const

export const customizableTypographyTokens = readingTypographyTokenNames

export const customizableThemeTokens = readingPaletteTokenNames

export const customizableReadingTokens = [
  ...customizableTypographyTokens,
  ...customizableThemeTokens,
] as const satisfies readonly ReadingTokenName[]

export const sepiaThemeTokenOverrides = readingThemeContract.sepiaPalette

export const sepiaContrastTokenOverrides = {
  sepia: readingThemeContract.sepiaContrast,
} as const satisfies Record<'sepia', Record<
  ReadingContrastId,
  Partial<Record<(typeof customizableThemeTokens)[number], string>>
>>

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
