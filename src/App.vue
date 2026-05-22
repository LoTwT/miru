<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import FloatingInputMenu from '@/components/FloatingInputMenu.vue'
import ReaderOutlineNavigation from '@/components/ReaderOutlineNavigation.vue'
import ReadingSettingsControl from '@/components/ReadingSettingsControl.vue'
import ReaderSurface from '@/components/ReaderSurface.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { getBareUrlPaste } from '@/features/input/urlInput'
import { useDocumentInput } from '@/features/input/useDocumentInput'
import { useRenderedMarkdown } from '@/features/reader/useRenderedMarkdown'
import { useReadingSettings } from '@/features/settings/useReadingSettings'
import { loadDefaultReadingFonts } from '@/lib/theme/fonts'
import { readPersistedReadingSettings } from '@/lib/theme/tokens'
import type { ReaderDocument, RemoteImageMode } from '@/types/reader'
import type { ReaderOutlineItem } from '@/features/reader/outlineNavigation'

const documentState = reactive<ReaderDocument>({
  source: 'sample',
  label: 'miru sample',
  markdown: sampleMarkdown,
})
const isDragging = shallowRef(false)
const isInputMenuOpen = shallowRef(false)
const liveStatus = shallowRef('')
const outlineItems = shallowRef<ReaderOutlineItem[]>([])
const activeOutlineId = shallowRef('')
const readerRef = useTemplateRef<InstanceType<typeof ReaderSurface>>('reader')
const persistedSettings = readPersistedReadingSettings()
const remoteImageMode = shallowRef<RemoteImageMode>(persistedSettings?.remoteImageMode ?? 'auto')
const readingSettings = useReadingSettings()

const { error, isFetchingUrl, loadFromClipboard, loadFromFile, loadFromText, loadFromUrl } = useDocumentInput({
  onDocument(document) {
    documentState.source = document.source
    documentState.label = document.label
    documentState.markdown = document.markdown
    void onDocumentLoaded(document.source)
  },
})

const rendered = useRenderedMarkdown({
  markdown: () => documentState.markdown,
  remoteImageMode: () => remoteImageMode.value,
})

const status = computed(() => rendered.error.value ?? error.value?.detail ?? '')

watch(status, (value) => {
  if (value) {
    isInputMenuOpen.value = true
    liveStatus.value = value
  }
})

watch(isFetchingUrl, (value) => {
  if (value) {
    liveStatus.value = '正在抓取 URL 内容…'
  }
})

onMounted(async () => {
  await loadDefaultReadingFonts()
  readingSettings.applyCurrent()
})

function resetToSample(): void {
  loadFromText(sampleMarkdown, 'sample', 'miru sample')
}

function navigateToOutlineItem(id: string): void {
  void readerRef.value?.scrollToHeading(id)
}

function updateOutlineItems(items: ReaderOutlineItem[]): void {
  outlineItems.value = items

  if (items.length === 0) {
    activeOutlineId.value = ''
  }
}

function updateActiveOutlineId(id: string): void {
  activeOutlineId.value = id
}

async function onDocumentLoaded(source: ReaderDocument['source']): Promise<void> {
  if (source === 'sample') {
    return
  }

  if (isInputMenuOpen.value) {
    isInputMenuOpen.value = false
  }

  liveStatus.value = '文档已加载'

  await nextTick()
  readerRef.value?.focus()
}

function onPaste(event: ClipboardEvent): void {
  if (isEditablePasteTarget(event.target)) {
    return
  }

  const text = event.clipboardData?.getData('text/plain')

  if (text?.trim()) {
    event.preventDefault()

    const bareUrl = getBareUrlPaste(text)
    if (bareUrl) {
      isInputMenuOpen.value = true
      void loadFromUrl(bareUrl)
      return
    }

    loadFromText(text, 'paste', 'Pasted markdown')
  }
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  return target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  isDragging.value = true
}

function onDragLeave(event: DragEvent): void {
  if (event.currentTarget === event.target) {
    isDragging.value = false
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  isDragging.value = false

  const file = event.dataTransfer?.files[0]

  if (file) {
    await loadFromFile(file)
  }
}
</script>

<template>
  <main
    class="app-shell"
    :class="{ 'app-shell--dragging': isDragging }"
    @paste="onPaste"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <header class="app-shell__header">
      <a class="app-shell__mark" href="/" aria-label="miru home">miru</a>
    </header>

    <ReaderSurface
      ref="reader"
      :document="documentState"
      :html="rendered.html.value"
      :is-rendering="rendered.isRendering.value"
      @outline-change="updateOutlineItems"
      @active-heading-change="updateActiveOutlineId"
    />

    <ReaderOutlineNavigation
      :items="outlineItems"
      :active-id="activeOutlineId"
      :position="readingSettings.state.outlinePosition"
      @navigate="navigateToOutlineItem"
    />

    <p class="app-shell__live-status" role="status" aria-live="polite">
      {{ liveStatus }}
    </p>

    <FloatingInputMenu
      :is-open="isInputMenuOpen"
      :is-fetching-url="isFetchingUrl"
      :status="status"
      @update:is-open="isInputMenuOpen = $event"
      @paste="loadFromClipboard"
      @open-file="loadFromFile"
      @fetch-url="loadFromUrl"
      @clear="resetToSample"
    />

    <ReadingSettingsControl
      :settings="readingSettings.state"
      :is-default="readingSettings.isDefault.value"
      :show-outline-position-control="outlineItems.length > 0"
      @update-font-size="readingSettings.updateFontSize"
      @update-measure="readingSettings.updateMeasure"
      @update-line-height="readingSettings.updateLineHeight"
      @update-font-family="readingSettings.updateFontFamily"
      @update-theme="readingSettings.updateTheme"
      @update-outline-position="readingSettings.updateOutlinePosition"
      @reset="readingSettings.reset"
    />
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  padding: 1rem clamp(1.25rem, 4vw, 4rem);
  background: var(--reading-bg);
  color: var(--reading-fg);
}

.app-shell--dragging {
  outline: 2px dashed var(--reading-accent);
  outline-offset: -1rem;
}

.app-shell__header {
  max-width: 78rem;
  margin: 0 auto;
  padding-top: 1rem;
}

.app-shell__mark {
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: 1.35rem;
  font-weight: 650;
  text-decoration: none;
}

.app-shell__live-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

</style>
