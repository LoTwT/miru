import MarkdownIt from 'markdown-it'
import type { Env, Token } from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'

import { toTrustedHtml } from '@/lib/security/sanitize'
import { isRemoteImageUrl, isSafeImageUrl, isSafeLinkUrl } from '@/lib/security/urlPolicy'
import type { RemoteImageMode, TrustedHtml } from '@/types/reader'

interface RenderMarkdownOptions {
  remoteImageMode?: RemoteImageMode
  syntaxHighlighting?: boolean
}

interface MiruMarkdownEnv extends Env {
  highlightedFences?: Map<number, string>
}

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
  const href = normalizeAttributeValue(tokens[idx]?.attrGet('href'))

  if (!href || !isSafeLinkUrl(href)) {
    if (env) {
      env.miruBlockedLinkCloseCount = getBlockedLinkCloseCount(env) + 1
    }
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
  const blockedLinkCloseCount = getBlockedLinkCloseCount(env)

  if (blockedLinkCloseCount > 0) {
    if (env) {
      env.miruBlockedLinkCloseCount = blockedLinkCloseCount - 1
    }
    return ''
  }

  return defaultLinkClose?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
}

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]
  const src = normalizeAttributeValue(token?.attrGet('src')) ?? ''
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

const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const highlighted = (env as MiruMarkdownEnv).highlightedFences?.get(idx)
  return highlighted ?? defaultFence?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
}

export async function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): Promise<TrustedHtml> {
  const remoteImageMode = options.remoteImageMode ?? 'auto'
  const env: MiruMarkdownEnv = {}
  const tokens = md.parse(markdown, env)
  const codeFences = tokens.flatMap((token, index) => token.type === 'fence'
    ? [{ code: token.content, index, info: token.info }]
    : [])

  if (options.syntaxHighlighting !== false && codeFences.length > 0) {
    const { highlightMarkdownCodeFences } = await import('./syntaxHighlighter')
    env.highlightedFences = await highlightMarkdownCodeFences(codeFences)
  }

  applyRemoteImageMode(tokens, remoteImageMode)
  return toTrustedHtml(md.renderer.render(tokens, md.options, env))
}

export function hasMarkdownCodeFence(markdown: string): boolean {
  return /^(?: {0,3})(?:`{3,}|~{3,})[^\n]*$/m.test(markdown)
}

function normalizeAttributeValue(value: string | number | null | undefined): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  return typeof value === 'number' ? String(value) : undefined
}

function getBlockedLinkCloseCount(env: Env | undefined): number {
  const count = env?.miruBlockedLinkCloseCount
  return typeof count === 'number' ? count : 0
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
