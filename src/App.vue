<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import FloatingInputMenu from '@/components/FloatingInputMenu.vue'
import LibraryView from '@/components/LibraryView.vue'
import ReaderOutlineNavigation from '@/components/ReaderOutlineNavigation.vue'
import ReadingSettingsControl from '@/components/ReadingSettingsControl.vue'
import ReaderSurface from '@/components/ReaderSurface.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { getBareUrlPaste } from '@/features/input/urlInput'
import { useDocumentInput } from '@/features/input/useDocumentInput'
import { createLibraryStore, LibraryQuotaExceededError } from '@/features/library/libraryStore'
import { useRenderedMarkdown } from '@/features/reader/useRenderedMarkdown'
import { useReadingSettings } from '@/features/settings/useReadingSettings'
import { loadDefaultReadingFonts } from '@/lib/theme/fonts'
import { readPersistedReadingSettings } from '@/lib/theme/tokens'
import type { LibraryEntry, LibrarySortMode, LibrarySource, MarkdownReadingPosition } from '@/features/library/types'
import type { ReaderDocument, RemoteImageMode } from '@/types/reader'
import type { ReaderOutlineItem } from '@/features/reader/outlineNavigation'

type AppMode = 'reader' | 'library'

const documentState = reactive<ReaderDocument>({
  source: 'sample',
  label: 'miru sample',
  markdown: sampleMarkdown,
})
const libraryStore = createLibraryStore()
const appMode = shallowRef<AppMode>('reader')
const libraryEntries = shallowRef<LibraryEntry[]>([])
const librarySortMode = shallowRef<LibrarySortMode>('last-opened')
const activeLibraryEntryId = shallowRef<string | null>(null)
const libraryStatus = shallowRef('')
const inputMenuStatus = shallowRef('')
const pendingRestorePosition = shallowRef<MarkdownReadingPosition | null>(null)
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
    void loadIncomingDocument(document)
  },
})

const rendered = useRenderedMarkdown({
  markdown: () => documentState.markdown,
  remoteImageMode: () => remoteImageMode.value,
})

const status = computed(() => rendered.error.value ?? error.value?.detail ?? inputMenuStatus.value ?? '')

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
  await refreshLibraryEntries()
  window.addEventListener('scroll', onWindowScroll, { passive: true })
})

onUnmounted(() => {
  window.clearTimeout(positionSaveTimer)
  window.removeEventListener('scroll', onWindowScroll)
  void libraryStore.close()
})

function resetToSample(): void {
  loadFromText(sampleMarkdown, 'sample', 'miru sample')
}

async function showLibrary(): Promise<void> {
  const currentScrollY = window.scrollY
  window.clearTimeout(positionSaveTimer)
  await saveActiveReadingPosition({ scrollY: currentScrollY })
  await refreshLibraryEntries()
  appMode.value = 'library'
  libraryStatus.value = ''
  window.scrollTo({ top: 0, behavior: 'auto' })
}

async function showReader(): Promise<void> {
  appMode.value = 'reader'
  await nextTick()
  readerRef.value?.focus()
}

