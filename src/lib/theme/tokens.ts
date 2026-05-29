export interface ReadingTheme {
  id: string
  label: string
  tokens: Record<ReadingTokenName, string>
}

export type ReadingTokenName = `--reading-${string}`

export interface PersistedReadingSettings {
  version: 1
  presetId?: string
  tokenOverrides?: Record<ReadingTokenName, string>
  fontBody?: string
  customTheme?: {
    bg: string
    fg: string
    accent: string
  }
  remoteImageMode?: 'auto' | 'prompt' | 'block'
  contrast?: 'soft' | 'standard' | 'strong'
  outlinePosition?: 'left' | 'right'
}

type PersistedCustomTheme = NonNullable<PersistedReadingSettings['customTheme']>

const storageKey = 'miru:reading-settings:v1'

export const defaultReadingTheme: ReadingTheme = {
  id: 'miru-default',
  label: 'Miru Default',
  tokens: {
    '--reading-bg': '#fbf8f1',
    '--reading-fg': '#24211d',
    '--reading-fg-muted': '#6f685f',
    '--reading-link': '#275f71',
    '--reading-link-hover': '#1d4f60',
    '--reading-accent': '#9d5f34',
    '--reading-rule': '#ded3c4',
    '--reading-code-fg': '#24211d',
    '--reading-code-bg': '#f0eadf',
    '--reading-measure': '65ch',
    '--reading-font-size': '18px',
    '--reading-line-height': '1.7',
    '--reading-letter-spacing': '0',
    '--reading-page-margin': 'clamp(1.25rem, 4vw, 4rem)',
    '--reading-font-body': '"Newsreader", Georgia, "Songti SC", "Noto Serif CJK SC", serif',
    '--reading-font-heading': 'Newsreader, Georgia, serif',
    '--reading-font-mono': '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    '--reading-paragraph-gap': '1.12em',
    '--reading-scale-h1': 'calc(var(--reading-font-size) * 3.2)',
    '--reading-scale-h2': 'calc(var(--reading-font-size) * 1.95)',
    '--reading-scale-h3': 'calc(var(--reading-font-size) * 1.2)',
    '--reading-scale-h4': 'var(--reading-font-size)',
  },
}

export const darkReadingTheme: ReadingTheme = {
  id: 'miru-default-dark',
  label: 'Miru Default Dark',
  tokens: {
    ...defaultReadingTheme.tokens,
    '--reading-bg': '#171615',
    '--reading-fg': '#ebe4d7',
    '--reading-fg-muted': '#b0a797',
    '--reading-link': '#8dc7d7',
    '--reading-link-hover': '#bce8f2',
    '--reading-accent': '#d99663',
    '--reading-rule': '#3b352f',
    '--reading-code-fg': '#ebe4d7',
    '--reading-code-bg': '#22201e',
  },
}

export const readingThemeRegistry = [defaultReadingTheme, darkReadingTheme] as const

export function applyReadingTheme(theme: ReadingTheme, root: HTMLElement = document.documentElement): void {
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(token, value)
  }
}

export function setReadingToken(token: `--reading-${string}`, value: string, root: HTMLElement = document.documentElement): void {
  root.style.setProperty(token, value)
}

export function clearReadingToken(token: ReadingTokenName, root: HTMLElement = document.documentElement): void {
  root.style.removeProperty(token)
}

export function writePersistedReadingSettings(
  settings: PersistedReadingSettings,
  storage: Storage = localStorage,
): void {
  storage.setItem(storageKey, JSON.stringify(settings))
}

export function clearPersistedReadingSettings(storage: Storage = localStorage): void {
  storage.removeItem(storageKey)
}

export function readPersistedReadingSettings(storage: Storage = localStorage): PersistedReadingSettings | null {
  const raw = storage.getItem(storageKey)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedReadingSettings>

    if (parsed.version !== 1) {
      return null
    }

    return {
      version: 1,
      presetId: parsed.presetId,
      tokenOverrides: sanitizeTokenOverrides(parsed.tokenOverrides),
      fontBody: typeof parsed.fontBody === 'string' ? parsed.fontBody : undefined,
      customTheme: sanitizeCustomTheme(parsed.customTheme),
      remoteImageMode: isRemoteImageMode(parsed.remoteImageMode) ? parsed.remoteImageMode : undefined,
      contrast: isContrastMode(parsed.contrast) ? parsed.contrast : undefined,
      outlinePosition: isOutlinePosition(parsed.outlinePosition) ? parsed.outlinePosition : undefined,
    }
  }
  catch {
    return null
  }
}

export function applyPersistedReadingSettings(settings: PersistedReadingSettings | null, root: HTMLElement = document.documentElement): void {
  if (!settings) {
    return
  }

  if (settings.fontBody) {
    setReadingToken('--reading-font-body', settings.fontBody, root)
  }

  if (settings.tokenOverrides) {
    for (const [token, value] of Object.entries(settings.tokenOverrides)) {
      setReadingToken(token as `--reading-${string}`, value, root)
    }
  }

  if (settings.contrast && settings.contrast !== 'standard') {
    root.dataset.readingContrast = settings.contrast
    return
  }

  delete root.dataset.readingContrast
}

function sanitizeTokenOverrides(value: unknown): Record<ReadingTokenName, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const result: Record<ReadingTokenName, string> = {}

  for (const [key, tokenValue] of Object.entries(value)) {
    if (key.startsWith('--reading-') && typeof tokenValue === 'string') {
      result[key as ReadingTokenName] = tokenValue
    }
  }

  return result
}

function sanitizeCustomTheme(value: unknown): PersistedReadingSettings['customTheme'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const customTheme = value as Partial<PersistedCustomTheme>

  if (isHexColor(customTheme.bg) && isHexColor(customTheme.fg) && isHexColor(customTheme.accent)) {
    return {
      bg: customTheme.bg.toLowerCase(),
      fg: customTheme.fg.toLowerCase(),
      accent: customTheme.accent.toLowerCase(),
    }
  }

  return undefined
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}

function isRemoteImageMode(value: unknown): value is PersistedReadingSettings['remoteImageMode'] {
  return value === 'auto' || value === 'prompt' || value === 'block'
}

function isOutlinePosition(value: unknown): value is PersistedReadingSettings['outlinePosition'] {
  return value === 'left' || value === 'right'
}

function isContrastMode(value: unknown): value is PersistedReadingSettings['contrast'] {
  return value === 'soft' || value === 'standard' || value === 'strong'
}
