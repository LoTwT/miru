<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import type { ReaderOutlineItem } from '@/features/reader/outlineNavigation'
import type { ReadingOutlinePositionId } from '@/features/settings/readingSettingsOptions'

type ReaderOutlineMode = 'rail' | 'sheet'

const props = defineProps<{
  activeId: string
  isOpen: boolean
  items: readonly ReaderOutlineItem[]
  mode: ReaderOutlineMode
  position: ReadingOutlinePositionId
  progressLabel?: string
}>()

const emit = defineEmits<{
  close: [options?: { restoreFocus?: boolean }]
  navigate: [id: string]
}>()

const isHovering = shallowRef(false)
const isFocusWithin = shallowRef(false)
const isReceded = shallowRef(false)
const prefersReducedMotion = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')
const panelRef = useTemplateRef<HTMLElement>('panel')

let lastScrollY = 0
let recedeTimer: ReturnType<typeof setTimeout> | undefined
let mediaQuery: MediaQueryList | undefined

const hasOutline = computed(() => props.items.length > 0)

function focusFirstOutlineItem(): void {
  window.setTimeout(() => {
    const item = panelRef.value?.querySelector<HTMLElement>('[data-outline-item]')
    if (item && item.offsetParent !== null) {
      item.focus()
    }
  }, 0)
}

function navigateTo(id: string): void {
  emit('close')
  emit('navigate', id)
}

function onFocusIn(): void {
  isFocusWithin.value = true
  isReceded.value = false
}

function onFocusOut(event: FocusEvent): void {
  const nextTarget = event.relatedTarget

  if (!(nextTarget instanceof Node) || !rootRef.value?.contains(nextTarget)) {
    isFocusWithin.value = false
  }
}

function onWindowScroll(): void {
  const currentY = window.scrollY
  const delta = currentY - lastScrollY

  window.clearTimeout(recedeTimer)

  if (currentY < 160 || delta < -6) {
    isReceded.value = false
  }
  else if (delta > 6 && !prefersReducedMotion.value) {
    recedeTimer = window.setTimeout(() => {
      if (!props.isOpen && !isFocusWithin.value && !isHovering.value) {
        isReceded.value = true
      }
    }, 520)
  }

  lastScrollY = currentY
}

function onWindowMouseMove(): void {
  if (!props.isOpen && !prefersReducedMotion.value) {
    isReceded.value = false
  }
}

function syncReducedMotion(): void {
  prefersReducedMotion.value = mediaQuery?.matches ?? false

  if (prefersReducedMotion.value) {
    isReceded.value = false
  }
}

function outlineItemClass(item: ReaderOutlineItem) {
  return [
    'reader-outline__item',
    `reader-outline__item--h${item.level}`,
    { 'reader-outline__item--active': props.activeId === item.id },
  ]
}

watch(hasOutline, (value) => {
  if (!value) {
    emit('close')
  }
})

watch(() => props.isOpen, async (value) => {
  if (value && props.mode === 'sheet') {
    isReceded.value = false
    await nextTick()
    focusFirstOutlineItem()
  }
})

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncReducedMotion()
  lastScrollY = window.scrollY

  if (props.mode === 'sheet' && props.isOpen) {
    focusFirstOutlineItem()
  }

  mediaQuery.addEventListener('change', syncReducedMotion)
  window.addEventListener('scroll', onWindowScroll, { passive: true })
  window.addEventListener('mousemove', onWindowMouseMove, { passive: true })
})

onUnmounted(() => {
  window.clearTimeout(recedeTimer)
  mediaQuery?.removeEventListener('change', syncReducedMotion)
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('mousemove', onWindowMouseMove)
})
</script>

