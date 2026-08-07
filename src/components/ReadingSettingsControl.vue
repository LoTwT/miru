<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import ReadingCustomThemePanel from '@/components/reading-settings/ReadingCustomThemePanel.vue'
import ReadingLocalFontsPanel from '@/components/reading-settings/ReadingLocalFontsPanel.vue'
import ReadingPresetsPanel from '@/components/reading-settings/ReadingPresetsPanel.vue'
import {
  confirmedOptionalFontStorageKey,
  getReadingFontFamilyOption,
  hasReadableCustomTheme,
  readingColorSchemeOptions,
  readingContrastOptions,
  readingFontFamilyOptions,
  readingFontSizeOptions,
  readingLetterSpacingOptions,
  readingLineHeightOptions,
  readingMeasureOptions,
  readingOutlinePositionOptions,
  readingPageMarginOptions,
  readingParagraphGapOptions,
  readingThemeStyleOptions,
} from '@/features/settings/readingSettingsOptions'
import type {
  ReadingColorSchemeId,
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
  ReadingSettingOption,
  ReadingThemeStyleId,
} from '@/features/settings/readingSettingsOptions'
import type { ReadingPreset } from '@/features/settings/readingPresets'
import type { LocalFontOption } from '@/features/settings/localFonts'
import type { ReadingCustomizationState, ReadingSettingsMessage } from '@/features/settings/useReadingSettings'
import { loadOptionalReadingFont } from '@/lib/theme/fonts'

const props = defineProps<{
  activePresetName: string
  isDefault: boolean
  isOpen: boolean
  localFontMessage: Readonly<ReadingSettingsMessage> | null
  localFonts: readonly LocalFontOption[]
  presets: readonly ReadingPreset[]
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
  updateThemeStyle: [value: ReadingThemeStyleId]
  updateColorScheme: [value: ReadingColorSchemeId]
  updateCustomTheme: [value: Partial<ReadingCustomThemeState>]
  autoFixCustomTheme: []
  savePreset: [name: string]
  applyPreset: [id: string]
  renamePreset: [id: string, name: string]
  deletePreset: [id: string]
  uploadLocalFont: [file: File]
  renameLocalFont: [id: string, name: string]
  deleteLocalFont: [id: string]
  updateContrast: [value: ReadingContrastId]
  updateOutlinePosition: [value: ReadingOutlinePositionId]
  reset: []
  close: []
}>()

const isDesktopOutlineViewport = shallowRef(false)
const activePanel = shallowRef<'main' | 'custom-theme' | 'presets' | 'fonts'>('main')
const presetNameInput = shallowRef('')
const pendingDownloadFontId = shallowRef<ReadingFontFamilyId | null>(null)
const isPendingDownloadLoading = shallowRef(false)
const optionalFontDownloadMessage = shallowRef('')
const confirmedOptionalFontIds = shallowRef<ReadonlySet<string>>(readConfirmedOptionalFontIds())
const rootRef = useTemplateRef<HTMLElement>('root')
const localFontInputRef = useTemplateRef<HTMLInputElement>('localFontInput')
const showOutlinePositionControl = computed(() => props.showOutlinePositionControl && isDesktopOutlineViewport.value)
const settingsPanelTitle = computed(() => {
  if (activePanel.value === 'custom-theme') {
    return '自定义配色'
  }

  if (activePanel.value === 'fonts') {
    return '管理我的字体'
  }

  return activePanel.value === 'main' ? '阅读设置' : '管理预设'
})
const settingsPanelCaption = computed(() => {
  if (activePanel.value === 'custom-theme') {
    return '背景 / 正文 / 强调'
  }

  if (activePanel.value === 'fonts') {
    return '字体文件只保存在本机'
  }

  return activePanel.value === 'main' ? '即时预览当前正文' : '外观快照'
})
const fontFamilyOptions = computed<readonly ReadingSettingOption<ReadingFontFamilyId>[]>(() => [
  ...readingFontFamilyOptions as readonly ReadingSettingOption<ReadingFontFamilyId>[],
  ...props.localFonts.map(font => ({
    id: font.familyId,
    label: font.name,
    ariaLabel: `正文字体 ${font.name}`,
    tokenValue: font.fontStack,
  })),
])
const pendingDownloadFontOption = computed(() =>
  pendingDownloadFontId.value
    ? getReadingFontFamilyOption(pendingDownloadFontId.value)
    : undefined,
)
const isCustomThemeReadable = computed(() => hasReadableCustomTheme(props.settings.customTheme))
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

function forwardRenamePreset(id: string, name: string): void {
  emit('renamePreset', id, name)
}

