<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import BackToTop from '@/components/BackToTop.vue'
import FloatingInputMenu from '@/components/FloatingInputMenu.vue'
import LibraryView from '@/components/LibraryView.vue'
import PdfViewer from '@/components/PdfViewer.vue'
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
import type { LibraryEntry, LibrarySortMode, LibrarySource, MarkdownReadingPosition, OpenPdfDocumentResult, PdfReadingPosition } from '@/features/library/types'
import type { ReaderDocument, RemoteImageMode } from '@/types/reader'
import type { ReaderOutlineItem } from '@/features/reader/outlineNavigation'

type AppMode = 'reader' | 'library' | 'pdf'
type CommandSurfaceId = 'actions' | 'outline' | 'settings'

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
const activePdfDocument = shallowRef<OpenPdfDocumentResult | null>(null)
const isDragging = shallowRef(false)
const openSurfaceId = shallowRef<CommandSurfaceId | null>(null)
const liveStatus = shallowRef('')
const outlineItems = shallowRef<ReaderOutlineItem[]>([])
const activeOutlineId = shallowRef('')
const isNarrowOutlineViewport = shallowRef(false)
const topBarRef = useTemplateRef<HTMLElement>('topBar')
const commandSurfaceRef = useTemplateRef<HTMLElement>('commandSurface')
const actionsButtonRef = useTemplateRef<HTMLButtonElement>('actionsButton')
const outlineButtonRef = useTemplateRef<HTMLButtonElement>('outlineButton')
const settingsButtonRef = useTemplateRef<HTMLButtonElement>('settingsButton')
const readerRef = useTemplateRef<InstanceType<typeof ReaderSurface>>('reader')
const pdfViewerRef = useTemplateRef<InstanceType<typeof PdfViewer>>('pdfViewer')
const persistedSettings = readPersistedReadingSettings()
const remoteImageMode = shallowRef<RemoteImageMode>(persistedSettings?.remoteImageMode ?? 'auto')
const readingSettings = useReadingSettings()
let pageScrollLock: {
  bodyLeft: string
  bodyOverflow: string
  bodyPosition: string
  bodyRight: string
  bodyTop: string
  bodyWidth: string
  htmlOverscrollBehavior: string
  scrollY: number
} | null = null
let outlineViewportMediaQuery: MediaQueryList | undefined
let systemDarkThemeMediaQuery: MediaQueryList | undefined
let reducedMotionMediaQuery: MediaQueryList | undefined

const { error, isFetchingUrl, loadFromClipboard, loadFromFile, loadFromText, loadFromUrl } = useDocumentInput({
  onDocument(document) {
    void loadIncomingDocument(document)
  },
  onPdf(file) {
    void loadIncomingPdf(file)
  },
})

const rendered = useRenderedMarkdown({
  markdown: () => documentState.markdown,
  remoteImageMode: () => remoteImageMode.value,
})

const status = computed(() => rendered.error.value ?? error.value?.detail ?? inputMenuStatus.value ?? '')
const isActionsSurfaceOpen = computed(() => openSurfaceId.value === 'actions')
const isOutlineSurfaceOpen = computed(() => openSurfaceId.value === 'outline')
const isSettingsSurfaceOpen = computed(() => openSurfaceId.value === 'settings')
const hasReaderOutline = computed(() => appMode.value === 'reader' && outlineItems.value.length > 0)
const shouldRenderOutlineRail = computed(() => hasReaderOutline.value && !isNarrowOutlineViewport.value)
const shouldShowOutlineCommand = computed(() => hasReaderOutline.value && isNarrowOutlineViewport.value)
const isSystemDarkTheme = shallowRef(false)
const isReducedMotion = shallowRef(false)
const shouldUseDarkCommandScrim = computed(() =>
  readingSettings.state.theme === 'dark'
  || (readingSettings.state.theme === 'system' && isSystemDarkTheme.value),
)
const shouldAnimateCommandScrim = computed(() => !isReducedMotion.value)
const readingPresetList = computed(() => readingSettings.presets.value)
const readingLocalFontList = computed(() => readingSettings.localFonts.value)
const readingLocalFontMessage = computed(() => readingSettings.localFontMessage.value)
const activeReadingPresetName = computed(() => readingSettings.activePresetName.value)
const activeDocumentTitle = computed(() => {
  if (appMode.value === 'library') {
    return '文库'
  }

  if (appMode.value === 'pdf' && activePdfDocument.value) {
    return activePdfDocument.value.entry.title
  }

  return documentState.label === 'miru sample' ? '示例文档' : documentState.label
})

