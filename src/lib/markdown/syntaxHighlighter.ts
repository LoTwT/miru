import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createHighlighterCore } from 'shiki/core'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import type { LanguageRegistration } from 'shiki/core'

export interface MarkdownCodeFence {
  code: string
  index: number
  info: string
}

const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [githubLight, githubDark],
  langs: [],
})

const languageLoaders = {
  bash: () => import('shiki/langs/bash.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
} as const

type SupportedLanguage = keyof typeof languageLoaders
type Highlighter = Awaited<typeof highlighterPromise>

const supportedLanguages = new Set<SupportedLanguage>(Object.keys(languageLoaders) as SupportedLanguage[])
const loadedLanguagePromises = new Map<SupportedLanguage, Promise<void>>()

export async function highlightMarkdownCodeFences(fences: readonly MarkdownCodeFence[]): Promise<Map<number, string>> {
  const highlighter = await highlighterPromise
  const highlightedFences = new Map<number, string>()

  await Promise.all(fences.map(async (fence) => {
    const language = normalizeLanguage(fence.info)
    await ensureLanguage(highlighter, language)
    highlightedFences.set(fence.index, highlighter.codeToHtml(fence.code, {
      lang: language,
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: 'light',
    }))
  }))

  return highlightedFences
}

function normalizeLanguage(info: string): string {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase()

  if (!language) {
    return 'text'
  }

  if (language === 'ts') {
    return 'typescript'
  }

  if (supportedLanguages.has(language as SupportedLanguage)) {
    return language as SupportedLanguage
  }

  return 'text'
}

async function ensureLanguage(highlighter: Highlighter, language: string): Promise<void> {
  if (language === 'text') {
    return
  }

  const supportedLanguage = language as SupportedLanguage
  if (!supportedLanguages.has(supportedLanguage) || highlighter.getLoadedLanguages().includes(supportedLanguage)) {
    return
  }

  const pending = loadedLanguagePromises.get(supportedLanguage)
  if (pending) {
    await pending
    return
  }

  const nextPending = loadLanguage(highlighter, supportedLanguage)
  loadedLanguagePromises.set(supportedLanguage, nextPending)
  await nextPending
}

async function loadLanguage(highlighter: Highlighter, language: SupportedLanguage): Promise<void> {
  const registration = (await languageLoaders[language]()).default as unknown as LanguageRegistration | LanguageRegistration[]
  await highlighter.loadLanguage(...(Array.isArray(registration) ? registration : [registration]))
}
