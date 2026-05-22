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
}>()

const emit = defineEmits<{
  activeHeadingChange: [id: string]
  outlineChange: [items: ReaderOutlineItem[]]
}>()

const articleRef = useTemplateRef<HTMLElement>('article')
const contentRef = useTemplateRef<HTMLElement>('content')
const outlineItems = shallowRef<ReaderOutlineItem[]>([])
let cleanupCollapsibleHeadings: (() => void) | undefined
let cleanupOutlineSpy: (() => void) | undefined
let outlineSyncFrame: number | undefined

onMounted(() => {
  void enhanceCurrentContent()
})

watch(() => props.html.value, () => {
  void enhanceCurrentContent()
})

onBeforeUnmount(() => {
  cleanupCollapsibleHeadings?.()
  cleanupOutlineSpy?.()
})

defineExpose({
  focus: () => articleRef.value?.focus(),
  scrollToHeading,
})

function scrollToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
}

async function enhanceCurrentContent(): Promise<void> {
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
    return
  }

  outlineItems.value = []
  emit('outlineChange', [])
  emit('activeHeadingChange', '')
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
  const section = heading.closest<HTMLElement>('[data-reader-section]')

  if (!section?.hidden) {
    return
  }

  const row = section.previousElementSibling
  const toggle = row?.querySelector<HTMLButtonElement>('[data-reader-heading-toggle]')

  if (toggle?.getAttribute('aria-expanded') === 'false') {
    toggle.click()
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
      <p class="reader-footer__mark" aria-label="miru">
        miru.
      </p>
      <p class="reader-footer__line">
        安静地读 Markdown · 文档留在本机 · 隐私是默认
      </p>
      <nav class="reader-footer__links" aria-label="miru 相关链接">
        <button class="reader-footer__link" type="button" @click="scrollToTop">
          ↑ 回到顶部
        </button>
        <a
          class="reader-footer__link"
          href="https://github.com/LoTwT/miru"
          target="_blank"
          rel="noreferrer"
        >
          源码 (GitHub)
        </a>
        <a
          class="reader-footer__link"
          href="https://commonmark.org/"
          target="_blank"
          rel="noreferrer"
        >
          CommonMark
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

.reader-footer {
  margin-block-start: clamp(4rem, 11vw, 7rem);
  padding-block: 1.25rem clamp(2rem, 7vw, 4.5rem);
  border-block-start: 1px solid color-mix(in srgb, var(--reading-fg-muted) 30%, transparent);
  color: var(--reading-fg-muted);
  font-family: system-ui, sans-serif;
  font-size: 0.86rem;
}

.reader-footer__mark {
  margin: 0;
  color: var(--reading-fg);
  font-family: var(--reading-font-body);
  font-size: 1.18rem;
  line-height: 1;
}

.reader-footer__line {
  margin: 0.7rem 0 0;
}

.reader-footer__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.8rem;
  align-items: center;
  margin-block-start: 0.75rem;
}

.reader-footer__link {
  display: inline-flex;
  align-items: center;
  min-block-size: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--reading-link);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.reader-footer__link:hover,
.reader-footer__link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 0.22em;
}
</style>