watch(status, (value) => {
  if (value) {
    openSurface('actions')
    liveStatus.value = value
  }
})

watch(isFetchingUrl, (value) => {
  if (value) {
    liveStatus.value = '正在抓取 URL 内容…'
  }
})

watch(openSurfaceId, (value) => {
  setPageScrollLocked(shouldLockPageForSurface(value))
})

watch([hasReaderOutline, isNarrowOutlineViewport], () => {
  if (!shouldShowOutlineCommand.value && openSurfaceId.value === 'outline') {
    closeSurface()
  }
})

onMounted(async () => {
  await loadDefaultReadingFonts()
  await readingSettings.initializeLocalFonts()
  await refreshLibraryEntries()
  outlineViewportMediaQuery = window.matchMedia('(max-width: 1099px)')
  syncOutlineViewport()
  outlineViewportMediaQuery.addEventListener('change', syncOutlineViewport)
  systemDarkThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  syncSystemDarkTheme()
  systemDarkThemeMediaQuery.addEventListener('change', syncSystemDarkTheme)
  reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncReducedMotion()
  reducedMotionMediaQuery.addEventListener('change', syncReducedMotion)
  window.addEventListener('scroll', onWindowScroll, { passive: true })
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onUnmounted(() => {
  window.clearTimeout(positionSaveTimer)
  outlineViewportMediaQuery?.removeEventListener('change', syncOutlineViewport)
  systemDarkThemeMediaQuery?.removeEventListener('change', syncSystemDarkTheme)
  reducedMotionMediaQuery?.removeEventListener('change', syncReducedMotion)
  window.removeEventListener('scroll', onWindowScroll)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  setPageScrollLocked(false)
  void libraryStore.close()
})

function resetToSample(): void {
  loadFromText(sampleMarkdown, 'sample', 'miru sample')
}

async function showLibrary(): Promise<void> {
  closeSurface()
  const currentScrollY = getCurrentScrollY()
  window.clearTimeout(positionSaveTimer)
  await saveActiveReadingPosition({ scrollY: currentScrollY })
  await refreshLibraryEntries()
  appMode.value = 'library'
  libraryStatus.value = ''
  window.scrollTo({ top: 0, behavior: 'auto' })
}

async function showReader(): Promise<void> {
  closeSurface()
  activePdfDocument.value = null
  appMode.value = 'reader'
  await nextTick()
  readerRef.value?.focus()
}

async function returnToActiveDocument(): Promise<void> {
  closeSurface()

  if (activePdfDocument.value) {
    appMode.value = 'pdf'
    await nextTick()
    pdfViewerRef.value?.focus()
    return
  }

  await showReader()
}

function openAddMenu(): void {
  openSurface('actions')
}

function printDocument(): void {
  closeSurface()
  window.print()
}

function toggleSurface(surfaceId: CommandSurfaceId): void {
  if (openSurfaceId.value === surfaceId) {
    closeSurface({ restoreFocus: true, previousSurfaceId: surfaceId })
    return
  }

  openSurface(surfaceId)
}

function openSurface(surfaceId: CommandSurfaceId): void {
  openSurfaceId.value = surfaceId
  setPageScrollLocked(shouldLockPageForSurface(surfaceId))
}

function setActionsSurfaceOpen(value: boolean): void {
  if (value) {
    openSurface('actions')
    return
  }

  closeSurface({ restoreFocus: true, previousSurfaceId: 'actions' })
}

function closeSurface(options: { restoreFocus?: boolean, previousSurfaceId?: CommandSurfaceId | null } = {}): void {
  const previousSurfaceId = options.previousSurfaceId ?? openSurfaceId.value
  openSurfaceId.value = null
  setPageScrollLocked(false)

  if (options.restoreFocus) {
    const trigger = getSurfaceTrigger(previousSurfaceId)
    window.setTimeout(() => trigger?.focus(), 0)
  }
}

function closeOutlineSurface(options: { restoreFocus?: boolean } = {}): void {
  closeSurface({ restoreFocus: options.restoreFocus, previousSurfaceId: 'outline' })
}

function getSurfaceTrigger(surfaceId: CommandSurfaceId | null): HTMLButtonElement | null {
  if (surfaceId === 'actions') {
    return actionsButtonRef.value
  }

  if (surfaceId === 'outline') {
    return outlineButtonRef.value
  }

  if (surfaceId === 'settings') {
    return settingsButtonRef.value
  }

  return null
}

function shouldLockPageForSurface(surfaceId: CommandSurfaceId | null): boolean {
  if (!surfaceId) {
    return false
  }

  if (surfaceId === 'outline') {
    return window.matchMedia('(max-width: 1099px)').matches
  }

  return window.matchMedia('(max-width: 640px)').matches
}

function setPageScrollLocked(isLocked: boolean): void {
  if (isLocked && !pageScrollLock) {
    const body = document.body
    const root = document.documentElement
    const scrollY = window.scrollY

    pageScrollLock = {
      bodyLeft: body.style.left,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyRight: body.style.right,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      htmlOverscrollBehavior: root.style.overscrollBehavior,
      scrollY,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    return
  }

  if (!isLocked && pageScrollLock) {
    const body = document.body
    const root = document.documentElement
    const { scrollY } = pageScrollLock

    body.style.position = pageScrollLock.bodyPosition
    body.style.top = pageScrollLock.bodyTop
    body.style.left = pageScrollLock.bodyLeft
    body.style.right = pageScrollLock.bodyRight
    body.style.width = pageScrollLock.bodyWidth
    body.style.overflow = pageScrollLock.bodyOverflow
    root.style.overscrollBehavior = pageScrollLock.htmlOverscrollBehavior
    pageScrollLock = null
    window.scrollTo({ top: scrollY, behavior: 'auto' })
  }
}

function syncOutlineViewport(): void {
  isNarrowOutlineViewport.value = outlineViewportMediaQuery?.matches ?? false

  if (openSurfaceId.value === 'outline' && !shouldShowOutlineCommand.value) {
    closeSurface()
    return
  }

  setPageScrollLocked(shouldLockPageForSurface(openSurfaceId.value))
}

function syncSystemDarkTheme(): void {
  isSystemDarkTheme.value = systemDarkThemeMediaQuery?.matches ?? false
}

function syncReducedMotion(): void {
  isReducedMotion.value = reducedMotionMediaQuery?.matches ?? false
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!openSurfaceId.value) {
    return
  }

  const target = event.target
  if (!(target instanceof Node)) {
    closeSurface({ restoreFocus: true })
    return
  }

  if (commandSurfaceRef.value?.contains(target) || topBarRef.value?.contains(target)) {
    return
  }

  closeSurface({ restoreFocus: true })
}

function onCommandSurfaceKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSurface({ restoreFocus: true })
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const focusableElements = getCommandSurfaceFocusableElements()
  if (focusableElements.length === 0) {
    return
  }

  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault()
    lastElement?.focus()
  }
  else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault()
    firstElement?.focus()
  }
}