function forwardRenameLocalFont(id: string, name: string): void {
  emit('renameLocalFont', id, name)
}

function openLocalFontPicker(): void {
  localFontInputRef.value?.click()
}

function onLocalFontFileChange(event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (file) {
    emit('uploadLocalFont', file)
  }
}

function readConfirmedOptionalFontIds(): ReadonlySet<string> {
  if (typeof window === 'undefined') {
    return new Set()
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(confirmedOptionalFontStorageKey) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : [])
  }
  catch {
    return new Set()
  }
}

function hasConfirmedOptionalFont(id: ReadingFontFamilyId): boolean {
  return confirmedOptionalFontIds.value.has(id)
}

function rememberConfirmedOptionalFont(id: ReadingFontFamilyId): void {
  const next = new Set(confirmedOptionalFontIds.value)
  next.add(id)
  confirmedOptionalFontIds.value = next

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(confirmedOptionalFontStorageKey, JSON.stringify(Array.from(next)))
  }
  catch {
    // Confirmation persistence is a convenience only; selection still works.
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
  const option = getReadingFontFamilyOption(value)

  optionalFontDownloadMessage.value = ''

  if (option?.confirmDownload && !hasConfirmedOptionalFont(value)) {
    pendingDownloadFontId.value = value
    return
  }

  pendingDownloadFontId.value = null
  emit('updateFontFamily', value)
}

function cancelPendingDownloadFont(): void {
  pendingDownloadFontId.value = null
  isPendingDownloadLoading.value = false
  optionalFontDownloadMessage.value = ''
}

async function confirmPendingDownloadFont(): Promise<void> {
  const fontId = pendingDownloadFontId.value
  const option = pendingDownloadFontOption.value

  if (!fontId || !option) {
    return
  }

  isPendingDownloadLoading.value = true
  optionalFontDownloadMessage.value = `正在加载${option.label}...`

  const loaded = await loadOptionalReadingFont(fontId, { failOnError: true }).catch(() => false)

  if (!loaded) {
    isPendingDownloadLoading.value = false
    optionalFontDownloadMessage.value = '字体加载失败,请检查网络后重试。'
    return
  }

  rememberConfirmedOptionalFont(fontId)
  pendingDownloadFontId.value = null
  isPendingDownloadLoading.value = false
  optionalFontDownloadMessage.value = ''
  emit('updateFontFamily', fontId)
}

function selectThemeStyle(value: ReadingThemeStyleId): void {
  emit('updateThemeStyle', value)
}

