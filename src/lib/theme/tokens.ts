export interface ReadingTheme {
  id: string
  label: string
  tokens: Record<`--reading-${string}`, string>
}

export interface PersistedReadingSettings {
  version: 1
  presetId?: string
  tokenOverrides?: Record<`--reading-${string}`, string>
  fontBody?: string
  remoteImageMode?: 'auto' | 'prompt' | 'block'
}

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
    '--reading-font-body': 'Newsreader, Georgia, serif',
    '--reading-font-heading': 'Newsreader, Georgia, serif',
    '--reading-font-mono': '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    '--reading-paragraph-gap': '1.12em',
    '--reading-scale-h1': '3.6rem',
    '--reading-scale-h2': '2.2rem',
    '--reading-scale-h3': '1.35rem',
    '--reading-scale-h4': '1.125rem',
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
      remoteImageMode: isRemoteImageMode(parsed.remoteImageMode) ? parsed.remoteImageMode : undefined,
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
}

function sanitizeTokenOverrides(value: unknown): Record<`--reading-${string}`, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const result: Record<`--reading-${string}`, string> = {}

  for (const [key, tokenValue] of Object.entries(value)) {
    if (key.startsWith('--reading-') && typeof tokenValue === 'string') {
      result[key as `--reading-${string}`] = tokenValue
    }
  }

  return result
}

function isRemoteImageMode(value: unknown): value is PersistedReadingSettings['remoteImageMode'] {
  return value === 'auto' || value === 'prompt' || value === 'block'
}
