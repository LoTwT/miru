<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import { enhanceCollapsibleHeadings } from '@/features/reader/collapsibleHeadings'
import { collectOutlineItems } from '@/features/reader/outlineNavigation'
import type { ReaderOutlineItem } from '@/features/reader/outlineNavigation'
import type { ReaderDocument, TrustedHtml } from '@/types/reader'

const props = defineProps<{
  document: ReaderDocument
  html: TrustedHtml
  isRendering: boolean
  searchQuery: string
}>()

const emit = defineEmits<{
  activeHeadingChange: [id: string]
  outlineChange: [items: ReaderOutlineItem[]]
  searchChange: [state: { activeIndex: number, total: number }]
}>()

const articleRef = useTemplateRef<HTMLElement>('article')
const contentRef = useTemplateRef<HTMLElement>('content')
const outlineItems = shallowRef<ReaderOutlineItem[]>([])
const searchMatches = shallowRef<HTMLElement[]>([])
const activeSearchIndex = shallowRef(-1)
let cleanupCollapsibleHeadings: (() => void) | undefined
let cleanupOutlineSpy: (() => void) | undefined
let outlineSyncFrame: number | undefined

onMounted(() => {
  void enhanceCurrentContent()
})

watch(() => props.html.value, () => {
  void enhanceCurrentContent()
})

watch(() => props.searchQuery, () => {
  applySearchQuery()
})

onBeforeUnmount(() => {
  clearSearchHighlights()
  cleanupCollapsibleHeadings?.()
  cleanupOutlineSpy?.()
})

defineExpose({
  clearSearch: () => applySearchQuery(''),
  focus: () => articleRef.value?.focus(),
  getBookmarkSnippet,
  goToSearchMatch,
  scrollToHeading,
})

async function enhanceCurrentContent(): Promise<void> {
  clearSearchHighlights()
  cleanupCollapsibleHeadings?.()
  cleanupCollapsibleHeadings = undefined
  cleanupOutlineSpy?.()
  cleanupOutlineSpy = undefined

  await nextTick()

  if (contentRef.value) {
    cleanupCollapsibleHeadings = enhanceCollapsibleHeadings(contentRef.value)
    outlineItems.value = collectOutlineItems(contentRef.value)
    emit('outlineChange', outlineItems.value)
    cleanupOutlineSpy = setupOutlineSpy(outlineItems.value)
    syncActiveHeading()
    applySearchQuery()
    return
  }

  outlineItems.value = []
  searchMatches.value = []
  activeSearchIndex.value = -1
  emit('outlineChange', [])
  emit('activeHeadingChange', '')
  emitSearchState()
}

async function scrollToHeading(id: string): Promise<void> {
  const heading = findHeadingById(id)

  if (!heading) {
    return
  }

  heading.tabIndex = -1
  expandCollapsedParentSection(heading)

  await nextTick()

  window.requestAnimationFrame(() => {
    heading.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
    updateHash(id)
    emit('activeHeadingChange', id)

    window.setTimeout(() => {
      if (heading.isConnected) {
        heading.focus({ preventScroll: true })
      }
    }, 0)
  })
}

function goToSearchMatch(delta: number): void {
  if (searchMatches.value.length === 0) {
    emitSearchState()
    return
  }

  const nextIndex = activeSearchIndex.value < 0
    ? 0
    : (activeSearchIndex.value + delta + searchMatches.value.length) % searchMatches.value.length

  setActiveSearchMatch(nextIndex, { shouldScroll: true })
}

function getBookmarkSnippet(): string {
  const visibleHeading = getVisibleHeadingText()
  const visibleText = getVisibleParagraphText()
  return normalizeText(visibleHeading || visibleText || props.document.label).slice(0, 48) || '当前位置'
}