function selectColorScheme(value: ReadingColorSchemeId): void {
  emit('updateColorScheme', value)
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
              @keydown="onRadioKeydown($event, fontFamilyOptions, props.settings.fontFamily, selectFontFamily)"
            >
              <button
                v-for="option in fontFamilyOptions"
                :key="option.id"
                class="reading-settings__segment"
                type="button"
                role="radio"
                :aria-checked="props.settings.fontFamily === option.id"
                :aria-label="option.ariaLabel"
                :data-option-id="option.id"
                :data-pending-download="pendingDownloadFontId === option.id ? 'true' : undefined"
                :style="{ fontFamily: option.previewTokenValue ?? option.tokenValue }"
                data-settings-item
                @click="selectFontFamily(option.id)"
              >
                <span class="reading-settings__segment-label">{{ option.label }}</span>
                <span v-if="option.badge" class="reading-settings__segment-badge">
                  {{ option.badge }}<template v-if="option.confirmDownload"> · {{ option.confirmDownload.sizeLabel }}</template>
                </span>
              </button>
            </div>
            <div
              v-if="pendingDownloadFontOption"
              class="reading-settings__download-confirm"
              role="status"
              data-testid="optional-font-download-confirm"
            >
              <span>
                <strong>启用 {{ pendingDownloadFontOption.label }}</strong>
                <span>{{ pendingDownloadFontOption.confirmDownload?.message }}</span>
              </span>
              <div class="reading-settings__download-actions">
                <button
                  class="reading-settings__download-action"
                  type="button"
                  :disabled="isPendingDownloadLoading"
                  data-testid="optional-font-download-accept"
                  @click="confirmPendingDownloadFont"
                >
                  {{ isPendingDownloadLoading ? '加载中' : '下载并启用' }}
                </button>
                <button
                  class="reading-settings__download-action reading-settings__download-action--muted"
                  type="button"
                  :disabled="isPendingDownloadLoading"
                  @click="cancelPendingDownloadFont"
                >
                  取消
                </button>
              </div>
              <span
                v-if="optionalFontDownloadMessage"
                class="reading-settings__download-message"
                :data-kind="optionalFontDownloadMessage.includes('失败') ? 'error' : 'info'"
              >
                {{ optionalFontDownloadMessage }}
              </span>
            </div>
            <div class="reading-settings__font-actions">
              <input
                ref="localFontInput"
                class="reading-settings__file-input"
                type="file"
                accept=".woff2,.ttf,.otf,font/woff2,font/ttf,font/otf,application/font-woff2,application/vnd.ms-opentype,application/x-font-opentype,application/x-font-ttf,application/x-font-otf"
                data-testid="local-font-file-input"
                @change="onLocalFontFileChange"
              >
              <button
                class="reading-settings__drilldown reading-settings__drilldown--inline"
                type="button"
                data-settings-item
                @click="openLocalFontPicker"
              >
                <span>
                  <strong>＋ 上传字体</strong>
                  <span>.woff2 / .ttf / .otf · 本地保存</span>
                </span>
                <span aria-hidden="true">↥</span>
              </button>
              <button
                v-if="props.localFonts.length > 0"
                class="reading-settings__drilldown reading-settings__drilldown--inline"
                type="button"
                data-settings-item
                aria-controls="reading-settings-fonts-panel"
                @click="openPanel('fonts')"
              >
                <span>
                  <strong>管理我的字体</strong>
                  <span>{{ props.localFonts.length }} 个本地字体</span>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
            <p
              v-if="props.localFontMessage"
              class="reading-settings__subpanel-note reading-settings__font-message"
              :data-kind="props.localFontMessage.kind"
            >
              {{ props.localFontMessage.text }}
            </p>
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
            <legend class="reading-settings__legend">风格</legend>
            <div
              class="reading-settings__segments reading-settings__segments--theme-style"
              role="radiogroup"
              aria-label="主题风格"
              @keydown="onRadioKeydown($event, readingThemeStyleOptions, props.settings.themeStyle, selectThemeStyle)"
            >
              <button
                v-for="option in readingThemeStyleOptions"
                :key="option.id"
                class="reading-settings__segment"
                type="button"
                role="radio"
                :aria-checked="props.settings.themeStyle === option.id"
                :aria-label="option.ariaLabel"
                :data-option-id="option.id"
                data-settings-item
                @click="selectThemeStyle(option.id)"
              >
                {{ option.label }}
              </button>
            </div>
          </fieldset>

          <fieldset class="reading-settings__field">
            <legend class="reading-settings__legend">配色</legend>
            <div
              class="reading-settings__segments reading-settings__segments--color-scheme"
              role="radiogroup"
              aria-label="配色"
              @keydown="onRadioKeydown($event, readingColorSchemeOptions, props.settings.colorScheme, selectColorScheme)"
            >
              <button
                v-for="option in readingColorSchemeOptions"
                :key="option.id"
                class="reading-settings__segment"
                type="button"
                role="radio"
                :aria-checked="props.settings.colorScheme === option.id"
                :aria-label="option.ariaLabel"
                :data-option-id="option.id"
                data-settings-item
                @click="selectColorScheme(option.id)"
              >
                {{ option.label }}
              </button>
            </div>
          </fieldset>

          <button
            v-if="props.settings.colorScheme === 'custom'"
            class="reading-settings__drilldown reading-settings__drilldown--custom-theme"
            type="button"
            data-settings-item
            aria-controls="reading-settings-custom-theme-panel"
            @click="openPanel('custom-theme')"
          >
            <span>
              <strong>编辑自定义配色</strong>
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
            <strong>{{ props.activePresetName }}</strong>
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

      <ReadingCustomThemePanel
        :active="activePanel === 'custom-theme'"
        :custom-theme="props.settings.customTheme"
        @update-custom-theme="emit('updateCustomTheme', $event)"
        @auto-fix-custom-theme="emit('autoFixCustomTheme')"
      />

      <ReadingLocalFontsPanel
        :active="activePanel === 'fonts'"
        :local-fonts="props.localFonts"
        @update-font-family="selectFontFamily"
        @rename-local-font="forwardRenameLocalFont"
        @delete-local-font="emit('deleteLocalFont', $event)"
      />

      <ReadingPresetsPanel
        :active="activePanel === 'presets'"
        :active-preset-name="props.activePresetName"
        :font-family-options="fontFamilyOptions"
        v-model:preset-name-input="presetNameInput"
        :presets="props.presets"
        @save-preset="emit('savePreset', $event)"
        @apply-preset="emit('applyPreset', $event)"
        @rename-preset="forwardRenamePreset"
        @delete-preset="emit('deletePreset', $event)"
        @reset="applyDefaultPreset"
      />

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
  position: relative;
  z-index: var(--z-raised);
  inline-size: min(24rem, calc(100vw - 2rem));
}

