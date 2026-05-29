<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import {
  contrastRatio,
  getCustomThemeChecks,
  hasReadableCustomTheme,
  normalizeHexColor,
  readingContrastOptions,
  readingFontFamilyOptions,
  readingFontSizeOptions,
  readingLetterSpacingOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  readingPageMarginOptions,
  readingParagraphGapOptions,
  readingThemeOptions,
} from '@/features/settings/readingSettingsOptions'
import type {
  ReadingContrastId,
  ReadingCustomThemeState,
  ReadingFontFamilyId,
  ReadingFontSizeId,
  ReadingLetterSpacingId,
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
  updateLetterSpacing: [value: ReadingLetterSpacingId]
  updateParagraphGap: [value: ReadingParagraphGapId]
  updatePageMargin: [value: ReadingPageMarginId]
  updateFontFamily: [value: ReadingFontFamilyId]
  updateTheme: [value: ReadingThemeChoice]
  updateCustomTheme: [value: Partial<ReadingCustomThemeState>]
  autoFixCustomTheme: []
  updateContrast: [value: ReadingContrastId]
  updateOutlinePosition: [value: ReadingOutlinePositionId]
  reset: []
  close: []
}>()

const isDesktopOutlineViewport = shallowRef(false)
const activePanel = shallowRef<'main' | 'custom-theme' | 'presets'>('main')
const rootRef = useTemplateRef<HTMLElement>('root')
const showOutlinePositionControl = computed(() => props.showOutlinePositionControl && isDesktopOutlineViewport.value)
const settingsPanelTitle = computed(() => {
  if (activePanel.value === 'custom-theme') {
    return '自定义主题'
  }

  return activePanel.value === 'main' ? '阅读设置' : '管理预设'
})
const settingsPanelCaption = computed(() => {
  if (activePanel.value === 'custom-theme') {
    return '背景 / 正文 / 强调'
  }

  return activePanel.value === 'main' ? '即时预览当前正文' : '外观快照'
})
const currentPresetName = computed(() => props.isDefault ? '默认' : '自定义（未保存）')
const customThemeChecks = computed(() => getCustomThemeChecks(props.settings.customTheme))
const isCustomThemeReadable = computed(() => hasReadableCustomTheme(props.settings.customTheme))
const hasCustomThemeBodyContrastIssue = computed(() => customThemeChecks.value.some(check => check.id === 'fg' && !check.passes))
const hasCustomThemeAccentContrastIssue = computed(() => customThemeChecks.value.some(check => check.id === 'accent' && !check.passes))
const customThemeWarningSeverity = computed(() => hasCustomThemeBodyContrastIssue.value ? 'critical' : 'notice')
const customThemeWarningText = computed(() => {
  if (hasCustomThemeBodyContrastIssue.value && hasCustomThemeAccentContrastIssue.value) {
    return '正文与强调色对比不足，正文几乎无法阅读。'
  }

  return hasCustomThemeBodyContrastIssue.value
    ? '正文对比不足，当前配色几乎无法阅读。'
    : '强调色对比不足，链接和重点可能不清晰。'
})
const customThemeWarningStyle = computed(() => {
  const bg = normalizeHexColor(props.settings.customTheme.bg) ?? '#ffffff'
  const darkWarningInk = '#17130f'
  const lightWarningInk = '#fff7f0'

  return {
    color: contrastRatio(darkWarningInk, bg) >= 4.5 ? darkWarningInk : lightWarningInk,
  }
})
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

function openPanel(panel: typeof activePanel.value): void {
  activePanel.value = panel
  focusFirstPanelItem()
}

function returnToMainPanel(): void {
  activePanel.value = 'main'
  focusFirstPanelItem()
}

