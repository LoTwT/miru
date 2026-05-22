<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import {
  readingFontFamilyOptions,
  readingFontSizeOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  readingThemeOptions,
} from '@/features/settings/readingSettingsOptions'
import type {
  ReadingFontFamilyId,
  ReadingFontSizeId,
  ReadingLineHeightId,
  ReadingMeasureId,
  ReadingOutlinePositionId,
  ReadingThemeChoice,
} from '@/features/settings/readingSettingsOptions'
import type { ReadingCustomizationState } from '@/features/settings/useReadingSettings'

const props = defineProps<{
  isDefault: boolean
  settings: Readonly<ReadingCustomizationState>
  showOutlinePositionControl: boolean
}>()

const emit = defineEmits<{
  updateFontSize: [value: ReadingFontSizeId]
  updateMeasure: [value: ReadingMeasureId]
  updateLineHeight: [value: ReadingLineHeightId]
  updateFontFamily: [value: ReadingFontFamilyId]
  updateTheme: [value: ReadingThemeChoice]
  updateOutlinePosition: [value: ReadingOutlinePositionId]
  reset: []
}>()

const isOpen = shallowRef(false)
const isHovering = shallowRef(false)
const isFocusWithin = shallowRef(false)
const isReceded = shallowRef(false)
const prefersReducedMotion = shallowRef(false)
const isDesktopOutlineViewport = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')
const buttonRef = useTemplateRef<HTMLButtonElement>('button')
const showOutlinePositionControl = computed(() => props.showOutlinePositionControl && isDesktopOutlineViewport.value)

let lastScrollY = 0
let recedeTimer: ReturnType<typeof setTimeout> | undefined
let mediaQuery: MediaQueryList | undefined
let outlineViewportMediaQuery: MediaQueryList | undefined

function togglePanel(): void {
  if (isOpen.value) {
    closePanel({ restoreFocus: true })
    return
  }

  void openPanel()
}

async function openPanel(): Promise<void> {
  isOpen.value = true
  isReceded.value = false
  await nextTick()
  focusFirstPanelItem()
}

function closePanel(options: { restoreFocus?: boolean } = {}): void {
  isOpen.value = false

  if (options.restoreFocus) {
    window.setTimeout(() => buttonRef.value?.focus(), 0)
  }
}

function focusFirstPanelItem(): void {
  window.setTimeout(() => {
    rootRef.value?.querySelector<HTMLElement>('[data-settings-item]')?.focus()
  }, 0)
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target

  if (isOpen.value && (!(target instanceof Node) || !rootRef.value?.contains(target))) {
    closePanel({ restoreFocus: true })
  }
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
      if (!isOpen.value && !isFocusWithin.value && !isHovering.value) {
        isReceded.value = true
      }
    }, 520)
  }

  lastScrollY = currentY
}

function onWindowMouseMove(): void {
  if (!isOpen.value && !prefersReducedMotion.value) {
    isReceded.value = false
  }
}

function syncReducedMotion(): void {
  prefersReducedMotion.value = mediaQuery?.matches ?? false

  if (prefersReducedMotion.value) {
    isReceded.value = false
  }
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanel({ restoreFocus: true })
  }
}

function onRadioKeydown<T extends string>(
  event: KeyboardEvent,
  options: readonly { id: T }[],
  currentValue: T,
  selectValue: (value: T) => void,
): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp') {
    return
  }

  const currentIndex = options.findIndex(option => option.id === currentValue)

  if (currentIndex === -1) {
    return
  }

  event.preventDefault()
  const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
  const nextIndex = (currentIndex + offset + options.length) % options.length
  const nextValue = options[nextIndex]?.id

  if (nextValue) {
    selectValue(nextValue)
    void nextTick(() => {
      Array.from(rootRef.value?.querySelectorAll<HTMLElement>('[data-option-id]') ?? [])
        .find(element => element.dataset.optionId === nextValue)
        ?.focus()
    })
  }
}

function selectFontSize(value: ReadingFontSizeId): void {
  emit('updateFontSize', value)
}

function selectMeasure(value: ReadingMeasureId): void {
  emit('updateMeasure', value)
}

function selectLineHeight(value: ReadingLineHeightId): void {
  emit('updateLineHeight', value)
}

function selectFontFamily(value: ReadingFontFamilyId): void {
  emit('updateFontFamily', value)
}

function selectTheme(value: ReadingThemeChoice): void {
  emit('updateTheme', value)
}

function selectOutlinePosition(value: ReadingOutlinePositionId): void {
  emit('updateOutlinePosition', value)
}

