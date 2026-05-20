<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'

import InputToolbar from '@/components/InputToolbar.vue'
import ReaderSurface from '@/components/ReaderSurface.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { useDocumentInput } from '@/features/input/useDocumentInput'
import { useRenderedMarkdown } from '@/features/reader/useRenderedMarkdown'
import { loadDefaultReadingFonts } from '@/lib/theme/fonts'
import { applyPersistedReadingSettings, readPersistedReadingSettings } from '@/lib/theme/tokens'
import type { ReaderDocument, RemoteImageMode } from '@/types/reader'

const documentState = reactive<ReaderDocument>({
  source: 'sample',
  label: 'miru sample',
  markdown: sampleMarkdown,
})
const isDragging = shallowRef(false)
const persistedSettings = readPersistedReadingSettings()
const remoteImageMode = shallowRef<RemoteImageMode>(persistedSettings?.remoteImageMode ?? 'auto')

const { error, isFetchingUrl, loadFromClipboard, loadFromFile, loadFromText, loadFromUrl } = useDocumentInput({
  onDocument(document) {
    documentState.source = document.source
    documentState.label = document.label
    documentState.markdown = document.markdown
  },
})

const rendered = useRenderedMarkdown({
  markdown: () => documentState.markdown,
  remoteImageMode: () => remoteImageMode.value,
})

const status = computed(() => rendered.error.value ?? error.value?.detail ?? '')

onMounted(async () => {
  await loadDefaultReadingFonts()
  applyPersistedReadingSettings(persistedSettings)
})

function resetToSample(): void {
  loadFromText(sampleMarkdown, 'sample', 'miru sample')
}

function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text/plain')

  if (text?.trim()) {
    event.preventDefault()
    loadFromText(text, 'paste', 'Pasted markdown')
  }
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
      <InputToolbar
        :is-fetching-url="isFetchingUrl"
        @paste="loadFromClipboard"
        @open-file="loadFromFile"
        @fetch-url="loadFromUrl"
        @clear="resetToSample"
      />
    </header>

    <p v-if="status" class="app-shell__status" role="status">
      {{ status }}
    </p>

    <ReaderSurface
      :document="documentState"
      :html="rendered.html.value"
      :is-rendering="rendered.isRendering.value"
    />

    <!-- V1 settings drawer mount point: customization UI calls runtime token mutation APIs. -->
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
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

.app-shell__status {
  width: min(100%, var(--reading-measure));
  margin: 1.5rem auto 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--reading-rule);
  border-radius: 8px;
  background: var(--reading-code-bg);
  color: var(--reading-fg-muted);
}

@media (max-width: 760px) {
  .app-shell__header {
    grid-template-columns: 1fr;
  }
}
</style>
