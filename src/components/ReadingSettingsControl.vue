<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import {
  readingContrastOptions,
  readingFontFamilyOptions,
  readingFontSizeOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  readingPageMarginOptions,
  readingParagraphGapOptions,
  readingThemeOptions,
} from '@/features/settings/readingSettingsOptions'
import type {
  ReadingContrastId,
  ReadingFontFamilyId,
  ReadingFontSizeId,
  ReadingLineHeightId,
  ReadingMeasureId,
  ReadingOutlinePositionId,
  ReadingPageMarginId,
  ReadingParagraphGapId,
  ReadingThemeChoice,
} from '@/features/settings/readingSettingsOptions'
import type { ReadingCustomizationState } from '@/features/settings/useReadingSettings'

const props = defineProps<{
  isDefault: boolean
  isOpen: boolean
  settings: Readonly<ReadingCustomizationState>
  showOutlinePositionControl: boolean
}>()

const emit = defineEmits<{
  updateFontSize: [value: ReadingFontSizeId]
  updateMeasure: [value: ReadingMeasureId]
  updateLineHeight: [value: ReadingLineHeightId]
  updateParagraphGap: [value: ReadingParagraphGapId]
  updatePageMargin: [value: ReadingPageMarginId]
  updateFontFamily: [value: ReadingFontFamilyId]
  updateTheme: [value: ReadingThemeChoice]
  updateContrast: [value: ReadingContrastId]
  updateOutlinePosition: [value: ReadingOutlinePositionId]
  reset: []
  close: []
}>()

const isDesktopOutlineViewport = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')
const showOutlinePositionControl = computed(() => props.showOutlinePositionControl && isDesktopOutlineViewport.value)
const fontSizeSliderValue = computed(() => {
  const index = readingFontSizeOptions.findIndex(option => option.id === props.settings.fontSize)
  return index === -1 ? defaultFontSizeIndex : index
})
const fontSizeOption = computed(() => readingFontSizeOptions[fontSizeSliderValue.value] ?? readingFontSizeOptions[defaultFontSizeIndex])
const fontSizeValueText = computed(() => `字号 ${fontSizeOption.value?.tokenValue ?? '18px'}`)
const fontSizeProgress = computed(() => {
  const max = Math.max(readingFontSizeOptions.length - 1, 1)
  return `${(fontSizeSliderValue.value / max) * 100}%`
})

let outlineViewportMediaQuery: MediaQueryList | undefined
const defaultFontSizeIndex = Math.max(readingFontSizeOptions.findIndex(option => option.id === '18'), 0)

function focusFirstPanelItem(): void {
  window.setTimeout(() => {
    rootRef.value?.querySelector<HTMLElement>('[data-settings-item]')?.focus()
  }, 0)
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
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
      Array.from((event.currentTarget as HTMLElement | null)?.querySelectorAll<HTMLElement>('[data-option-id]') ?? [])
        .find(element => element.dataset.optionId === nextValue)
        ?.focus()
    })
  }
}

function onFontSizeSliderInput(event: Event): void {
  const slider = event.currentTarget as HTMLInputElement
  const nextIndex = Number.parseInt(slider.value, 10)
  const nextOption = readingFontSizeOptions[nextIndex]

  if (nextOption && nextOption.id !== props.settings.fontSize) {
    emit('updateFontSize', nextOption.id)
  }
}

function selectMeasure(value: ReadingMeasureId): void {
  emit('updateMeasure', value)
}

function selectLineHeight(value: ReadingLineHeightId): void {
  emit('updateLineHeight', value)
}

function selectParagraphGap(value: ReadingParagraphGapId): void {
  emit('updateParagraphGap', value)
}

function selectPageMargin(value: ReadingPageMarginId): void {
  emit('updatePageMargin', value)
}

function selectFontFamily(value: ReadingFontFamilyId): void {
  emit('updateFontFamily', value)
}

function selectTheme(value: ReadingThemeChoice): void {
  emit('updateTheme', value)
}

function selectContrast(value: ReadingContrastId): void {
  emit('updateContrast', value)
}

function selectOutlinePosition(value: ReadingOutlinePositionId): void {
  emit('updateOutlinePosition', value)
}