<template>
  <nav
    v-if="hasOutline && (props.mode === 'rail' || props.isOpen)"
    ref="root"
    class="reader-outline"
    :class="{
      'reader-outline--dimmed': props.mode === 'rail' && isReceded && !props.isOpen && !isHovering && !isFocusWithin && !prefersReducedMotion,
      'reader-outline--open': props.isOpen,
      'reader-outline--rail': props.mode === 'rail',
      'reader-outline--sheet': props.mode === 'sheet',
      'reader-outline--left': props.position === 'left',
      'reader-outline--right': props.position === 'right',
    }"
    aria-label="文档大纲"
    data-testid="reader-outline"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @pointerenter="isHovering = true; isReceded = false"
    @pointerleave="isHovering = false"
    @pointerdown="isReceded = false"
  >
    <div v-if="props.mode === 'rail'" class="reader-outline__rail" data-testid="reader-outline-rail">
      <p class="reader-outline__label">
        文档大纲
      </p>
      <p v-if="props.progressLabel" class="reader-outline__progress">
        {{ props.progressLabel }}
      </p>
      <ol class="reader-outline__list">
        <li v-for="item in props.items" :key="item.id" class="reader-outline__list-item">
          <a
            :class="outlineItemClass(item)"
            :href="`#${item.id}`"
            :aria-current="props.activeId === item.id ? 'location' : undefined"
            data-outline-item
            @click.prevent="navigateTo(item.id)"
          >
            <span class="reader-outline__tick" aria-hidden="true" />
            <span class="reader-outline__text">{{ item.title }}</span>
          </a>
        </li>
      </ol>
    </div>

    <div
      v-if="props.mode === 'sheet' && props.isOpen"
      id="reader-outline-panel"
      ref="panel"
      class="reader-outline__panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="reader-outline-title"
      data-testid="reader-outline-panel"
    >
      <div class="reader-outline__handle" aria-hidden="true" />

      <header class="reader-outline__header">
        <div>
          <h2 id="reader-outline-title" class="reader-outline__title">
            文档大纲
          </h2>
          <p class="reader-outline__caption">
            {{ props.progressLabel ? `${props.progressLabel} · 跳到当前文档的标题` : '跳到当前文档的标题' }}
          </p>
        </div>
        <button
          class="reader-outline__close"
          type="button"
          aria-label="关闭文档大纲"
          @click="emit('close', { restoreFocus: true })"
        >
          ×
        </button>
      </header>

      <ol class="reader-outline__sheet-list">
        <li v-for="item in props.items" :key="item.id" class="reader-outline__list-item">
          <a
            :class="outlineItemClass(item)"
            :href="`#${item.id}`"
            :aria-current="props.activeId === item.id ? 'location' : undefined"
            data-outline-item
            @click.prevent="navigateTo(item.id)"
          >
            <span class="reader-outline__tick" aria-hidden="true" />
            <span class="reader-outline__text">{{ item.title }}</span>
          </a>
        </li>
      </ol>
    </div>
  </nav>
</template>

<style scoped>
.reader-outline {
  position: fixed;
  z-index: 20;
  color: var(--reading-fg);
  font-family: system-ui, sans-serif;
}

.reader-outline--sheet {
  position: static;
  z-index: auto;
}

.reader-outline__rail {
  display: none;
}

.reader-outline__panel {
  position: fixed;
  right: 0;
  bottom: 0;
  inline-size: 100vw;
  max-block-size: min(72vh, 34rem);
  overflow-y: auto;
  padding: 0.72rem 1rem max(1rem, calc(env(safe-area-inset-bottom) + 1rem));
  border: 1px solid var(--reading-rule);
  border-inline: 0;
  border-block-end: 0;
  border-radius: 18px 18px 0 0;
  background: color-mix(in srgb, var(--reading-bg) 94%, transparent);
  box-shadow: 0 18px 44px rgb(0 0 0 / 16%);
  backdrop-filter: blur(16px);
}

.reader-outline__handle {
  inline-size: 2.7rem;
  block-size: 0.28rem;
  margin: 0 auto 0.7rem;
  border-radius: 999px;
  background: var(--reading-rule);
}