function applySearchQuery(query = props.searchQuery): void {
  clearSearchHighlights()

  const normalizedQuery = query.trim()
  const content = contentRef.value
  if (!content || !normalizedQuery) {
    searchMatches.value = []
    activeSearchIndex.value = -1
    emitSearchState()
    return
  }

  const matches: HTMLElement[] = []
  const queryLower = normalizedQuery.toLocaleLowerCase()
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || shouldSkipSearchNode(parent) || !node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT
      }

      return node.nodeValue.toLocaleLowerCase().includes(queryLower)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })
  const textNodes: Text[] = []
  let node = walker.nextNode()

  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  for (const textNode of textNodes) {
    matches.push(...highlightTextNode(textNode, normalizedQuery, queryLower))
  }

  searchMatches.value = matches
  setActiveSearchMatch(matches.length > 0 ? 0 : -1, { shouldScroll: false })
}

function highlightTextNode(node: Text, query: string, queryLower: string): HTMLElement[] {
  const text = node.nodeValue ?? ''
  const textLower = text.toLocaleLowerCase()
  const fragment = document.createDocumentFragment()
  const matches: HTMLElement[] = []
  let cursor = 0
  let index = textLower.indexOf(queryLower)

  while (index !== -1) {
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)))
    }

    const mark = document.createElement('mark')
    mark.className = 'reader-search-match'
    mark.dataset.readerSearchMatch = ''
    mark.textContent = text.slice(index, index + query.length)
    fragment.append(mark)
    matches.push(mark)

    cursor = index + query.length
    index = textLower.indexOf(queryLower, cursor)
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)))
  }

  node.replaceWith(fragment)
  return matches
}

function clearSearchHighlights(): void {
  const content = contentRef.value
  if (!content) {
    return
  }

  for (const mark of Array.from(content.querySelectorAll<HTMLElement>('mark[data-reader-search-match]'))) {
    const parent = mark.parentNode
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
    parent?.normalize()
  }
}

function setActiveSearchMatch(index: number, options: { shouldScroll: boolean }): void {
  activeSearchIndex.value = index

  searchMatches.value.forEach((match, matchIndex) => {
    match.classList.toggle('reader-search-match--active', matchIndex === index)
  })

  if (index >= 0 && options.shouldScroll) {
    const match = searchMatches.value[index]
    if (match) {
      expandCollapsedAncestorSections(match)
      window.requestAnimationFrame(() => {
        match.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
      })
    }
  }

  emitSearchState()
}

function emitSearchState(): void {
  emit('searchChange', {
    activeIndex: activeSearchIndex.value,
    total: searchMatches.value.length,
  })
}

function setupOutlineSpy(items: ReaderOutlineItem[]): () => void {
  if (items.length === 0) {
    emit('activeHeadingChange', '')
    return () => {}
  }

  for (const item of items) {
    const heading = findHeadingById(item.id)
    if (heading) {
      heading.tabIndex = -1
    }
  }

  const onScrollOrResize = () => queueActiveHeadingSync()

  window.addEventListener('scroll', onScrollOrResize, { passive: true })
  window.addEventListener('resize', onScrollOrResize, { passive: true })

  return () => {
    window.removeEventListener('scroll', onScrollOrResize)
    window.removeEventListener('resize', onScrollOrResize)

    if (outlineSyncFrame !== undefined) {
      window.cancelAnimationFrame(outlineSyncFrame)
      outlineSyncFrame = undefined
    }
  }
}

function queueActiveHeadingSync(): void {
  if (outlineSyncFrame !== undefined) {
    window.cancelAnimationFrame(outlineSyncFrame)
  }

  outlineSyncFrame = window.requestAnimationFrame(() => {
    outlineSyncFrame = undefined
    syncActiveHeading()
  })
}

