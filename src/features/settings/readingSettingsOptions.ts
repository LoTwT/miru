import { darkReadingTheme, defaultReadingTheme } from '@/lib/theme/tokens'
import type { ReadingTokenName } from '@/lib/theme/tokens'

export type ReadingFontSizeId = '16' | '18' | '20' | '22' | '24'
export type ReadingMeasureId = '55' | '65' | '75'
export type ReadingLineHeightId = '1.5' | '1.7' | '1.9'
export type ReadingFontFamilyId = 'serif' | 'sans'
export type ReadingThemeChoice = 'system' | 'light' | 'dark' | 'sepia'
export type ReadingOutlinePositionId = 'left' | 'right'

export interface ReadingSettingOption<T extends string> {
  id: T
  label: string
  ariaLabel: string
  tokenValue: string
}

export const serifFontStack = '"Newsreader", Georgia, "Songti SC", "Noto Serif CJK SC", serif'
export const sansFontStack = '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif'

export const readingFontSizeOptions = [
  { id: '16', label: 'A', ariaLabel: '字号 很小', tokenValue: '16px' },
  { id: '18', label: 'A', ariaLabel: '字号 默认', tokenValue: '18px' },
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

export const readingFontFamilyOptions = [
  { id: 'serif', label: '衬线', ariaLabel: '正文字体 衬线', tokenValue: serifFontStack },
  { id: 'sans', label: '无衬线', ariaLabel: '正文字体 无衬线', tokenValue: sansFontStack },
] as const satisfies readonly ReadingSettingOption<ReadingFontFamilyId>[]

export const readingThemeOptions = [
  { id: 'system', label: '跟随系统', ariaLabel: '主题 跟随系统' },
  { id: 'light', label: '浅', ariaLabel: '主题 浅色' },
  { id: 'dark', label: '深', ariaLabel: '主题 深色' },
  { id: 'sepia', label: 'Sepia', ariaLabel: '主题 Sepia' },
] as const

export const readingOutlinePositionOptions = [
  { id: 'left', label: '左', ariaLabel: '大纲位置 左' },
  { id: 'right', label: '右', ariaLabel: '大纲位置 右' },
] as const

export const defaultReadingSettings = {
  fontSize: '18',
  measure: '65',
  lineHeight: '1.7',
  fontFamily: 'serif',
  theme: 'system',
  outlinePosition: 'right',
} as const

export const customizableTypographyTokens = [
  '--reading-font-size',
  '--reading-measure',
  '--reading-line-height',
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
  '--reading-bg': '#f4ecd8',
  '--reading-fg': '#463b29',
  '--reading-fg-muted': '#6f6149',
  '--reading-link': '#66569d',
  '--reading-link-hover': '#55468d',
  '--reading-accent': '#8c552f',
  '--reading-rule': '#d6c4a4',
  '--reading-code-fg': '#463b29',
  '--reading-code-bg': '#ece1c4',
} as const satisfies Record<(typeof customizableThemeTokens)[number], string>

export const themeTokenOverridesByChoice = {
  light: lightThemeTokenOverrides,
  dark: darkThemeTokenOverrides,
  sepia: sepiaThemeTokenOverrides,
} as const

function pickThemeTokens(tokens: Record<ReadingTokenName, string>): Record<(typeof customizableThemeTokens)[number], string> {
  return Object.fromEntries(customizableThemeTokens.map(token => [token, tokens[token]])) as Record<
    (typeof customizableThemeTokens)[number],
    string
  >
}