.reader-outline__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.8rem;
}

.reader-outline__title,
.reader-outline__caption {
  margin: 0;
}

.reader-outline__title {
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: 1.05rem;
  line-height: 1.2;
}

.reader-outline__caption {
  margin-block-start: 0.2rem;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
}

.reader-outline__progress {
  margin: 0.3rem 0 0;
  color: var(--reading-fg-muted);
  font-size: 0.72rem;
}

.reader-outline__close {
  display: grid;
  place-items: center;
  inline-size: 44px;
  block-size: 44px;
  border: 1px solid var(--reading-rule);
  border-radius: 50%;
  background: var(--reading-bg);
  color: var(--reading-fg-muted);
  cursor: pointer;
  font: inherit;
}

.reader-outline__list,
.reader-outline__sheet-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.reader-outline__list-item + .reader-outline__list-item {
  margin-block-start: 0.16rem;
}

.reader-outline__item {
  display: grid;
  grid-template-columns: 0.42rem minmax(0, 1fr);
  gap: 0.48rem;
  align-items: center;
  min-block-size: 36px;
  border-radius: 10px;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
  line-height: 1.25;
  text-decoration: none;
}

.reader-outline__item--h2 {
  padding-inline-start: 0.72rem;
}

.reader-outline__item--h3 {
  padding-inline-start: 1.35rem;
  font-size: 0.78rem;
}

.reader-outline__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-outline__tick {
  inline-size: 0.18rem;
  block-size: 1.3em;
  border-radius: 999px;
  background: transparent;
}

.reader-outline__item--active {
  color: var(--reading-fg);
  font-weight: 650;
}

.reader-outline__item--active .reader-outline__tick {
  background: var(--reading-accent);
}

.reader-outline__item:hover,
.reader-outline__item:focus-visible,
.reader-outline__close:hover,
.reader-outline__close:focus-visible {
  color: var(--reading-fg);
}

.reader-outline__sheet-list .reader-outline__item {
  padding-inline-end: 0.7rem;
  padding-inline-start: calc(var(--outline-indent, 0rem) + 0.55rem);
}

.reader-outline__sheet-list .reader-outline__item--h2 {
  --outline-indent: 0.8rem;
}

.reader-outline__sheet-list .reader-outline__item--h3 {
  --outline-indent: 1.55rem;
}

@media (max-width: 1099px) {
  .reader-outline--rail {
    display: none;
  }
}

@media (min-width: 1100px) {
  .reader-outline {
    --reader-outline-edge: min(32.5ch, 50vw - 18rem);
    --reader-outline-rail-size: 12rem;
    --reader-outline-right-gap: 4rem;
    --reader-outline-left-gap: 5rem;

    inset-block-start: 27vh;
    inline-size: var(--reader-outline-rail-size);
    opacity: 0.72;
    transition: opacity 160ms ease;
  }

  .reader-outline--right {
    inset-inline-start: calc(50% + var(--reader-outline-edge) + var(--reader-outline-right-gap));
  }

  .reader-outline--left {
    inset-inline-start: calc(50% - var(--reader-outline-edge) - var(--reader-outline-rail-size) - var(--reader-outline-left-gap));
  }

  .reader-outline--dimmed {
    opacity: 0.34;
  }

  .reader-outline:focus-within,
  .reader-outline:hover {
    opacity: 1;
  }

  .reader-outline__rail {
    display: block;
    padding: 0.4rem 0;
  }

  .reader-outline__label {
    margin: 0 0 0.45rem 0.9rem;
    color: var(--reading-fg-muted);
    font-size: 0.72rem;
    letter-spacing: 0;
  }

  .reader-outline__rail .reader-outline__progress {
    margin: -0.25rem 0 0.45rem 0.9rem;
  }

  .reader-outline__panel {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reader-outline {
    opacity: 1;
    transition: none;
  }
}
</style>
