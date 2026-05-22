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
</style>