watch(isOpen, (value) => {
  if (value) {
    isReceded.value = false
  }
})

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  outlineViewportMediaQuery = window.matchMedia('(min-width: 1100px)')
  syncReducedMotion()
  syncOutlineViewport()
  lastScrollY = window.scrollY

  mediaQuery.addEventListener('change', syncReducedMotion)
  outlineViewportMediaQuery.addEventListener('change', syncOutlineViewport)
  window.addEventListener('scroll', onWindowScroll, { passive: true })
  window.addEventListener('mousemove', onWindowMouseMove, { passive: true })
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onUnmounted(() => {
  window.clearTimeout(recedeTimer)
  mediaQuery?.removeEventListener('change', syncReducedMotion)
  outlineViewportMediaQuery?.removeEventListener('change', syncOutlineViewport)
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('mousemove', onWindowMouseMove)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

function syncOutlineViewport(): void {
  isDesktopOutlineViewport.value = outlineViewportMediaQuery?.matches ?? false
}
</script>

<template>
  <section
    ref="root"
    class="reading-settings"
    :class="{
      'reading-settings--dimmed': isReceded && !isOpen && !isHovering && !isFocusWithin && !prefersReducedMotion,
      'reading-settings--open': isOpen,
    }"
    aria-label="阅读设置"
    data-testid="reading-settings"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @pointerenter="isHovering = true; isReceded = false"
    @pointerleave="isHovering = false"
    @pointerdown="isReceded = false"
  >
    <div
      v-if="isOpen"
      id="reading-settings-panel"
      class="reading-settings__panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="reading-settings-title"
      data-testid="reading-settings-panel"
      @keydown="onPanelKeydown"
    >
      <div class="reading-settings__handle" aria-hidden="true" />

      <header class="reading-settings__header">
        <div>
          <h2 id="reading-settings-title" class="reading-settings__title">
            阅读设置
          </h2>
          <p class="reading-settings__caption">
            即时预览当前正文
          </p>
        </div>
        <button
          class="reading-settings__close"
          type="button"
          aria-label="关闭阅读设置"
          @click="closePanel({ restoreFocus: true })"
        >
          ×
        </button>
      </header>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">字号</legend>
        <div
          class="reading-settings__segments reading-settings__segments--font-size"
          role="radiogroup"
          aria-label="字号"
          @keydown="onRadioKeydown($event, readingFontSizeOptions, props.settings.fontSize, selectFontSize)"
        >
          <button
            v-for="option in readingFontSizeOptions"
            :key="option.id"
            class="reading-settings__segment reading-settings__segment--font-size"
            type="button"
            role="radio"
            :aria-checked="props.settings.fontSize === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            :style="{ fontSize: option.tokenValue }"
            @click="selectFontSize(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">行宽</legend>
        <div
          class="reading-settings__segments"
          role="radiogroup"
          aria-label="行宽"
          @keydown="onRadioKeydown($event, readingMeasureOptions, props.settings.measure, selectMeasure)"
        >
          <button
            v-for="option in readingMeasureOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.measure === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectMeasure(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">行距</legend>
        <div
          class="reading-settings__segments"
          role="radiogroup"
          aria-label="行距"
          @keydown="onRadioKeydown($event, readingLineHeightOptions, props.settings.lineHeight, selectLineHeight)"
        >
          <button
            v-for="option in readingLineHeightOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.lineHeight === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectLineHeight(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">主题</legend>
        <div
          class="reading-settings__segments reading-settings__segments--theme"
          role="radiogroup"
          aria-label="主题"
          @keydown="onRadioKeydown($event, readingThemeOptions, props.settings.theme, selectTheme)"
        >
          <button
            v-for="option in readingThemeOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.theme === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectTheme(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <fieldset v-if="showOutlinePositionControl" class="reading-settings__field">
        <legend class="reading-settings__legend">大纲位置</legend>
        <div
          class="reading-settings__segments reading-settings__segments--outline-position"
          role="radiogroup"
          aria-label="大纲位置"
          @keydown="onRadioKeydown($event, readingOutlinePositionOptions, props.settings.outlinePosition, selectOutlinePosition)"
        >
          <button
            v-for="option in readingOutlinePositionOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.outlinePosition === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectOutlinePosition(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">正文字体</legend>
        <div
          class="reading-settings__segments"
          role="radiogroup"
          aria-label="正文字体"
          @keydown="onRadioKeydown($event, readingFontFamilyOptions, props.settings.fontFamily, selectFontFamily)"
        >
          <button
            v-for="option in readingFontFamilyOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.fontFamily === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectFontFamily(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <button
        class="reading-settings__reset"
        type="button"
        :disabled="props.isDefault"
        data-settings-item
        @click="emit('reset')"
      >
        恢复默认
      </button>
    </div>

    <button
      ref="button"
      class="reading-settings__button"
      type="button"
      aria-label="阅读设置"
      :aria-expanded="isOpen"
      aria-controls="reading-settings-panel"
      data-testid="reading-settings-button"
      @click="togglePanel"
      @keydown.enter.prevent="togglePanel"
      @keydown.space.prevent="togglePanel"
      @keydown.arrow-up.prevent="openPanel"
      @keydown.escape.prevent="closePanel({ restoreFocus: true })"
    >
      <span aria-hidden="true">aA</span>
    </button>
  </section>
</template>

<style scoped>
.reading-settings {
  position: fixed;
  right: max(1rem, calc(env(safe-area-inset-right) + 1rem));
  bottom: max(4.85rem, calc(env(safe-area-inset-bottom) + 4.85rem));
  z-index: 21;
  display: grid;
  justify-items: end;
  opacity: 1;
  transition: opacity 160ms ease;
}

.reading-settings--dimmed {
  opacity: 0.36;
}

.reading-settings:focus-within,
.reading-settings:hover {
  opacity: 1;
}

.reading-settings__button {
  display: grid;
  place-items: center;
  inline-size: 48px;
  block-size: 48px;
  border: 1px solid var(--reading-rule);
  border-radius: 50%;
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  color: var(--reading-fg);
  box-shadow: 0 12px 30px rgb(0 0 0 / 13%);
  cursor: pointer;
  font-family: var(--reading-font-heading);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
  backdrop-filter: blur(14px);
}

.reading-settings__button span {
  transform: translateY(-0.03em);
}

.reading-settings__panel {
  position: absolute;
  right: 0;
  bottom: 3.85rem;
  inline-size: min(22rem, calc(100vw - 2rem));
  padding: 0.8rem;
  border: 1px solid var(--reading-rule);
  border-radius: 18px;
  background: color-mix(in srgb, var(--reading-bg) 94%, transparent);
  box-shadow: 0 18px 44px rgb(0 0 0 / 16%);
  backdrop-filter: blur(16px);
}

.reading-settings__handle {
  display: none;
}

.reading-settings__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.8rem;
}

