const fontLoaders = {
  ayingottReadingFonts: () => import('@ayingott/theme/fonts.css'),
} as const

export type ReadingFontId = keyof typeof fontLoaders

export async function loadReadingFont(font: ReadingFontId): Promise<void> {
  await fontLoaders[font]()
}

export async function loadDefaultReadingFonts(): Promise<void> {
  await loadReadingFont('ayingottReadingFonts')
}