function getCommandSurfaceFocusableElements(): HTMLElement[] {
  return Array.from(commandSurfaceRef.value?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
    .filter(isVisibleFocusableElement)
}

function isVisibleFocusableElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)

  return !element.hasAttribute('disabled')
    && element.getAttribute('aria-hidden') !== 'true'
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && element.getClientRects().length > 0
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
    activePdfDocument.value = null
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
    openSurface('actions')
  }
}

async function loadIncomingPdf(file: File): Promise<void> {
  libraryStatus.value = ''
  inputMenuStatus.value = ''

  try {
    await saveActiveReadingPosition()
    const pdfBlob = file.type === 'application/pdf' ? file : file.slice(0, file.size, 'application/pdf')
    const entry = await libraryStore.addPdfDocument({
      blob: pdfBlob,
      source: {
        kind: 'file',
        fileName: file.name || 'document.pdf',
        mimeType: 'application/pdf',
      },
    })

    await refreshLibraryEntries()
    await openLibraryEntry(entry)
    liveStatus.value = 'PDF 已加入文库'
  }
  catch (reason) {
    if (reason instanceof LibraryQuotaExceededError) {
      libraryStatus.value = '本机存储空间不够, PDF 没有加入文库。可以删除一些文档后再试。'
      inputMenuStatus.value = libraryStatus.value
    }
    else {
      libraryStatus.value = '无法加入 PDF。当前文档没有被替换, 请稍后再试。'
      inputMenuStatus.value = libraryStatus.value
    }

    openSurface('actions')
  }
}