function syncActiveHeading(): void {
  if (outlineItems.value.length === 0) {
    emit('activeHeadingChange', '')
    return
  }

  if (isPageScrollLocked()) {
    return
  }

  const visibleHeadings = outlineItems.value
    .map(item => ({ id: item.id, heading: findHeadingById(item.id) }))
    .filter((entry): entry is { id: string, heading: HTMLElement } =>
      entry.heading !== null && !entry.heading.closest('[hidden]'),
    )

  if (visibleHeadings.length === 0) {
    emit('activeHeadingChange', outlineItems.value[0]?.id ?? '')
    return
  }

  if (isNearPageBottom()) {
    emit('activeHeadingChange', visibleHeadings.at(-1)?.id ?? '')
    return
  }

  const threshold = Math.min(window.innerHeight * 0.32, 220)
  let activeId = visibleHeadings[0]?.id ?? ''

  for (const { id, heading } of visibleHeadings) {
    if (heading.getBoundingClientRect().top <= threshold) {
      activeId = id
    }
    else {
      break
    }
  }

  emit('activeHeadingChange', activeId)
}

function isNearPageBottom(): boolean {
  const scrollElement = document.scrollingElement ?? document.documentElement
  const maxScrollY = scrollElement.scrollHeight - window.innerHeight

  if (maxScrollY <= 1) {
    return false
  }

  const bottomThreshold = Math.max(24, window.innerHeight * 0.02)
  return window.scrollY >= maxScrollY - bottomThreshold
}

function findHeadingById(id: string): HTMLElement | null {
  return contentRef.value?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? null
}

function expandCollapsedParentSection(heading: HTMLElement): void {
  let current: HTMLElement | null = heading

  while (current.parentElement) {
    current = current.parentElement

    if (!current.matches('[data-reader-section]') || !current.hidden) {
      continue
    }

    const row = current.previousElementSibling
    const toggle = row?.querySelector<HTMLButtonElement>('[data-reader-heading-toggle]')

    if (toggle?.getAttribute('aria-expanded') === 'false') {
      toggle.click()
    }
  }
}

function expandCollapsedAncestorSections(element: HTMLElement): void {
  let current: HTMLElement | null = element

  while (current.parentElement) {
    current = current.parentElement

    if (!current.matches('[data-reader-section]') || !current.hidden) {
      continue
    }

    const row = current.previousElementSibling
    const toggle = row?.querySelector<HTMLButtonElement>('[data-reader-heading-toggle]')

    if (toggle?.getAttribute('aria-expanded') === 'false') {
      toggle.click()
    }
  }
}

function updateHash(id: string): void {
  const nextUrl = new URL(window.location.href)
  nextUrl.hash = id
  window.history.pushState(null, '', nextUrl)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isPageScrollLocked(): boolean {
  return document.body.style.position === 'fixed' && document.body.style.top.startsWith('-')
}

function shouldSkipSearchNode(element: HTMLElement): boolean {
  return element.closest('button, script, style, svg, mark[data-reader-search-match]') !== null
}

function getVisibleHeadingText(): string {
  const headings = Array.from(contentRef.value?.querySelectorAll<HTMLElement>('h1, h2, h3') ?? [])
    .filter(heading => !heading.closest('[hidden]'))

  if (headings.length === 0) {
    return ''
  }

  const threshold = Math.min(window.innerHeight * 0.32, 220)
  let currentHeading = headings[0]

  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= threshold) {
      currentHeading = heading
    }
    else {
      break
    }
  }

  return currentHeading?.textContent ?? ''
}

function getVisibleParagraphText(): string {
  const elements = Array.from(contentRef.value?.querySelectorAll<HTMLElement>('p, li, blockquote') ?? [])
    .filter(element => !element.closest('[hidden]'))
  const viewportMiddle = window.innerHeight * 0.45
  const visible = elements.find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.top <= viewportMiddle
  })

  return visible?.textContent ?? ''
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
</script>