function openAddMenu(): void {
  isInputMenuOpen.value = true
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

async function loadIncomingDocument(document: ReaderDocument): Promise<void> {
  libraryStatus.value = ''
  inputMenuStatus.value = ''

  if (document.source === 'sample') {
    activeLibraryEntryId.value = null
    documentState.source = document.source
    documentState.label = document.label
    documentState.markdown = document.markdown
    appMode.value = 'reader'
    await onDocumentLoaded(document.source)
    return
  }

  try {
    await saveActiveReadingPosition()
    const source = document.librarySource ?? createFallbackLibrarySource(document)
    const entry = await libraryStore.addMarkdownDocument({
      markdown: document.markdown,
      source,
      label: document.label,
    })
    await refreshLibraryEntries()
    await openLibraryEntry(entry)
  }
  catch (reason) {
    if (reason instanceof LibraryQuotaExceededError) {
      libraryStatus.value = '本机存储空间不够, 没有加入文库。可以删除一些文档后再试。'
      inputMenuStatus.value = libraryStatus.value
    }
    else {
      libraryStatus.value = '无法加入文库。当前文档没有被替换, 请稍后再试。'
      inputMenuStatus.value = libraryStatus.value
    }
    isInputMenuOpen.value = true
  }
}

async function openLibraryEntry(entry: LibraryEntry): Promise<void> {
  libraryStatus.value = ''

  if (entry.type === 'pdf') {
    libraryStatus.value = 'PDF 原件查看会在下一步接入。'
    appMode.value = 'library'
    return
  }

  await saveActiveReadingPosition()
  const opened = await libraryStore.openMarkdownDocument(entry.id)

  if (!opened) {
    libraryStatus.value = '这篇文档已经不在文库中。'
    await refreshLibraryEntries()
    return
  }

  activeLibraryEntryId.value = opened.entry.id
  documentState.source = readerSourceFromLibrarySource(opened.entry.source)
  documentState.label = labelForEntry(opened.entry)
  documentState.markdown = opened.markdown
  appMode.value = 'reader'
  pendingRestorePosition.value = opened.position

  await refreshLibraryEntries()
  await onDocumentLoaded(documentState.source)
  restorePendingPositionIfReady()
}

async function updateLibrarySortMode(mode: LibrarySortMode): Promise<void> {
  librarySortMode.value = mode
  await refreshLibraryEntries()
}

async function renameLibraryEntry(entry: LibraryEntry, title: string): Promise<void> {
  const updated = await libraryStore.updateEntry(entry.id, { title })
  if (activeLibraryEntryId.value === updated.id && documentState.source === 'paste') {
    documentState.label = updated.title
  }
  await refreshLibraryEntries()
}

async function toggleLibraryPin(entry: LibraryEntry): Promise<void> {
  await libraryStore.updateEntry(entry.id, { pinned: !entry.pinned })
  await refreshLibraryEntries()
}

async function deleteLibraryEntry(entry: LibraryEntry): Promise<void> {
  await libraryStore.deleteEntry(entry.id)

  if (activeLibraryEntryId.value === entry.id) {
    activeLibraryEntryId.value = null
    documentState.source = 'sample'
    documentState.label = 'miru sample'
    documentState.markdown = sampleMarkdown
  }

  await refreshLibraryEntries()
  focusLibraryView()
}

async function clearLibrary(): Promise<void> {
  await libraryStore.clearLibrary()
  activeLibraryEntryId.value = null
  documentState.source = 'sample'
  documentState.label = 'miru sample'
  documentState.markdown = sampleMarkdown
  await refreshLibraryEntries()
  focusLibraryView()
}

async function refreshLibraryEntries(): Promise<void> {
  libraryEntries.value = await libraryStore.listEntries(librarySortMode.value)
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

    loadFromText(text, 'paste', 'Pasted markdown', { kind: 'paste' })
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

let positionSaveTimer: ReturnType<typeof setTimeout> | undefined

function onWindowScroll(): void {
  if (appMode.value !== 'reader' || !activeLibraryEntryId.value) {
    return
  }

  window.clearTimeout(positionSaveTimer)
  positionSaveTimer = window.setTimeout(() => {
    void saveActiveReadingPosition()
  }, 450)
}

async function saveActiveReadingPosition(options: { scrollY?: number } = {}): Promise<void> {
  const documentId = activeLibraryEntryId.value

  if (!documentId || appMode.value !== 'reader') {
    return
  }

  await libraryStore.saveReadingPosition({
    documentId,
    type: 'markdown',
    scrollY: Math.max(0, Math.round(options.scrollY ?? window.scrollY)),
    activeHeadingId: activeOutlineId.value || null,
  })
}

function restorePendingPositionIfReady(): void {
  const position = pendingRestorePosition.value

  if (!position || rendered.isRendering.value || appMode.value !== 'reader') {
    return
  }

  pendingRestorePosition.value = null
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: Math.max(0, position.scrollY),
        behavior: 'auto',
      })
    })
  })
}

watch(() => rendered.isRendering.value, restorePendingPositionIfReady)

function createFallbackLibrarySource(document: ReaderDocument): LibrarySource {
  if (document.source === 'file') {
    return {
      kind: 'file',
      fileName: document.label,
      mimeType: 'text/plain',
    }
  }

  if (document.source === 'url') {
    const inputUrl = document.label
    return {
      kind: 'url',
      inputUrl,
      requestUrl: inputUrl,
      domain: safeDomain(inputUrl),
    }
  }

  return { kind: 'paste' }
}

function readerSourceFromLibrarySource(source: LibrarySource): ReaderDocument['source'] {
  return source.kind === 'url' ? 'url' : source.kind === 'file' ? 'file' : 'paste'
}

function labelForEntry(entry: LibraryEntry): string {
  if (entry.source.kind === 'url') {
    return entry.source.inputUrl
  }

  if (entry.source.kind === 'file') {
    return entry.source.fileName
  }

  return entry.title
}

function safeDomain(value: string): string {
  try {
    return new URL(value).hostname
  }
  catch {
    return ''
  }
}

function focusLibraryView(): void {
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="library-view"]')?.focus()
    })
  })
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
      <button
        class="app-shell__library-button"
        type="button"
        data-testid="library-open-button"
        @click="appMode === 'library' ? showReader() : showLibrary()"
      >
        {{ appMode === 'library' ? '返回阅读' : '文库' }}
      </button>
    </header>

    <LibraryView
      v-if="appMode === 'library'"
      :entries="libraryEntries"
      :sort-mode="librarySortMode"
      :active-entry-id="activeLibraryEntryId"
      :status="libraryStatus"
      @add="openAddMenu"
      @open="openLibraryEntry"
      @sort="updateLibrarySortMode"
      @rename="renameLibraryEntry"
      @toggle-pin="toggleLibraryPin"
      @delete="deleteLibraryEntry"
      @clear="clearLibrary"
      @close="showReader"
    />

    <template v-else>
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
    </template>

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
      @open-library="showLibrary"
      @fetch-url="loadFromUrl"
      @clear="resetToSample"
    />

    <ReadingSettingsControl
      v-if="appMode === 'reader'"
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
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

.app-shell__library-button {
  min-block-size: 2.75rem;
  padding: 0 0.85rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 72%, transparent);
  border-radius: 8px;
  color: var(--reading-fg-muted);
  background: color-mix(in srgb, var(--reading-bg) 92%, var(--reading-fg) 8%);
  font: inherit;
  cursor: pointer;
}

.app-shell__library-button:hover,
.app-shell__library-button:focus-visible {
  color: var(--reading-fg);
  border-color: color-mix(in srgb, var(--reading-accent) 54%, transparent);
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