async function openLibraryEntry(entry: LibraryEntry): Promise<void> {
  libraryStatus.value = ''

  if (entry.type === 'pdf') {
    await saveActiveReadingPosition()
    const opened = await libraryStore.openPdfDocument(entry.id)

    if (!opened) {
      libraryStatus.value = '这个 PDF 已经不在文库中。'
      await refreshLibraryEntries()
      return
    }

    activeLibraryEntryId.value = opened.entry.id
    activePdfDocument.value = opened
    appMode.value = 'pdf'
    await refreshLibraryEntries()
    await nextTick()
    pdfViewerRef.value?.focus()
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
  activePdfDocument.value = null
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
    activePdfDocument.value = null
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
  activePdfDocument.value = null
  documentState.source = 'sample'
  documentState.label = 'miru sample'
  documentState.markdown = sampleMarkdown
  await refreshLibraryEntries()
  focusLibraryView()
}

async function savePdfReadingPosition(position: Omit<PdfReadingPosition, 'updatedAt'>): Promise<void> {
  if (activePdfDocument.value?.entry.id !== position.documentId) {
    return
  }

  const saved = await libraryStore.saveReadingPosition(position)
  if (saved.type === 'pdf' && activePdfDocument.value) {
    activePdfDocument.value = {
      ...activePdfDocument.value,
      position: saved,
    }
  }
}

async function refreshLibraryEntries(): Promise<void> {
  libraryEntries.value = await libraryStore.listEntries(librarySortMode.value)
}

async function onDocumentLoaded(source: ReaderDocument['source']): Promise<void> {
  if (source === 'sample') {
    return
  }

  if (openSurfaceId.value) {
    closeSurface()
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
      openSurface('actions')
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
  if (appMode.value !== 'reader' || !activeLibraryEntryId.value || pageScrollLock) {
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
    scrollY: Math.max(0, Math.round(options.scrollY ?? getCurrentScrollY())),
    activeHeadingId: activeOutlineId.value || null,
  })
}

function getCurrentScrollY(): number {
  return pageScrollLock?.scrollY ?? window.scrollY
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
    return entry.title
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
    <header ref="topBar" class="app-shell__header" data-testid="app-top-bar">
      <div class="app-shell__mark">
        <span>miru</span>
        <span class="app-shell__mark-separator" aria-hidden="true">›</span>
        <span class="app-shell__document-title">{{ activeDocumentTitle }}</span>
      </div>
      <button
        class="app-shell__library-button"
        type="button"
        data-testid="library-open-button"
        @click="appMode === 'library' ? returnToActiveDocument() : showLibrary()"
      >
        <span class="app-shell__library-icon" aria-hidden="true" />
        <span>{{ appMode === 'library' ? '返回阅读' : '文库' }}</span>
      </button>
      <div class="app-shell__command-actions" aria-label="阅读命令">
        <button
          v-if="shouldShowOutlineCommand"
          ref="outlineButton"
          class="app-shell__command-button app-shell__command-button--outline"
          :class="{ 'app-shell__command-button--active': isOutlineSurfaceOpen }"
          type="button"
          aria-label="文档大纲"
          :aria-expanded="isOutlineSurfaceOpen"
          aria-controls="reader-outline-panel"
          data-testid="reader-outline-button"
          @click="toggleSurface('outline')"
          @keydown.escape.prevent="closeSurface({ restoreFocus: true })"
        >
          <svg class="app-shell__outline-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M4 5h10M4 9h10M4 13h10" />
          </svg>
        </button>
        <button
          v-if="appMode === 'reader'"
          ref="settingsButton"
          class="app-shell__command-button"
          :class="{ 'app-shell__command-button--active': isSettingsSurfaceOpen }"
          type="button"
          aria-label="阅读设置"
          :aria-expanded="isSettingsSurfaceOpen"
          aria-controls="reading-settings-panel"
          data-testid="reading-settings-button"
          @click="toggleSurface('settings')"
          @keydown.escape.prevent="closeSurface({ restoreFocus: true })"
        >
          <span aria-hidden="true">aA</span>
        </button>
        <button
          ref="actionsButton"
          class="app-shell__command-button"
          :class="{ 'app-shell__command-button--active': isActionsSurfaceOpen }"
          type="button"
          aria-label="文档操作"
          :aria-expanded="isActionsSurfaceOpen"
          aria-controls="floating-input-menu"
          data-testid="floating-affordance-button"
          @click="toggleSurface('actions')"
          @keydown.escape.prevent="closeSurface({ restoreFocus: true })"
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
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
    />

    <PdfViewer
      v-else-if="appMode === 'pdf' && activePdfDocument"
      ref="pdfViewer"
      :entry="activePdfDocument.entry"
      :blob="activePdfDocument.blob"
      :position="activePdfDocument.position"
      @back="showLibrary"
      @position-change="savePdfReadingPosition"
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
        v-if="shouldRenderOutlineRail"
        mode="rail"
        :items="outlineItems"
        :active-id="activeOutlineId"
        :is-open="false"
        :position="readingSettings.state.outlinePosition"
        @navigate="navigateToOutlineItem"
      />

      <BackToTop :is-suppressed="openSurfaceId !== null" />
    </template>

    <p class="app-shell__live-status" role="status" aria-live="polite">
      {{ liveStatus }}
    </p>

    <div
      v-if="openSurfaceId"
      ref="commandSurface"
      class="app-shell__command-surface"
      :class="`app-shell__command-surface--${openSurfaceId}`"
      data-command-surface="true"
      @keydown.capture="onCommandSurfaceKeydown"
    >
      <div
        class="app-shell__command-scrim"
        :class="{
          'app-shell__command-scrim--animated': shouldAnimateCommandScrim,
          'app-shell__command-scrim--dark': shouldUseDarkCommandScrim,
        }"
        aria-hidden="true"
        data-testid="command-scrim"
        @click="closeSurface({ restoreFocus: true })"
      />

      <FloatingInputMenu
        v-if="isActionsSurfaceOpen"
        :is-open="isActionsSurfaceOpen"
        :is-fetching-url="isFetchingUrl"
        :status="status"
        @update:is-open="setActionsSurfaceOpen"
        @paste="loadFromClipboard"
        @open-file="loadFromFile"
        @open-library="showLibrary"
        @fetch-url="loadFromUrl"
        @clear="resetToSample"
        @print="printDocument"
      />

      <ReadingSettingsControl
        v-else-if="isSettingsSurfaceOpen && appMode === 'reader'"
        :is-open="isSettingsSurfaceOpen"
        :settings="readingSettings.state"
        :presets="readingPresetList"
        :local-fonts="readingLocalFontList"
        :local-font-message="readingLocalFontMessage"
        :active-preset-name="activeReadingPresetName"
        :is-default="readingSettings.isDefault.value"
        :show-outline-position-control="outlineItems.length > 0"
        @update-font-size="readingSettings.updateFontSize"
        @update-measure="readingSettings.updateMeasure"
        @update-line-height="readingSettings.updateLineHeight"
        @update-letter-spacing="readingSettings.updateLetterSpacing"
        @update-paragraph-gap="readingSettings.updateParagraphGap"
        @update-page-margin="readingSettings.updatePageMargin"
        @update-font-family="readingSettings.updateFontFamily"
        @update-theme="readingSettings.updateTheme"
        @update-custom-theme="readingSettings.updateCustomTheme"
        @auto-fix-custom-theme="readingSettings.autoFixCustomTheme"
        @save-preset="readingSettings.savePreset"
        @apply-preset="readingSettings.applyPreset"
        @rename-preset="readingSettings.renamePreset"
        @delete-preset="readingSettings.deletePreset"
        @upload-local-font="readingSettings.uploadLocalFont"
        @rename-local-font="readingSettings.renameLocalFont"
        @delete-local-font="readingSettings.deleteLocalFont"
        @update-contrast="readingSettings.updateContrast"
        @update-outline-position="readingSettings.updateOutlinePosition"
        @reset="readingSettings.reset"
        @close="closeSurface({ restoreFocus: true })"
      />

      <ReaderOutlineNavigation
        v-else-if="isOutlineSurfaceOpen && appMode === 'reader'"
        mode="sheet"
        :items="outlineItems"
        :active-id="activeOutlineId"
        :is-open="isOutlineSurfaceOpen"
        :position="readingSettings.state.outlinePosition"
        @navigate="navigateToOutlineItem"
        @close="closeOutlineSurface"
      />
    </div>
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  padding: 1rem var(--reading-page-margin);
  background: var(--reading-bg);
  color: var(--reading-fg);
}

