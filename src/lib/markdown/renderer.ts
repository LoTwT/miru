import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import bash from 'shiki/langs/bash.mjs'
import css from 'shiki/langs/css.mjs'
import html from 'shiki/langs/html.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import json from 'shiki/langs/json.mjs'
import markdownLang from 'shiki/langs/markdown.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import vue from 'shiki/langs/vue.mjs'
import { createHighlighterCore } from 'shiki/core'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'

import { toTrustedHtml } from '@/lib/security/sanitize'
import { isRemoteImageUrl, isSafeImageUrl, isSafeLinkUrl } from '@/lib/security/urlPolicy'
import type { RemoteImageMode, TrustedHtml } from '@/types/reader'
import type Token from 'markdown-it/lib/token.mjs'

interface RenderMarkdownOptions {
  colorScheme?: 'light' | 'dark'
  remoteImageMode?: RemoteImageMode
}

const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [githubLight, githubDark],
  langs: [bash, css, html, javascript, json, markdownLang, typescript, vue],
})

const supportedLanguages = new Set(['bash', 'css', 'html', 'javascript', 'json', 'markdown', 'typescript', 'vue'])

const md = MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(taskLists, { enabled: false, label: true })
  .use(anchor, {
    permalink: anchor.permalink.headerLink(),
  })

md.validateLink = (url) => isSafeLinkUrl(url) || isSafeImageUrl(url)

const defaultLinkOpen = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]?.attrGet('href')

  if (!href || !isSafeLinkUrl(href)) {
    env.miruBlockedLinkCloseCount = (env.miruBlockedLinkCloseCount ?? 0) + 1
    return ''
  }

  if (/^(?:https?:)?\/\//i.test(href)) {
    tokens[idx]?.attrSet('target', '_blank')
    tokens[idx]?.attrSet('rel', 'noopener noreferrer')
  }

  return defaultLinkOpen?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
}

const defaultLinkClose = md.renderer.rules.link_close
md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
  if (env.miruBlockedLinkCloseCount > 0) {
    env.miruBlockedLinkCloseCount -= 1
    return ''
  }

  return defaultLinkClose?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
}

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]
  const src = token?.attrGet('src') ?? ''
  const alt = token?.content ?? ''
  const mode = (token?.meta?.remoteImageMode ?? 'auto') as RemoteImageMode

  if (!isSafeImageUrl(src)) {
    return `<span class="markdown-image-placeholder" role="note">已拦截不安全图片链接：${md.utils.escapeHtml(alt || src)}</span>`
  }

  const escapedSrc = md.utils.escapeHtml(src)
  const escapedAlt = md.utils.escapeHtml(alt)
  const isRemoteImage = isRemoteImageUrl(src)

  if (mode === 'block' && isRemoteImage) {
    return `<span class="markdown-image-placeholder" role="note">远程图片已屏蔽：<a href="${escapedSrc}" target="_blank" rel="noopener noreferrer">${escapedAlt || escapedSrc}</a></span>`
  }

  if (mode === 'prompt' && isRemoteImage) {
    return `<span class="markdown-image-placeholder" role="note" data-src="${escapedSrc}">远程图片待加载：${escapedAlt || escapedSrc}</span>`
  }

  return `<img src="${escapedSrc}" alt="${escapedAlt}" referrerpolicy="no-referrer" loading="lazy" decoding="async">`
}

export async function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): Promise<TrustedHtml> {
  const colorScheme = options.colorScheme ?? 'light'
  const remoteImageMode = options.remoteImageMode ?? 'auto'
  const highlighter = await highlighterPromise
  const tokens = md.parse(markdown, {})
  const highlightedFences = new Map<number, string>()

  await Promise.all(tokens.map(async (token, index) => {
    if (token.type !== 'fence') {
      return
    }

    const language = normalizeLanguage(token.info)
    const html = highlighter.codeToHtml(token.content, {
      lang: language,
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: 'light',
    })

    highlightedFences.set(index, html)
  }))

  applyRemoteImageMode(tokens, remoteImageMode)

  const defaultFence = md.renderer.rules.fence
  md.renderer.rules.fence = (renderTokens, idx, renderOptions, env, self) => {
    return highlightedFences.get(idx) ?? defaultFence?.(renderTokens, idx, renderOptions, env, self) ?? self.renderToken(renderTokens, idx, renderOptions)
  }

  return toTrustedHtml(md.renderer.render(tokens, md.options, {}))
}

function normalizeLanguage(info: string): string {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase()

  if (!language) {
    return 'text'
  }

  if (language === 'ts') {
    return 'typescript'
  }

  if (supportedLanguages.has(language)) {
    return language
  }

  return 'text'
}

function applyRemoteImageMode(tokens: Token[], remoteImageMode: RemoteImageMode): void {
  for (const token of tokens) {
    if (token.type === 'image') {
      token.meta = { ...token.meta, remoteImageMode }
    }

    if (token.children) {
      applyRemoteImageMode(token.children, remoteImageMode)
    }
  }
}