.reading-settings__panel {
  max-block-size: min(82vh, 44rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--spacing-3);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  box-shadow: var(--shadow-panel);
  transition: var(--transition-surface);
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
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-md);
  line-height: var(--leading-tight);
}

.reading-settings__caption {
  margin-block-start: 0.2rem;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.reading-settings__back,
.reading-settings__close {
  display: grid;
  place-items: center;
  inline-size: var(--touch-target-min);
  block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
}

.reading-settings__content {
  display: grid;
  gap: var(--spacing-3-5);
}

.reading-settings__group {
  padding-block-start: var(--spacing-3);
  border-block-start: var(--border-width-thin) solid var(--border-subtle);
}

.reading-settings__group:first-child {
  padding-block-start: 0;
  border-block-start: 0;
}

.reading-settings__group-title {
  margin: 0 0 0.58rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
}

.reading-settings__field {
  padding: 0;
  border: 0;
}

.reading-settings__field + .reading-settings__field {
  margin-block-start: 0.75rem;
}

.reading-settings__file-input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.reading-settings__legend {
  margin-block-end: 0.35rem;
  color: var(--text-secondary);
  font-size: var(--text-xs);
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
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.reading-settings__range-value {
  color: var(--text-accent);
  font-weight: var(--font-weight-bold);
}

.reading-settings__range {
  --font-size-progress: 42.857%;
  display: block;
  inline-size: 100%;
  block-size: var(--touch-target-min);
  margin: 0;
  appearance: none;
  background: transparent;
  color: var(--text-accent);
  cursor: pointer;
}

.reading-settings__range::-webkit-slider-runnable-track {
  block-size: 4px;
  border-radius: var(--radius-full);
  background:
    linear-gradient(
      to right,
      var(--accent-primary) 0 var(--font-size-progress),
      var(--border-subtle) var(--font-size-progress) 100%
    );
}

.reading-settings__range::-moz-range-track {
  block-size: 4px;
  border-radius: var(--radius-full);
  background: var(--border-subtle);
}

.reading-settings__range::-moz-range-progress {
  block-size: 4px;
  border-radius: var(--radius-full);
  background: var(--accent-primary);
}

.reading-settings__range::-webkit-slider-thumb {
  appearance: none;
  inline-size: 30px;
  block-size: 30px;
  margin-block-start: -13px;
  border: var(--border-width-heavy) solid var(--accent-primary);
  border-radius: var(--radius-control);
  background: var(--surface-panel);
  box-shadow: var(--shadow-sm);
}

.reading-settings__range::-moz-range-thumb {
  inline-size: 30px;
  block-size: 30px;
  border: var(--border-width-heavy) solid var(--accent-primary);
  border-radius: var(--radius-control);
  background: var(--surface-panel);
  box-shadow: var(--shadow-sm);
}

.reading-settings__range:focus-visible {
  outline: var(--border-width-thick) solid var(--focus-ring-color);
  outline-offset: var(--spacing-1);
  box-shadow: var(--focus-ring-shadow);
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
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--text-muted) 38%, transparent);
}

.reading-settings__segments {
  display: grid;
  grid-template-columns: repeat(var(--segment-count, 3), minmax(0, 1fr));
  gap: 0.35rem;
}

.reading-settings__segments--color-scheme {
  --segment-count: 3;
}

.reading-settings__segments--theme-style {
  --segment-count: 2;
}

.reading-settings__segments--font-family {
  --segment-count: 2;
}

.reading-settings__font-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
  margin-block-start: 0.5rem;
}

.reading-settings__font-actions .reading-settings__drilldown {
  min-inline-size: 0;
}

.reading-settings__drilldown--inline {
  gap: 0.55rem;
}

.reading-settings__segments--outline-position {
  --segment-count: 2;
}

.reading-settings__segment,
.reading-settings__drilldown,
.reading-settings__reset,
.reading-settings__done {
  min-block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
}

.reading-settings__segment {
  display: grid;
  gap: 0.14rem;
  place-items: center;
  padding: 0.35rem 0.45rem;
  overflow-wrap: anywhere;
}

.reading-settings__segment[data-pending-download="true"] {
  border-color: var(--accent-primary);
  box-shadow: inset 0 0 0 var(--border-width-thin) var(--accent-primary);
}