.app-shell--dragging {
  outline: 2px dashed var(--reading-accent);
  outline-offset: -1rem;
}

.app-shell__header {
  position: sticky;
  top: max(0.75rem, env(safe-area-inset-top));
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.55rem;
  max-width: 78rem;
  margin: 0 auto;
  padding: 0.45rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 62%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  box-shadow: 0 12px 34px rgb(0 0 0 / 9%);
  backdrop-filter: blur(16px);
}

.app-shell__mark {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  min-inline-size: 0;
  min-block-size: 44px;
  padding: 0 0.85rem;
  border: 0;
  border-radius: 999px;
  color: var(--reading-fg);
  background: transparent;
  font-family: var(--reading-font-heading);
  font-size: 1rem;
  font-weight: 650;
  text-decoration: none;
}

.app-shell__mark-separator,
.app-shell__document-title {
  color: var(--reading-fg-muted);
  font-family: var(--reading-font-body);
  font-size: 0.86rem;
  font-weight: 500;
}

.app-shell__mark-separator {
  margin-inline: 0.45rem;
}

.app-shell__document-title {
  overflow: hidden;
  max-inline-size: min(40vw, 32rem);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-shell__library-button,
.app-shell__command-button {
  display: inline-grid;
  place-items: center;
  min-inline-size: 44px;
  min-block-size: 44px;
  padding: 0 0.78rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 72%, transparent);
  border-radius: 999px;
  color: var(--reading-fg-muted);
  background: color-mix(in srgb, var(--reading-bg) 92%, var(--reading-fg) 8%);
  font: inherit;
  cursor: pointer;
}