function applyDefaultPreset(): void {
  emit('reset')
  returnToMainPanel()
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

function selectLetterSpacing(value: ReadingLetterSpacingId): void {
  emit('updateLetterSpacing', value)
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

function updateCustomThemeColor(key: keyof ReadingCustomThemeState, event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  emit('updateCustomTheme', { [key]: input.value })
}

function selectContrast(value: ReadingContrastId): void {
  emit('updateContrast', value)
}

function selectOutlinePosition(value: ReadingOutlinePositionId): void {
  emit('updateOutlinePosition', value)
}

watch(() => props.isOpen, async (value) => {
  if (!value) {
    activePanel.value = 'main'
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
        <button
          v-if="activePanel !== 'main'"
          class="reading-settings__back"
          type="button"
          aria-label="返回阅读设置"
          data-settings-item
          @click="returnToMainPanel"
        >
          ←
        </button>
        <div>
          <h2 id="reading-settings-title" class="reading-settings__title">
            {{ settingsPanelTitle }}
          </h2>
          <p class="reading-settings__caption">
            {{ settingsPanelCaption }}
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

      <div
        v-if="activePanel === 'main'"
        class="reading-settings__content"
        data-testid="reading-settings-main-panel"
      >
        <section class="reading-settings__group" aria-labelledby="reading-settings-group-type">
          <h3 id="reading-settings-group-type" class="reading-settings__group-title">
            文字
          </h3>

          <fieldset class="reading-settings__field">
            <legend class="reading-settings__legend">正文字体</legend>
            <div
              class="reading-settings__segments reading-settings__segments--font-family"
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
                :style="{ fontFamily: option.tokenValue }"
                data-settings-item
                @click="selectFontFamily(option.id)"
              >
                {{ option.label }}
              </button>
            </div>
          </fieldset>

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
            <legend class="reading-settings__legend">字间距</legend>
            <div
              class="reading-settings__segments"
              role="radiogroup"
              aria-label="字间距"
              @keydown="onRadioKeydown($event, readingLetterSpacingOptions, props.settings.letterSpacing, selectLetterSpacing)"
            >
              <button
                v-for="option in readingLetterSpacingOptions"
                :key="option.id"
                class="reading-settings__segment"
                type="button"
                role="radio"
                :aria-checked="props.settings.letterSpacing === option.id"
                :aria-label="option.ariaLabel"
                :data-option-id="option.id"
                data-settings-item
                @click="selectLetterSpacing(option.id)"
              >
                {{ option.label }}
              </button>
            </div>
          </fieldset>
        </section>

        <section class="reading-settings__group" aria-labelledby="reading-settings-group-layout">
          <h3 id="reading-settings-group-layout" class="reading-settings__group-title">
            版面
          </h3>

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
        </section>

        <section class="reading-settings__group" aria-labelledby="reading-settings-group-theme">
          <h3 id="reading-settings-group-theme" class="reading-settings__group-title">
            主题
          </h3>

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

          <button
            v-if="props.settings.theme === 'custom'"
            class="reading-settings__drilldown reading-settings__drilldown--custom-theme"
            type="button"
            data-settings-item
            aria-controls="reading-settings-custom-theme-panel"
            @click="openPanel('custom-theme')"
          >
            <span>
              <strong>编辑自定义主题</strong>
              <span :class="{ 'reading-settings__status--warning': !isCustomThemeReadable }">
                {{ isCustomThemeReadable ? 'AA 可读' : '需要调整对比' }}
              </span>
            </span>
            <span aria-hidden="true">→</span>
          </button>

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
        </section>

        <section class="reading-settings__group" aria-labelledby="reading-settings-group-presets">
          <h3 id="reading-settings-group-presets" class="reading-settings__group-title">
            预设
          </h3>
          <div class="reading-settings__summary-row">
            <span class="reading-settings__summary-label">当前</span>
            <strong>{{ currentPresetName }}</strong>
          </div>
          <button
            class="reading-settings__drilldown"
            type="button"
            data-settings-item
            aria-controls="reading-settings-presets-panel"
            @click="openPanel('presets')"
          >
            <span>管理预设</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>
      </div>

      <div
        v-else-if="activePanel === 'custom-theme'"
        id="reading-settings-custom-theme-panel"
        class="reading-settings__content"
        data-testid="reading-settings-custom-theme-panel"
      >
        <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-custom-theme-title">
          <h3 id="reading-settings-custom-theme-title" class="reading-settings__group-title">
            核心色
          </h3>

          <div class="reading-settings__color-list">
            <label class="reading-settings__color-row">
              <span>
                <strong>背景</strong>
                <span>{{ props.settings.customTheme.bg }}</span>
              </span>
              <input
                class="reading-settings__color-input"
                type="color"
                :value="props.settings.customTheme.bg"
                aria-label="自定义主题 背景"
                data-settings-item
                @input="updateCustomThemeColor('bg', $event)"
              >
            </label>
            <label class="reading-settings__color-row">
              <span>
                <strong>正文</strong>
                <span>{{ props.settings.customTheme.fg }}</span>
              </span>
              <input
                class="reading-settings__color-input"
                type="color"
                :value="props.settings.customTheme.fg"
                aria-label="自定义主题 正文"
                data-settings-item
                @input="updateCustomThemeColor('fg', $event)"
              >
            </label>
            <label class="reading-settings__color-row">
              <span>
                <strong>强调</strong>
                <span>{{ props.settings.customTheme.accent }}</span>
              </span>
              <input
                class="reading-settings__color-input"
                type="color"
                :value="props.settings.customTheme.accent"
                aria-label="自定义主题 强调"
                data-settings-item
                @input="updateCustomThemeColor('accent', $event)"
              >
            </label>
          </div>

          <div class="reading-settings__contrast-list" aria-label="自定义主题 AA 校验">
            <div
              v-for="check in customThemeChecks"
              :key="check.id"
              class="reading-settings__contrast-row"
              :data-pass="check.passes"
            >
              <span>{{ check.label }}</span>
              <strong>{{ check.ratio.toFixed(2) }}:1</strong>
              <span>{{ check.passes ? '✓' : '✗' }}</span>
            </div>
          </div>

          <p
            v-if="!isCustomThemeReadable"
            class="reading-settings__warning"
            :data-severity="customThemeWarningSeverity"
            role="status"
            :style="customThemeWarningStyle"
          >
            {{ customThemeWarningText }}
          </p>

          <button
            class="reading-settings__preset-item"
            type="button"
            data-settings-item
            @click="emit('autoFixCustomTheme')"
          >
            <span>
              <strong>自动修正到 AA</strong>
              <span>只调整正文和强调色</span>
            </span>
            <span aria-hidden="true">应用</span>
          </button>
        </section>
      </div>

      <div
        v-else-if="activePanel === 'presets'"
        id="reading-settings-presets-panel"
        class="reading-settings__content"
        data-testid="reading-settings-presets-panel"
      >
        <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-presets-title">
          <h3 id="reading-settings-presets-title" class="reading-settings__group-title">
            内置预设
          </h3>
          <button
            class="reading-settings__preset-item"
            type="button"
            data-settings-item
            @click="applyDefaultPreset"
          >
            <span>
              <strong>默认</strong>
              <span>Newsreader · 标准版面 · 跟随系统</span>
            </span>
            <span aria-hidden="true">应用</span>
          </button>
          <p class="reading-settings__subpanel-note">
            当前: {{ currentPresetName }}
          </p>
        </section>
      </div>

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

.reading-settings__header > div {
  min-inline-size: 0;
  flex: 1;
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

.reading-settings__back,
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

.reading-settings__back {
  border-radius: 14px;
}

.reading-settings__content {
  display: grid;
  gap: 0.85rem;
}

.reading-settings__group {
  padding-block-start: 0.72rem;
  border-block-start: 1px solid color-mix(in srgb, var(--reading-rule) 72%, transparent);
}

.reading-settings__group:first-child {
  padding-block-start: 0;
  border-block-start: 0;
}

.reading-settings__group-title {
  margin: 0 0 0.58rem;
  color: var(--reading-fg-muted);
  font-family: var(--reading-font-code);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
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
  --segment-count: 5;
}

.reading-settings__segments--font-family {
  --segment-count: 2;
}

.reading-settings__segments--outline-position {
  --segment-count: 2;
}

.reading-settings__segment,
.reading-settings__drilldown,
.reading-settings__preset-item,
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

.reading-settings__summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.45rem;
  color: var(--reading-fg);
  font-size: 0.9rem;
}

.reading-settings__summary-label,
.reading-settings__subpanel-note {
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
}

.reading-settings__drilldown,
.reading-settings__preset-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  inline-size: 100%;
  padding: 0.45rem 0.65rem;
  text-align: start;
}

.reading-settings__drilldown--custom-theme {
  margin-block-start: 0.55rem;
}

.reading-settings__drilldown > span:first-child {
  display: grid;
  gap: 0.18rem;
}

.reading-settings__drilldown > span:first-child > span {
  color: var(--reading-fg-muted);
  font-size: 0.78rem;
}

.reading-settings__preset-item > span:first-child {
  display: grid;
  gap: 0.18rem;
}

.reading-settings__preset-item > span:first-child > span {
  color: var(--reading-fg-muted);
  font-size: 0.78rem;
}

.reading-settings__subpanel-note {
  margin: 0.65rem 0 0;
}

.reading-settings__status--warning {
  color: var(--reading-accent) !important;
  font-weight: 700;
}

.reading-settings__color-list,
.reading-settings__contrast-list {
  display: grid;
  gap: 0.5rem;
}

.reading-settings__color-row,
.reading-settings__contrast-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  min-block-size: 44px;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--reading-rule);
  border-radius: 12px;
  background: color-mix(in srgb, var(--reading-bg) 96%, var(--reading-fg));
}

.reading-settings__color-row > span {
  display: grid;
  gap: 0.16rem;
}

.reading-settings__color-row > span > span {
  color: var(--reading-fg-muted);
  font-family: var(--reading-font-code);
  font-size: 0.76rem;
}

.reading-settings__color-input {
  inline-size: 44px;
  block-size: 44px;
  padding: 2px;
  border: 1px solid var(--reading-rule);
  border-radius: 12px;
  background: var(--reading-bg);
  cursor: pointer;
}

.reading-settings__contrast-list {
  margin-block-start: 0.75rem;
}

.reading-settings__contrast-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-block-size: 36px;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
}

.reading-settings__contrast-row[data-pass="true"] {
  color: var(--reading-fg);
}

.reading-settings__contrast-row[data-pass="false"] {
  border-color: var(--reading-accent);
  color: var(--reading-accent);
  font-weight: 700;
}

.reading-settings__warning {
  margin: 0.75rem 0;
  border: 1px solid currentColor;
  border-radius: 0.75rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
  padding: 0.65rem 0.75rem;
  font-size: 0.82rem;
  font-weight: 700;
}

.reading-settings__warning[data-severity="critical"] {
  background: color-mix(in srgb, currentColor 13%, transparent);
  box-shadow: inset 0 0 0 1px currentColor;
  font-size: 0.86rem;
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
.reading-settings__drilldown:hover,
.reading-settings__drilldown:focus-visible,
.reading-settings__preset-item:hover,
.reading-settings__preset-item:focus-visible,
.reading-settings__back:hover,
.reading-settings__back:focus-visible,
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
