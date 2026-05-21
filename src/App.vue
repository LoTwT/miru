<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import FloatingInputMenu from '@/components/FloatingInputMenu.vue'
import ReadingSettingsControl from '@/components/ReadingSettingsControl.vue'
import ReaderSurface from '@/components/ReaderSurface.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { useDocumentInput } from '@/features/input/useDocumentInput'
import { useRenderedMarkdown } from '@/features/reader/useRenderedMarkdown'
import { useReadingSettings } from '@/features/settings/useReadingSettings'
import { loadDefaultReadingFonts } from '@/lib/theme/fonts'
import { readPersistedReadingSettings } from '@/lib/theme/tokens'
import type { ReaderDocument, RemoteImageMode } from '@/types/reader'

const documentState = reactive<ReaderDocument>({
  source: 'sample',
  label: 'miru sample',
  markdown: sampleMarkdown,
})
const isDragging = shallowRef(false)
const isInputMenuOpen = shallowRef(false)
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
  }
})

onMounted(async () => {
  await loadDefaultReadingFonts()
  readingSettings.applyCurrent()
})

function resetToSample(): void {
  loadFromText(sampleMarkdown, 'sample', 'miru sample')
}

async function onDocumentLoaded(source: ReaderDocument['source']): Promise<void> {
  if (source === 'sample') {
    return
  }

  if (isInputMenuOpen.value) {
    isInputMenuOpen.value = false
  }

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
    />

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
      @update-font-size="readingSettings.updateFontSize"
      @update-measure="readingSettings.updateMeasure"
      @update-line-height="readingSettings.updateLineHeight"
      @update-font-family="readingSettings.updateFontFamily"
      @update-theme="readingSettings.updateTheme"
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

</style>