.app-shell__library-button {
  grid-auto-flow: column;
  gap: 0.35rem;
  margin-inline-start: auto;
}

.app-shell__library-icon {
  position: relative;
  inline-size: 1rem;
  block-size: 0.84rem;
  border: 1.5px solid currentColor;
  border-left-width: 3px;
  border-radius: 3px;
}

.app-shell__library-icon::before {
  position: absolute;
  inset-inline: 0.2rem;
  top: 0.28rem;
  block-size: 1.5px;
  background: currentColor;
  content: "";
  opacity: 0.65;
}

.app-shell__outline-icon {
  inline-size: 1.05rem;
  block-size: 1.05rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.7;
}

.app-shell__command-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.35rem;
}

.app-shell__command-button {
  padding: 0;
  font-family: var(--reading-font-heading);
  font-weight: 700;
}

.app-shell__library-button:hover,
.app-shell__library-button:focus-visible,
.app-shell__command-button:hover,
.app-shell__command-button:focus-visible,
.app-shell__command-button--active {
  color: var(--reading-fg);
  border-color: color-mix(in srgb, var(--reading-accent) 54%, transparent);
}

.app-shell__command-button--active {
  background: color-mix(in srgb, var(--reading-accent) 12%, transparent);
}

.app-shell__command-surface {
  position: fixed;
  top: max(4.65rem, calc(env(safe-area-inset-top) + 4.65rem));
  right: max(1rem, calc(env(safe-area-inset-right) + 1rem));
  z-index: 40;
}

.app-shell__command-scrim {
  display: none;
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

@media (max-width: 1099px) {
  .app-shell__command-surface--outline {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
  }

  .app-shell__command-surface--outline .app-shell__command-scrim {
    position: fixed;
    inset-inline: 0;
    inset-block-start: max(4.35rem, calc(env(safe-area-inset-top) + 4.35rem));
    inset-block-end: 0;
    display: block;
    background: rgb(0 0 0 / 28%);
  }
}

@media (max-width: 640px) {
  .app-shell {
    padding-inline: clamp(1rem, 4vw, 1.25rem);
  }

  .app-shell__header {
    top: max(0.5rem, env(safe-area-inset-top));
    gap: 0.35rem;
    padding: 0.35rem;
  }

  .app-shell__library-button span:last-child,
  .app-shell__document-title {
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

  .app-shell__mark {
    flex: 1 1 auto;
    min-inline-size: 0;
    padding-inline: 0.72rem;
  }

  .app-shell__command-surface {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
  }

  .app-shell__command-scrim {
    position: fixed;
    inset-inline: 0;
    inset-block-start: max(4.35rem, calc(env(safe-area-inset-top) + 4.35rem));
    inset-block-end: 0;
    display: block;
    background: rgb(0 0 0 / 28%);
  }
}

.app-shell__command-scrim.app-shell__command-scrim--animated {
  animation: command-scrim-fade 120ms ease-out;
}

.app-shell__command-scrim.app-shell__command-scrim--dark {
  background: rgb(0 0 0 / 40%);
}

@media (prefers-reduced-motion: reduce) {
  .app-shell__command-scrim.app-shell__command-scrim--animated {
    animation: none;
  }
}

@keyframes command-scrim-fade {
  from {
    opacity: 0;
  }
}

</style>
