const fontLoaders = {
  defaultReadingFonts: () => Promise.all([
    import('@/styles/theme-fonts.css'),
    import('@/styles/newsreader.css'),
  ]),
} as const

export type ReadingFontId = keyof typeof fontLoaders

interface OptionalFontFaceDefinition {
  descriptors: FontFaceDescriptors
  family: string
  source: string
}

type OptionalFontTestWindow = Window & {
  __miruOptionalFontLoadFailures?: readonly string[]
}

const latinUnicodeRange = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

const optionalFontFaces = {
  literata: [
    {
      family: 'Literata Variable',
      source: 'url("/fonts/optional/literata-latin-wght-normal.woff2") format("woff2-variations")',
      descriptors: {
        display: 'swap',
        style: 'normal',
        unicodeRange: latinUnicodeRange,
        weight: '200 900',
      },
    },
    {
      family: 'Literata Variable',
      source: 'url("/fonts/optional/literata-latin-wght-italic.woff2") format("woff2-variations")',
      descriptors: {
        display: 'swap',
        style: 'italic',
        unicodeRange: latinUnicodeRange,
        weight: '200 900',
      },
    },
  ],
  'lxgw-wenkai': [
    {
      family: 'LXGW WenKai',
      source: 'url("/fonts/optional/lxgw-wenkai-300-normal.woff2") format("woff2")',
      descriptors: {
        display: 'swap',
        style: 'normal',
        weight: '300',
      },
    },
  ],
  atkinson: [
    {
      family: 'Atkinson Hyperlegible',
      source: 'url("/fonts/optional/atkinson-hyperlegible-latin-400-normal.woff2") format("woff2")',
      descriptors: {
        display: 'swap',
        style: 'normal',
        unicodeRange: latinUnicodeRange,
        weight: '400',
      },
    },
    {
      family: 'Atkinson Hyperlegible',
      source: 'url("/fonts/optional/atkinson-hyperlegible-latin-700-normal.woff2") format("woff2")',
      descriptors: {
        display: 'swap',
        style: 'normal',
        unicodeRange: latinUnicodeRange,
        weight: '700',
      },
    },
  ],
} as const satisfies Record<string, readonly OptionalFontFaceDefinition[]>

const optionalFontLoadPromises = new Map<OptionalReadingFontId, Promise<void>>()

export type OptionalReadingFontId = keyof typeof optionalFontFaces

interface LoadOptionalReadingFontOptions {
  failOnError?: boolean
}

export async function loadReadingFont(font: ReadingFontId): Promise<void> {
  await fontLoaders[font]()
}

export async function loadDefaultReadingFonts(): Promise<void> {
  await loadReadingFont('defaultReadingFonts')
}

export function isOptionalReadingFontId(value: string): value is OptionalReadingFontId {
  return value in optionalFontFaces
}

export async function loadOptionalReadingFont(font: string, options: LoadOptionalReadingFontOptions = {}): Promise<boolean> {
  if (!isOptionalReadingFontId(font) || typeof FontFace === 'undefined' || typeof document === 'undefined' || !('fonts' in document)) {
    return false
  }

  if ((window as OptionalFontTestWindow).__miruOptionalFontLoadFailures?.includes(font)) {
    if (options.failOnError) {
      throw new Error(`Forced optional font load failure: ${font}`)
    }

    return false
  }

  let loading = optionalFontLoadPromises.get(font)

  if (!loading) {
    loading = Promise.all(
      optionalFontFaces[font].map(async (definition) => {
        const face = new FontFace(definition.family, definition.source, definition.descriptors)
        const loadedFace = await face.load()
        document.fonts.add(loadedFace)
      }),
    ).then(() => undefined)

    optionalFontLoadPromises.set(font, loading)
    loading.catch(() => {
      optionalFontLoadPromises.delete(font)
    })
  }

  try {
    await loading
    return true
  }
  catch (error) {
    if (options.failOnError) {
      throw error
    }

    return false
  }
}