watch(() => props.isOpen, async (value) => {
  if (!value) {
    return
  }

  await nextTick()
  focusFirstPanelItem()
})

onMounted(() => {
  outlineViewportMediaQuery = window.matchMedia('(min-width: 1100px)')
  syncOutlineViewport()

  outlineViewportMediaQuery.addEventListener('change', syncOutlineViewport)

  if (props.isOpen) {
    focusFirstPanelItem()
  }
})

onUnmounted(() => {
  outlineViewportMediaQuery?.removeEventListener('change', syncOutlineViewport)
})

function syncOutlineViewport(): void {
  isDesktopOutlineViewport.value = outlineViewportMediaQuery?.matches ?? false
}
</script>

<template>
  <section
    v-if="props.isOpen"
    ref="root"
    class="reading-settings"
    aria-label="阅读设置"
    data-testid="reading-settings"
  >
    <div
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
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend reading-settings__legend--range">字号</legend>
        <div class="reading-settings__range-header">
          <span class="reading-settings__range-note">滑块 · 8 档 snap</span>
          <output class="reading-settings__range-value" for="reading-font-size-slider">
            {{ fontSizeOption?.tokenValue }}
          </output>
        </div>
        <input
          id="reading-font-size-slider"
          class="reading-settings__range"
          type="range"
          min="0"
          :max="readingFontSizeOptions.length - 1"
          step="1"
          :value="fontSizeSliderValue"
          aria-label="字号"
          :aria-valuetext="fontSizeValueText"
          data-settings-item
          :style="{ '--font-size-progress': fontSizeProgress }"
          @input="onFontSizeSliderInput"
        >
        <div class="reading-settings__range-ticks" aria-hidden="true">
          <span
            v-for="option in readingFontSizeOptions"
            :key="option.id"
          />
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
        <legend class="reading-settings__legend">段间距</legend>
        <div
          class="reading-settings__segments"
          role="radiogroup"
          aria-label="段间距"
          @keydown="onRadioKeydown($event, readingParagraphGapOptions, props.settings.paragraphGap, selectParagraphGap)"
        >
          <button
            v-for="option in readingParagraphGapOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.paragraphGap === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectParagraphGap(option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">页边距</legend>
        <div
          class="reading-settings__segments"
          role="radiogroup"
          aria-label="页边距"
          @keydown="onRadioKeydown($event, readingPageMarginOptions, props.settings.pageMargin, selectPageMargin)"
        >
          <button
            v-for="option in readingPageMarginOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.pageMargin === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectPageMargin(option.id)"
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

      <fieldset class="reading-settings__field">
        <legend class="reading-settings__legend">对比微调</legend>
        <div
          class="reading-settings__segments"
          role="radiogroup"
          aria-label="对比微调"
          @keydown="onRadioKeydown($event, readingContrastOptions, props.settings.contrast, selectContrast)"
        >
          <button
            v-for="option in readingContrastOptions"
            :key="option.id"
            class="reading-settings__segment"
            type="button"
            role="radio"
            :aria-checked="props.settings.contrast === option.id"
            :aria-label="option.ariaLabel"
            :data-option-id="option.id"
            data-settings-item
            @click="selectContrast(option.id)"
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

      <footer class="reading-settings__actions">
        <button
          class="reading-settings__reset"
          type="button"
          :disabled="props.isDefault"
          data-settings-item
          @click="emit('reset')"
        >
          恢复默认
        </button>
        <button
          class="reading-settings__done"
          type="button"
          data-settings-item
          @click="emit('close')"
        >
          关闭
        </button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.reading-settings {
  inline-size: min(24rem, calc(100vw - 2rem));
}

.reading-settings__panel {
  max-block-size: min(82vh, 44rem);
  overflow-y: auto;
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
  inline-size: 44px;
  block-size: 44px;
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

.reading-settings__range-header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  align-items: baseline;
  margin-block-end: 0.35rem;
}

.reading-settings__legend--range {
  margin-block-end: 0;
}

.reading-settings__range-note,
.reading-settings__range-value {
  color: var(--reading-fg-muted);
  font-size: 0.78rem;
}

.reading-settings__range-value {
  color: var(--reading-accent);
  font-weight: 700;
}