.reading-settings__title,
.reading-settings__caption,
.reading-settings__field {
  margin: 0;
}

.reading-settings__title {
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: 1.05rem;
  line-height: 1.2;
}

.reading-settings__caption {
  margin-block-start: 0.2rem;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
}

.reading-settings__close {
  display: grid;
  place-items: center;
  inline-size: 36px;
  block-size: 36px;
  border: 1px solid var(--reading-rule);
  border-radius: 50%;
  background: var(--reading-bg);
  color: var(--reading-fg-muted);
  cursor: pointer;
  font: inherit;
}

.reading-settings__field {
  padding: 0;
  border: 0;
}

.reading-settings__field + .reading-settings__field {
  margin-block-start: 0.75rem;
}

.reading-settings__legend {
  margin-block-end: 0.35rem;
  color: var(--reading-fg-muted);
  font-size: 0.78rem;
}

.reading-settings__segments {
  display: grid;
  grid-template-columns: repeat(var(--segment-count, 3), minmax(0, 1fr));
  gap: 0.35rem;
}

.reading-settings__segments--font-size {
  --segment-count: 5;
}

.reading-settings__segments--theme {
  --segment-count: 4;
}

.reading-settings__segments--outline-position {
  --segment-count: 2;
}

.reading-settings__segment,
.reading-settings__reset {
  min-block-size: 44px;
  border: 1px solid var(--reading-rule);
  border-radius: 12px;
  background: var(--reading-bg);
  color: var(--reading-fg);
  cursor: pointer;
  font: inherit;
}

.reading-settings__segment {
  padding: 0.35rem 0.45rem;
  overflow-wrap: anywhere;
}

.reading-settings__segment--font-size {
  font-family: var(--reading-font-body);
  line-height: 1;
}

.reading-settings__segment[aria-checked="true"] {
  border-color: #b9a8ed;
  background: #ece6fb;
  color: #4a3f7a;
  font-weight: 700;
}

.reading-settings__segment:hover,
.reading-settings__segment:focus-visible,
.reading-settings__close:hover,
.reading-settings__close:focus-visible,
.reading-settings__reset:hover,
.reading-settings__reset:focus-visible {
  border-color: var(--reading-accent);
}

.reading-settings__reset {
  inline-size: 100%;
  margin-block-start: 0.85rem;
  color: var(--reading-fg-muted);
}

.reading-settings__reset:disabled {
  cursor: default;
  opacity: 0.55;
}

@media (max-width: 640px) {
  .reading-settings {
    bottom: max(4.85rem, calc(env(safe-area-inset-bottom) + 4.85rem));
  }

  .reading-settings--open .reading-settings__button {
    position: fixed;
    right: max(1rem, calc(env(safe-area-inset-right) + 1rem));
    bottom: calc(min(72vh, 34rem) + max(1rem, env(safe-area-inset-bottom)));
  }

  .reading-settings__panel {
    position: fixed;
    right: 0;
    bottom: 0;
    inline-size: 100vw;
    max-block-size: min(72vh, 34rem);
    overflow-y: auto;
    padding: 0.72rem 1rem max(1rem, calc(env(safe-area-inset-bottom) + 1rem));
    border-inline: 0;
    border-block-end: 0;
    border-radius: 18px 18px 0 0;
  }

  .reading-settings__handle {
    display: block;
    inline-size: 2.7rem;
    block-size: 0.28rem;
    margin: 0 auto 0.7rem;
    border-radius: 999px;
    background: var(--reading-rule);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reading-settings {
    opacity: 1;
    transition: none;
  }
}
</style>