.reading-settings__segment-label {
  line-height: 1.16;
}

.reading-settings__segment-badge {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1.15;
}

.reading-settings__download-confirm {
  display: grid;
  gap: 0.55rem;
  margin-block-start: 0.5rem;
  padding: 0.62rem;
  border: var(--border-width-surface) solid var(--status-warning-border);
  border-radius: var(--radius-card);
  background: var(--status-warning-bg);
}

.reading-settings__download-confirm > span:first-child {
  display: grid;
  gap: 0.2rem;
  color: var(--status-warning-fg);
  font-size: 0.82rem;
  line-height: 1.45;
}

.reading-settings__download-confirm > span:first-child > span {
  color: var(--status-warning-fg);
}

.reading-settings__download-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.reading-settings__download-action {
  min-block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 800;
}

.reading-settings__download-action--muted {
  color: var(--text-secondary);
}

.reading-settings__download-action:disabled {
  cursor: wait;
  opacity: 0.55;
}

.reading-settings__download-message {
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.reading-settings__download-message[data-kind="error"] {
  width: fit-content;
  padding: var(--spacing-1) var(--spacing-1-5);
  border: var(--border-width-thin) solid var(--status-danger-border);
  border-radius: var(--radius-control);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  font-weight: 700;
}

.reading-settings__summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.45rem;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.reading-settings__summary-label,
.reading-settings__subpanel-note {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.reading-settings__drilldown {
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
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.reading-settings__subpanel-note {
  margin: 0.65rem 0 0;
}

.reading-settings__font-message[data-kind="info"] {
  color: var(--text-secondary);
}

.reading-settings__font-message[data-kind="warning"] {
  width: fit-content;
  padding: var(--spacing-1) var(--spacing-1-5);
  border: var(--border-width-thin) solid var(--status-warning-border);
  border-radius: var(--radius-control);
  background: var(--status-warning-bg);
  color: var(--status-warning-fg);
  font-weight: 700;
}

.reading-settings__font-message[data-kind="error"] {
  width: fit-content;
  padding: var(--spacing-1) var(--spacing-1-5);
  border: var(--border-width-thin) solid var(--status-danger-border);
  border-radius: var(--radius-control);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  font-weight: 800;
}

.reading-settings__status--warning {
  padding: 0.08rem var(--spacing-1);
  border: var(--border-width-thin) solid var(--status-warning-border);
  border-radius: var(--radius-control);
  background: var(--status-warning-bg);
  color: var(--status-warning-fg) !important;
  font-weight: 700;
}

.reading-settings__segment[aria-checked="true"] {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: 700;
  box-shadow: inset 0 0 0 var(--border-width-thin) var(--accent-primary);
}

.reading-settings__segment:hover,
.reading-settings__segment:focus-visible,
.reading-settings__drilldown:hover,
.reading-settings__drilldown:focus-visible,
.reading-settings__back:hover,
.reading-settings__back:focus-visible,
.reading-settings__close:hover,
.reading-settings__close:focus-visible,
.reading-settings__reset:hover,
.reading-settings__reset:focus-visible,
.reading-settings__done:hover,
.reading-settings__done:focus-visible {
  border-color: var(--accent-primary);
}

.reading-settings__actions {
  position: sticky;
  inset-block-end: -0.8rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  margin: 1rem -0.8rem -0.8rem;
  padding: 0.75rem 0.8rem 0.8rem;
  border-block-start: var(--border-width-thin) solid var(--border-subtle);
  background: var(--surface-panel);
}

.reading-settings__reset {
  color: var(--text-secondary);
}

.reading-settings__done {
  min-inline-size: 5.2rem;
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: var(--accent-contrast);
  font-weight: 700;
}

.reading-settings__reset:disabled {
  cursor: default;
  opacity: var(--opacity-disabled);
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
    border-radius: var(--radius-card) var(--radius-card) 0 0;
  }

  .reading-settings__handle {
    display: block;
    inline-size: 2.7rem;
    block-size: 0.28rem;
    margin: 0 auto 0.7rem;
    border-radius: var(--radius-full);
    background: var(--border-default);
  }

  .reading-settings__actions {
    inset-block-end: calc(-1 * max(1rem, calc(env(safe-area-inset-bottom) + 1rem)));
    margin: 1rem -1rem calc(-1 * max(1rem, calc(env(safe-area-inset-bottom) + 1rem)));
    padding: 0.75rem 1rem max(1rem, calc(env(safe-area-inset-bottom) + 1rem));
  }

  .reading-settings__font-actions {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reading-settings {
    transition: none;
  }
}
</style>