.reading-settings__range {
  --font-size-progress: 42.857%;
  display: block;
  inline-size: 100%;
  block-size: 44px;
  margin: 0;
  appearance: none;
  background: transparent;
  color: var(--reading-accent);
  cursor: pointer;
}

.reading-settings__range::-webkit-slider-runnable-track {
  block-size: 4px;
  border-radius: 999px;
  background:
    linear-gradient(
      to right,
      var(--reading-accent) 0 var(--font-size-progress),
      color-mix(in srgb, var(--reading-rule) 78%, var(--reading-bg)) var(--font-size-progress) 100%
    );
}

.reading-settings__range::-moz-range-track {
  block-size: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-rule) 78%, var(--reading-bg));
}

.reading-settings__range::-moz-range-progress {
  block-size: 4px;
  border-radius: 999px;
  background: var(--reading-accent);
}

.reading-settings__range::-webkit-slider-thumb {
  appearance: none;
  inline-size: 30px;
  block-size: 30px;
  margin-block-start: -13px;
  border: 3px solid var(--reading-accent);
  border-radius: 50%;
  background: var(--reading-bg);
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
}

.reading-settings__range::-moz-range-thumb {
  inline-size: 30px;
  block-size: 30px;
  border: 3px solid var(--reading-accent);
  border-radius: 50%;
  background: var(--reading-bg);
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
}

.reading-settings__range:focus-visible {
  outline: 2px solid var(--reading-accent);
  outline-offset: 4px;
}

.reading-settings__range-ticks {
  display: flex;
  justify-content: space-between;
  padding-inline: 2px;
  transform: translateY(-12px);
  pointer-events: none;
}

.reading-settings__range-ticks > span {
  inline-size: 2px;
  block-size: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-fg-muted) 38%, transparent);
}

.reading-settings__segments {
  display: grid;
  grid-template-columns: repeat(var(--segment-count, 3), minmax(0, 1fr));
  gap: 0.35rem;
}

.reading-settings__segments--theme {
  --segment-count: 4;
}

.reading-settings__segments--outline-position {
  --segment-count: 2;
}

.reading-settings__segment,
.reading-settings__reset,
.reading-settings__done {
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

.reading-settings__segment[aria-checked="true"] {
  border-color: var(--reading-accent);
  background: color-mix(in srgb, var(--reading-accent) 13%, var(--reading-bg));
  color: var(--reading-fg);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--reading-accent);
}

.reading-settings__segment:hover,
.reading-settings__segment:focus-visible,
.reading-settings__close:hover,
.reading-settings__close:focus-visible,
.reading-settings__reset:hover,
.reading-settings__reset:focus-visible,
.reading-settings__done:hover,
.reading-settings__done:focus-visible {
  border-color: var(--reading-accent);
}

.reading-settings__actions {
  position: sticky;
  inset-block-end: -0.8rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  margin: 1rem -0.8rem -0.8rem;
  padding: 0.75rem 0.8rem 0.8rem;
  border-block-start: 1px solid var(--reading-rule);
  background: color-mix(in srgb, var(--reading-bg) 97%, transparent);
  backdrop-filter: blur(12px);
}

.reading-settings__reset {
  color: var(--reading-fg-muted);
}

.reading-settings__done {
  min-inline-size: 5.2rem;
  border-color: var(--reading-accent);
  background: var(--reading-accent);
  color: var(--reading-bg);
  font-weight: 700;
}

.reading-settings__reset:disabled {
  cursor: default;
  opacity: 0.55;
}

@media (max-width: 640px) {
  .reading-settings {
    inline-size: 100vw;
  }

  .reading-settings__panel {
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

  .reading-settings__actions {
    inset-block-end: calc(-1 * max(1rem, calc(env(safe-area-inset-bottom) + 1rem)));
    margin: 1rem -1rem calc(-1 * max(1rem, calc(env(safe-area-inset-bottom) + 1rem)));
    padding: 0.75rem 1rem max(1rem, calc(env(safe-area-inset-bottom) + 1rem));
  }
}

@media (prefers-reduced-motion: reduce) {
  .reading-settings {
    transition: none;
  }
}
</style>