<template>
  <article
    ref="article"
    class="reader-surface"
    :aria-busy="props.isRendering ? 'true' : 'false'"
    tabindex="-1"
  >
    <p class="reader-surface__meta">
      {{ props.document.label }}
    </p>
    <!-- v-html is restricted to TrustedHtml returned by the markdown sanitizer pipeline. -->
    <div ref="content" class="reader-surface__content" v-html="props.html.value" />
    <footer class="reader-footer" data-testid="reader-footer">
      <p class="reader-footer__site">
        <span class="reader-footer__brand">miru</span>
        <span class="reader-footer__separator" aria-hidden="true">·</span>
        <span class="reader-footer__privacy">文档留在本机，隐私默认</span>
        <span class="reader-footer__separator" aria-hidden="true">·</span>
        <span class="reader-footer__copyright">© 2026</span>
      </p>
      <nav class="reader-footer__links" aria-label="miru 相关链接">
        <a
          class="reader-footer__link"
          href="https://github.com/LoTwT/miru"
          target="_blank"
          rel="noreferrer"
        >
          <svg
            class="reader-footer__github-icon"
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
          >
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.28 9.28 0 0 1 12 6.99c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.95.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.2 10.2 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z"
            />
          </svg>GitHub
        </a>
        <span class="reader-footer__separator" aria-hidden="true">·</span>
        <a
          class="reader-footer__link"
          href="https://commonmark.org/"
          target="_blank"
          rel="noreferrer"
        >
          CommonMark<svg
            class="reader-footer__external-icon"
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 16 16"
          >
            <path d="M5 11 11 5" />
            <path d="M6 5h5v5" />
          </svg>
        </a>
      </nav>
    </footer>
  </article>
</template>

<style scoped>
.reader-surface {
  inline-size: 100%;
  max-inline-size: min(100%, var(--reading-measure));
  margin-inline: auto;
  padding-block: clamp(2rem, 6vw, 5rem);
}

.reader-surface__meta {
  margin: 0 0 2rem;
  color: var(--reading-fg-muted);
  font-family: system-ui, sans-serif;
  font-size: 0.86rem;
}

.reader-surface__content {
  --reader-heading-gutter: 3.55rem;
  font-family: var(--reading-font-body);
  font-size: var(--reading-font-size);
  line-height: var(--reading-line-height);
}

.reader-surface__content :deep(.reader-search-match) {
  border-radius: 0.18em;
  padding: 0 0.08em;
  background: color-mix(in srgb, var(--reading-accent) 24%, transparent);
  color: inherit;
}

.reader-surface__content :deep(.reader-search-match--active) {
  background: color-mix(in srgb, var(--reading-accent) 42%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--reading-accent) 26%, transparent);
}

.reader-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 1.6rem;
  margin-block-start: clamp(4rem, 11vw, 7rem);
  padding-block: 1.05rem clamp(2.5rem, 7vw, 4.8rem);
  border-block-start: 1px solid color-mix(in srgb, var(--reading-fg-muted) 24%, transparent);
  color: color-mix(in srgb, var(--reading-fg-muted) 86%, transparent);
  font-family: var(--reading-font-mono);
  font-size: 0.73rem;
  letter-spacing: 0.02em;
  line-height: 1.6;
}

.reader-footer__site,
.reader-footer__links {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.58rem;
  margin: 0;
}

.reader-footer__brand {
  color: var(--reading-fg);
}

.reader-footer__link {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  min-block-size: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.reader-footer__github-icon {
  inline-size: 0.86rem;
  block-size: 0.86rem;
  flex: none;
}

.reader-footer__external-icon {
  inline-size: 0.74rem;
  block-size: 0.74rem;
  flex: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.reader-footer__link:hover,
.reader-footer__link:focus-visible {
  color: var(--reading-accent);
}

.reader-footer__link:focus-visible {
  outline: 3px solid var(--reading-focus);
  outline-offset: 3px;
}

.reader-footer__copyright {
  color: color-mix(in srgb, var(--reading-fg-muted) 72%, transparent);
}

.reader-footer__separator {
  color: color-mix(in srgb, var(--reading-fg-muted) 42%, transparent);
}

@media (max-width: 700px) {
  .reader-footer {
    align-items: flex-start;
    justify-content: flex-start;
  }
}
</style>
