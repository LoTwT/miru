<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import BackToTop from '@/components/BackToTop.vue'
import FloatingInputMenu from '@/components/FloatingInputMenu.vue'
import ReaderFindBar from '@/components/ReaderFindBar.vue'
import ReaderOutlineNavigation from '@/components/ReaderOutlineNavigation.vue'
import ReaderSurface from '@/components/ReaderSurface.vue'
import sampleMarkdown from '@/content/sample.md?raw'
import { getBareUrlPaste } from '@/features/input/urlInput'
import { useDocumentInput, type DocumentInputOperation } from '@/features/input/useDocumentInput'
import { createLazyLibraryStore, isLibraryQuotaExceededError } from '@/features/library/lazyLibraryStore'
import {
  createReaderBookmark,
  readPersistedReaderBookmarks,
  removeBookmarksForDocument,
  removeLibraryBookmarks,
  writePersistedReaderBookmarks,
  type ReaderBookmark,
} from '@/features/reader/bookmarks'
import { useRenderedMarkdown } from '@/features/reader/useRenderedMarkdown'
import { useReadingSettings } from '@/features/settings/useReadingSettings'
import { loadDefaultReadingFonts } from '@/lib/theme/fonts'
import { readPersistedReadingSettings } from '@/lib/theme/tokens'
import type { LibraryEntry, LibrarySortMode, LibrarySource, MarkdownReadingPosition, PdfReadingLocation } from '@/features/library/types'
import type { ReaderDocument, RemoteImageMode } from '@/types/reader'
import type { ReaderOutlineItem } from '@/features/reader/outlineNavigation'

type AppMode = 'reader' | 'library' | 'pdf'
type CommandSurfaceId = 'actions' | 'outline' | 'settings'

interface PdfViewerHandle {
  clearSearch: (options?: { emitState?: boolean }) => void
  focus: () => void
  goToPage: (page: number) => void
  goToSearchMatch: (delta: number) => void
}

interface ActivePdfDocument {
  blob: Blob
  entry: LibraryEntry
  position: PdfReadingLocation | null
}

interface OperationGuard extends DocumentInputOperation {
  readonly libraryWriteSignal: AbortSignal
  readonly signal: AbortSignal
}

interface OpenLibraryEntryOptions {
  operation?: OperationGuard
  skipSave?: boolean
}

const loadLibraryView = () => import('@/components/LibraryView.vue')
const loadPdfViewer = () => import('@/components/PdfViewer.vue')
const loadReadingSettingsControl = () => import('@/components/ReadingSettingsControl.vue')
const LibraryView = defineAsyncComponent({ loader: loadLibraryView, timeout: 30_000 })
const PdfViewer = defineAsyncComponent({ loader: loadPdfViewer, timeout: 30_000 })
const ReadingSettingsControl = defineAsyncComponent({ loader: loadReadingSettingsControl, timeout: 30_000 })

function preloadLibraryView(): void {
  void loadLibraryView().catch(() => undefined)
}

function preloadReadingSettings(): void {
  void loadReadingSettingsControl().catch(() => undefined)
}

interface PendingUrlImport {
  document: ReaderDocument
  entry: LibraryEntry
}

const documentState = reactive<ReaderDocument>({
  source: 'sample',
  label: 'miru sample',
  markdown: sampleMarkdown,
})
const libraryStore = createLazyLibraryStore()
const appMode = shallowRef<AppMode>('reader')
const libraryEntries = shallowRef<LibraryEntry[]>([])
const librarySortMode = shallowRef<LibrarySortMode>('last-opened')
const activeLibraryEntryId = shallowRef<string | null>(null)
const libraryStatus = shallowRef('')
const inputMenuStatus = shallowRef('')
const pendingUrlImport = shallowRef<PendingUrlImport | null>(null)
const pendingRestorePosition = shallowRef<MarkdownReadingPosition | null>(null)
const activePdfDocument = shallowRef<ActivePdfDocument | null>(null)
const isDragging = shallowRef(false)
const openSurfaceId = shallowRef<CommandSurfaceId | null>(null)
const liveStatus = shallowRef('')
const outlineItems = shallowRef<ReaderOutlineItem[]>([])
const activeOutlineId = shallowRef('')
const readerBookmarks = shallowRef<ReaderBookmark[]>(readPersistedReaderBookmarks())
const isNarrowOutlineViewport = shallowRef(false)
const markdownProgress = shallowRef(0)
const pdfProgress = shallowRef(0)
const isFindBarOpen = shallowRef(false)
const findInput = shallowRef('')
const findQuery = shallowRef('')
const findMatchCount = shallowRef(0)
const activeFindIndex = shallowRef(-1)
const findResultContext = shallowRef('')
const findStatusText = shallowRef('')
const topBarRef = useTemplateRef<HTMLElement>('topBar')
const commandSurfaceRef = useTemplateRef<HTMLElement>('commandSurface')
const actionsButtonRef = useTemplateRef<HTMLButtonElement>('actionsButton')
const outlineButtonRef = useTemplateRef<HTMLButtonElement>('outlineButton')
const settingsButtonRef = useTemplateRef<HTMLButtonElement>('settingsButton')
const findBarRef = useTemplateRef<InstanceType<typeof ReaderFindBar>>('findBar')
const readerRef = useTemplateRef<InstanceType<typeof ReaderSurface>>('reader')
const pdfViewerRef = useTemplateRef<PdfViewerHandle>('pdfViewer')
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
let progressSyncFrame: number | undefined
let findDebounceTimer: ReturnType<typeof setTimeout> | undefined
let documentActivationController: AbortController | null = null
let libraryWriteController = new AbortController()
let libraryRefreshSequence = 0
let libraryRefreshAppliedSequence = 0
let pdfDocumentActivationSequence = 0
let pdfPositionSaveSequence = 0

const {
  cancelPendingOperation: cancelPendingDocumentInput,
  error,
  isFetchingUrl,
  loadFromClipboard,
  loadFromFile,
  loadFromText,
  loadFromUrl,
} = useDocumentInput({
  createOperationGuard: beginInputDocumentActivation,
  onDocument(document, operation) {
    void loadIncomingDocument(document, operation)
  },
  onPdf(file, operation) {
    return loadIncomingPdf(file, operation)
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
const activeBookmarkDocumentKey = computed(() => getActiveBookmarkDocumentKey())
const currentDocumentBookmarks = computed(() =>
  activeBookmarkDocumentKey.value
    ? readerBookmarks.value.filter(bookmark => bookmark.documentKey === activeBookmarkDocumentKey.value)
    : [],
)
const pendingUrlImportConflict = computed(() => {
  const pending = pendingUrlImport.value
  if (!pending) {
    return null
  }

  return {
    title: pending.entry.title,
    domain: pending.entry.source.kind === 'url' ? pending.entry.source.domain : '',
  }
})
const bookmarkedHeadingIds = computed(() =>
  currentDocumentBookmarks.value
    .filter(bookmark => bookmark.kind === 'markdown-heading' && bookmark.target.headingId)
    .map(bookmark => bookmark.target.headingId!),
)
const hasNavigationSurface = computed(() =>
  (appMode.value === 'reader' && (outlineItems.value.length > 0 || currentDocumentBookmarks.value.length > 0))
  || (appMode.value === 'pdf' && currentDocumentBookmarks.value.length > 0),
)
const shouldRenderOutlineRail = computed(() => hasNavigationSurface.value && appMode.value === 'reader' && !isNarrowOutlineViewport.value)
const shouldShowOutlineCommand = computed(() => hasNavigationSurface.value && (appMode.value === 'pdf' || isNarrowOutlineViewport.value))
const isReducedMotion = shallowRef(false)
const shouldUseDarkCommandScrim = computed(() => readingSettings.effectiveColorScheme.value === 'dark')
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
const readingProgress = computed(() => {
  if (appMode.value === 'pdf') {
    return pdfProgress.value
  }

  if (appMode.value === 'reader') {
    return markdownProgress.value
  }

  return 0
})
const readingProgressPercent = computed(() => Math.round(readingProgress.value * 100))
const shouldShowReadingProgress = computed(() => appMode.value === 'reader' || appMode.value === 'pdf')
const isReadingSettingsAvailable = computed(() => appMode.value !== 'pdf')
const readingProgressStyle = computed(() => `${Number((readingProgress.value * 100).toFixed(1))}%`)
const isSearchAvailable = computed(() => appMode.value === 'reader' || appMode.value === 'pdf')
const isBookmarkAvailable = computed(() => appMode.value === 'reader' || appMode.value === 'pdf')
const searchUnavailableText = computed(() => '打开文档后可用')

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

watch([hasNavigationSurface, isNarrowOutlineViewport], () => {
  if (!shouldShowOutlineCommand.value && openSurfaceId.value === 'outline') {
    closeSurface()
  }
})

watch(appMode, (value, previousValue) => {
  if (value === 'library' || (previousValue && value !== previousValue)) {
    closeFindBar({ restoreFocus: false })
  }
})

onMounted(() => {
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
  window.addEventListener('resize', onWindowResize, { passive: true })
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)

  void loadDefaultReadingFonts().catch(() => undefined)
  if (readingSettings.hasActiveLocalFont.value) {
    void readingSettings.initializeLocalFonts().catch(() => undefined)
  }
  queueMarkdownProgressUpdate()
})

onUnmounted(() => {
  invalidatePendingLibraryWrites()
  invalidatePendingDocumentActivation()
  window.clearTimeout(positionSaveTimer)
  if (progressSyncFrame !== undefined) {
    window.cancelAnimationFrame(progressSyncFrame)
  }
  outlineViewportMediaQuery?.removeEventListener('change', syncOutlineViewport)
  systemDarkThemeMediaQuery?.removeEventListener('change', syncSystemDarkTheme)
  reducedMotionMediaQuery?.removeEventListener('change', syncReducedMotion)
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
  window.clearTimeout(findDebounceTimer)
  setPageScrollLocked(false)
  void libraryStore.close()
})

function resetToSample(): void {
  closeSurface()
  closeFindBar({ restoreFocus: false })
  loadFromText(sampleMarkdown, 'sample', 'miru sample')
}

async function showLibrary(): Promise<void> {
  const operation = beginDocumentActivation()
  preloadLibraryView()
  closeSurface()
  closeFindBar({ restoreFocus: false })
  const currentScrollY = getCurrentScrollY()
  window.clearTimeout(positionSaveTimer)
  await saveActiveReadingPosition({ scrollY: currentScrollY })
  if (!operation.isCurrent()) {
    return
  }

  await refreshLibraryEntries(operation)
  if (!operation.isCurrent()) {
    return
  }

  appMode.value = 'library'
  libraryStatus.value = ''
  window.scrollTo({ top: 0, behavior: 'auto' })
}

async function showReader(operation?: OperationGuard): Promise<void> {
  closeSurface()
  activePdfDocument.value = null
  appMode.value = 'reader'
  await nextTick()
  if (operation && !operation.isCurrent()) {
    return
  }

  readerRef.value?.focus()
}

async function returnToActiveDocument(): Promise<void> {
  const operation = beginDocumentActivation()
  closeSurface()

  const pdfDocument = activePdfDocument.value
  if (pdfDocument) {
    activatePdfDocument(pdfDocument)
    appMode.value = 'pdf'
    await focusPdfViewerWhenReady(operation)
    return
  }

  await showReader(operation)
}

function openAddMenu(): void {
  invalidatePendingDocumentActivation()
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
  if (surfaceId === 'settings') {
    preloadReadingSettings()
    void readingSettings.initializeLocalFonts().catch(() => undefined)
  }
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

  if (previousSurfaceId === 'actions') {
    pendingUrlImport.value = null
  }

  if (options.restoreFocus) {
    const trigger = getSurfaceTrigger(previousSurfaceId)
    window.setTimeout(() => trigger?.focus(), 0)
  }
}

function closeOutlineSurface(options: { restoreFocus?: boolean } = {}): void {
  closeSurface({ restoreFocus: options.restoreFocus, previousSurfaceId: 'outline' })
}

function openFindBar(): void {
  if (!isSearchAvailable.value) {
    liveStatus.value = searchUnavailableText.value
    return
  }

  closeSurface()
  isFindBarOpen.value = true
  void nextTick(() => findBarRef.value?.focusInput())
}

function closeFindBar(options: { restoreFocus?: boolean } = {}): void {
  window.clearTimeout(findDebounceTimer)
  isFindBarOpen.value = false
  findInput.value = ''
  findQuery.value = ''
  findMatchCount.value = 0
  activeFindIndex.value = -1
  findResultContext.value = ''
  findStatusText.value = ''
  readerRef.value?.clearSearch()
  pdfViewerRef.value?.clearSearch()

  if (options.restoreFocus !== false) {
    void nextTick(() => focusActiveReadingSurface())
  }
}

function updateFindInput(value: string): void {
  findInput.value = value
  window.clearTimeout(findDebounceTimer)
  findDebounceTimer = window.setTimeout(() => {
    findQuery.value = value
  }, 140)
}

function goToNextSearchMatch(): void {
  if (appMode.value === 'pdf') {
    pdfViewerRef.value?.goToSearchMatch(1)
    return
  }

  readerRef.value?.goToSearchMatch(1)
}

function goToPreviousSearchMatch(): void {
  if (appMode.value === 'pdf') {
    pdfViewerRef.value?.goToSearchMatch(-1)
    return
  }

  readerRef.value?.goToSearchMatch(-1)
}

function updateSearchState(state: { activeIndex: number, announcement?: string, resultContext?: string, statusText?: string, total: number }): void {
  activeFindIndex.value = state.activeIndex
  findMatchCount.value = state.total
  findResultContext.value = state.resultContext ?? ''
  findStatusText.value = state.statusText ?? ''

  if (!findQuery.value.trim()) {
    return
  }

  if (state.announcement) {
    liveStatus.value = state.announcement
    return
  }

  if (state.statusText) {
    liveStatus.value = state.statusText
    return
  }

  liveStatus.value = state.total === 0
    ? '无匹配'
    : `第 ${state.activeIndex + 1} 个, 共 ${state.total} 个`
}

function focusActiveReadingSurface(): void {
  if (appMode.value === 'pdf') {
    pdfViewerRef.value?.focus()
    return
  }

  readerRef.value?.focus()
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
  readingSettings.syncSystemColorScheme(systemDarkThemeMediaQuery?.matches ?? false)
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

function onDocumentKeydown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase()

  if ((event.metaKey || event.ctrlKey) && !event.altKey && key === 'f') {
    if (isEditableSearchShortcutTarget(event.target)) {
      return
    }

    if (isSearchAvailable.value) {
      event.preventDefault()
      openFindBar()
    }
    return
  }

  if (event.key === 'Escape' && isFindBarOpen.value && !openSurfaceId.value) {
    event.preventDefault()
    closeFindBar()
  }
}

function isEditableSearchShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  if (target.closest('[data-testid="reader-find-bar"]')) {
    return false
  }

  return target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null
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

function navigateToBookmark(id: string): void {
  const bookmark = currentDocumentBookmarks.value.find(item => item.id === id)
  if (!bookmark) {
    return
  }

  if (bookmark.kind === 'pdf-page') {
    const pageNumber = bookmark.target.pageNumber ?? 1
    closeOutlineSurface({ restoreFocus: true })
    pdfViewerRef.value?.goToPage(pageNumber)
    pdfViewerRef.value?.focus()
    return
  }

  closeOutlineSurface({ restoreFocus: true })
  if (bookmark.kind === 'markdown-heading' && bookmark.target.headingId) {
    void readerRef.value?.scrollToHeading(bookmark.target.headingId)
    return
  }

  window.scrollTo({
    top: Math.max(0, bookmark.target.scrollY ?? 0),
    behavior: isReducedMotion.value ? 'auto' : 'smooth',
  })
  readerRef.value?.focus()
}

function toggleHeadingBookmark(item: ReaderOutlineItem): void {
  const documentKey = activeBookmarkDocumentKey.value
  if (!documentKey) {
    return
  }

  const existing = currentDocumentBookmarks.value.find(bookmark =>
    bookmark.kind === 'markdown-heading' && bookmark.target.headingId === item.id,
  )
  if (existing) {
    removeBookmark(existing.id)
    return
  }

  const persisted = persistReaderBookmarks([
    ...readerBookmarks.value,
    createReaderBookmark({
      documentKey,
      documentTitle: activeDocumentTitle.value,
      kind: 'markdown-heading',
      label: item.title,
      target: { headingId: item.id },
    }),
  ])
  if (persisted) {
    liveStatus.value = `已添加「${item.title}」书签`
  }
}

function bookmarkCurrentPosition(): void {
  const documentKey = activeBookmarkDocumentKey.value
  if (!documentKey) {
    return
  }

  if (appMode.value === 'pdf' && activePdfDocument.value) {
    const pageNumber = activePdfDocument.value.position?.pageNumber ?? 1
    const existing = currentDocumentBookmarks.value.find(bookmark =>
      bookmark.kind === 'pdf-page' && bookmark.target.pageNumber === pageNumber,
    )

    if (existing) {
      removeBookmark(existing.id)
      return
    }

    const persisted = persistReaderBookmarks([
      ...readerBookmarks.value,
      createReaderBookmark({
        documentKey,
        documentTitle: activeDocumentTitle.value,
        kind: 'pdf-page',
        label: `第 ${pageNumber} 页`,
        target: { pageNumber },
      }),
    ])
    if (persisted) {
      liveStatus.value = `已添加第 ${pageNumber} 页书签`
    }
    return
  }

  const label = readerRef.value?.getBookmarkSnippet() ?? '当前位置'
  const persisted = persistReaderBookmarks([
    ...readerBookmarks.value,
    createReaderBookmark({
      documentKey,
      documentTitle: activeDocumentTitle.value,
      kind: 'markdown-position',
      label,
      target: {
        headingId: activeOutlineId.value || undefined,
        scrollY: Math.max(0, Math.round(getCurrentScrollY())),
      },
    }),
  ])
  if (persisted) {
    liveStatus.value = `已添加「${label}」书签`
  }
}

function removeBookmark(id: string): void {
  const bookmark = readerBookmarks.value.find(item => item.id === id)
  const persisted = persistReaderBookmarks(readerBookmarks.value.filter(item => item.id !== id))

  if (bookmark && persisted) {
    liveStatus.value = `已删除「${bookmark.label}」书签`
  }
}

function persistReaderBookmarks(bookmarks: ReaderBookmark[]): boolean {
  readerBookmarks.value = bookmarks
  try {
    writePersistedReaderBookmarks(bookmarks)
    return true
  }
  catch {
    liveStatus.value = '书签变更暂时无法保存到本机。'
    return false
  }
}

function getActiveBookmarkDocumentKey(): string | null {
  if (appMode.value === 'reader') {
    if (activeLibraryEntryId.value) {
      return libraryBookmarkKey(activeLibraryEntryId.value)
    }

    return documentState.source === 'sample' ? 'sample' : null
  }

  if (appMode.value === 'pdf' && activePdfDocument.value) {
    return libraryBookmarkKey(activePdfDocument.value.entry.id)
  }

  return null
}

function libraryBookmarkKey(id: string): string {
  return `library:${id}`
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

async function loadIncomingDocument(document: ReaderDocument, operation: DocumentInputOperation): Promise<void> {
  if (!operation.isCurrent()) {
    return
  }

  libraryStatus.value = ''
  inputMenuStatus.value = ''
  pendingUrlImport.value = null
  closeFindBar({ restoreFocus: false })

  if (document.source === 'sample') {
    activeLibraryEntryId.value = null
    activePdfDocument.value = null
    documentState.source = document.source
    documentState.label = document.label
    documentState.markdown = document.markdown
    appMode.value = 'reader'
    await onDocumentLoaded(document.source, operation)
    return
  }

  try {
    const source = document.librarySource ?? createFallbackLibrarySource(document)
    const existingUrlEntry = source.kind === 'url'
      ? await libraryStore.findMarkdownEntryByUrl(source)
      : null

    if (!operation.isCurrent()) {
      return
    }

    if (existingUrlEntry) {
      pendingUrlImport.value = {
        document,
        entry: existingUrlEntry,
      }
      inputMenuStatus.value = ''
      liveStatus.value = '该链接已在文库中'
      openSurface('actions')
      return
    }

    await saveActiveReadingPosition()
    if (!operation.isCurrent()) {
      return
    }

    const entry = await libraryStore.addMarkdownDocument({
      markdown: document.markdown,
      source,
      label: document.label,
    }, {
      markOpened: false,
      signal: operation.libraryWriteSignal,
    })
    if (!operation.isCurrent()) {
      await refreshLibraryEntries()
      return
    }

    await activateNewMarkdownEntry(entry, document.markdown, operation)
  }
  catch (reason) {
    if (!operation.isCurrent()) {
      return
    }

    if (isLibraryQuotaExceededError(reason)) {
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

async function openPendingUrlImport(): Promise<void> {
  const pending = pendingUrlImport.value
  if (!pending) {
    return
  }

  const operation = beginDocumentActivation()
  pendingUrlImport.value = null
  closeSurface()
  const opened = await openLibraryEntry(pending.entry, { operation })
  if (opened) {
    liveStatus.value = '已打开文库中的已有文档'
  }
}

async function updatePendingUrlImport(): Promise<void> {
  const pending = pendingUrlImport.value
  if (!pending) {
    return
  }

  const operation = beginDocumentActivation()
  pendingUrlImport.value = null
  const source = pending.document.librarySource ?? createFallbackLibrarySource(pending.document)

  if (source.kind !== 'url') {
    return
  }

  try {
    closeSurface()

    if (activeLibraryEntryId.value && activeLibraryEntryId.value !== pending.entry.id) {
      await saveActiveReadingPosition()
      if (!operation.isCurrent()) {
        return
      }
    }

    const contentChanged = await libraryStore.isMarkdownContentChanged(pending.entry.id, pending.document.markdown)
    if (!operation.isCurrent()) {
      return
    }

    const updated = await libraryStore.addMarkdownDocument({
      markdown: pending.document.markdown,
      source,
      label: pending.document.label,
    }, {
      markOpened: false,
      signal: operation.signal,
    })

    const bookmarksPersisted = !contentChanged || persistReaderBookmarks(
      removeBookmarksForDocument(readerBookmarks.value, libraryBookmarkKey(updated.id)),
    )

    if (!operation.isCurrent()) {
      return
    }

    await refreshLibraryEntries(operation)
    if (!operation.isCurrent()) {
      return
    }

    const opened = await openLibraryEntry(updated, {
      operation,
      skipSave: contentChanged && activeLibraryEntryId.value === updated.id,
    })

    if (opened) {
      liveStatus.value = !bookmarksPersisted
        ? '内容已更新，但书签变更暂时无法保存到本机。'
        : contentChanged
          ? '已更新到最新, 阅读位置和书签已重置'
          : '内容没有变化, 已打开已有文档'
    }
  }
  catch (reason) {
    if (!operation.isCurrent()) {
      return
    }

    if (isLibraryQuotaExceededError(reason)) {
      inputMenuStatus.value = '本机存储空间不够, 没有更新文库。可以删除一些文档后再试。'
    }
    else {
      inputMenuStatus.value = '无法更新文库。已有文档已保留, 请稍后再试。'
    }
    openSurface('actions')
  }
}

async function loadIncomingPdf(file: File, operation: DocumentInputOperation): Promise<void> {
  if (!operation.isCurrent()) {
    return
  }

  libraryStatus.value = ''
  inputMenuStatus.value = ''
  closeFindBar({ restoreFocus: false })

  try {
    await saveActiveReadingPosition()
    if (!operation.isCurrent()) {
      return
    }

    const pdfBlob = file.type === 'application/pdf' ? file : file.slice(0, file.size, 'application/pdf')
    const entry = await libraryStore.addPdfDocument({
      blob: pdfBlob,
      source: {
        kind: 'file',
        fileName: file.name || 'document.pdf',
        mimeType: 'application/pdf',
      },
    }, {
      markOpened: false,
      signal: operation.libraryWriteSignal,
    })

    if (!operation.isCurrent()) {
      await refreshLibraryEntries()
      return
    }

    await activateNewPdfEntry(entry, pdfBlob, operation)
    if (!operation.isCurrent()) {
      return
    }

    liveStatus.value = 'PDF 已加入文库'
  }
  catch (reason) {
    if (!operation.isCurrent()) {
      return
    }

    if (isLibraryQuotaExceededError(reason)) {
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

async function activateNewMarkdownEntry(
  entry: LibraryEntry,
  markdown: string,
  operation: DocumentInputOperation,
): Promise<void> {
  if (!operation.isCurrent()) {
    return
  }

  const markedEntry = await markImportedLibraryEntryOpened(entry, operation)
  if (!operation.isCurrent() || !markedEntry) {
    return
  }

  activeLibraryEntryId.value = markedEntry.id
  activePdfDocument.value = null
  documentState.source = readerSourceFromLibrarySource(markedEntry.source)
  documentState.label = labelForEntry(markedEntry)
  documentState.markdown = markdown
  pendingRestorePosition.value = null
  appMode.value = 'reader'

  await refreshLibraryEntries(operation)
  if (!operation.isCurrent()) {
    return
  }

  await onDocumentLoaded(documentState.source, operation)
}

async function activateNewPdfEntry(
  entry: LibraryEntry,
  blob: Blob,
  operation: DocumentInputOperation,
): Promise<void> {
  if (!operation.isCurrent()) {
    return
  }

  const markedEntry = await markImportedLibraryEntryOpened(entry, operation)
  if (!operation.isCurrent() || !markedEntry) {
    return
  }

  activeLibraryEntryId.value = markedEntry.id
  activatePdfDocument({
    entry: markedEntry,
    blob,
    position: null,
  })
  pendingRestorePosition.value = null
  appMode.value = 'pdf'

  await refreshLibraryEntries(operation)
  if (!operation.isCurrent()) {
    return
  }

  await focusPdfViewerWhenReady(operation)
}

async function openLibraryEntry(entry: LibraryEntry, options: OpenLibraryEntryOptions = {}): Promise<boolean> {
  const operation = options.operation ?? beginDocumentActivation()
  if (!operation.isCurrent()) {
    return false
  }

  libraryStatus.value = ''
  closeFindBar({ restoreFocus: false })

  if (entry.type === 'pdf') {
    if (!options.skipSave) {
      await saveActiveReadingPosition()
      if (!operation.isCurrent()) {
        return false
      }
    }
    const opened = await libraryStore.openPdfDocument(entry.id, { markOpened: false })

    if (!operation.isCurrent()) {
      return false
    }

    if (!opened) {
      libraryStatus.value = '这个 PDF 已经不在文库中。'
      await refreshLibraryEntries(operation)
      return false
    }

    const markedEntry = await markLibraryEntryOpened(opened.entry.id, operation)
    if (!operation.isCurrent()) {
      return false
    }

    if (!markedEntry) {
      libraryStatus.value = '这个 PDF 已经不在文库中。'
      await refreshLibraryEntries(operation)
      return false
    }

    activeLibraryEntryId.value = markedEntry.id
    activatePdfDocument({
      ...opened,
      entry: markedEntry,
    })
    appMode.value = 'pdf'

    await focusPdfViewerWhenReady(operation)
    if (!operation.isCurrent()) {
      return false
    }

    await refreshLibraryEntries(operation)
    return operation.isCurrent()
  }

  if (!options.skipSave) {
    await saveActiveReadingPosition()
    if (!operation.isCurrent()) {
      return false
    }
  }
  const opened = await libraryStore.openMarkdownDocument(entry.id, { markOpened: false })

  if (!operation.isCurrent()) {
    return false
  }

  if (!opened) {
    libraryStatus.value = '这篇文档已经不在文库中。'
    await refreshLibraryEntries(operation)
    return false
  }

  const markedEntry = await markLibraryEntryOpened(opened.entry.id, operation)
  if (!operation.isCurrent()) {
    return false
  }

  if (!markedEntry) {
    libraryStatus.value = '这篇文档已经不在文库中。'
    await refreshLibraryEntries(operation)
    return false
  }

  activeLibraryEntryId.value = markedEntry.id
  activePdfDocument.value = null
  documentState.source = readerSourceFromLibrarySource(markedEntry.source)
  documentState.label = labelForEntry(markedEntry)
  documentState.markdown = opened.markdown
  appMode.value = 'reader'
  pendingRestorePosition.value = opened.position

  await onDocumentLoaded(documentState.source, operation)
  if (!operation.isCurrent()) {
    return false
  }

  restorePendingPositionIfReady()
  await refreshLibraryEntries(operation)
  return operation.isCurrent()
}

async function markLibraryEntryOpened(
  id: string,
  operation: DocumentInputOperation,
): Promise<LibraryEntry | null> {
  try {
    return await libraryStore.markOpened(id, { signal: operation.signal })
  }
  catch (reason) {
    if (!operation.isCurrent()) {
      return null
    }

    throw reason
  }
}

async function markImportedLibraryEntryOpened(
  entry: LibraryEntry,
  operation: DocumentInputOperation,
): Promise<LibraryEntry | null> {
  try {
    return await libraryStore.markOpened(entry.id, { signal: operation.signal })
  }
  catch {
    if (!operation.isCurrent()) {
      return null
    }

    liveStatus.value = '文档已加入文库，但最近打开时间暂时无法更新。'
    return entry
  }
}

function beginInputDocumentActivation(): OperationGuard {
  return beginDocumentActivation({ cancelInput: false })
}

function beginDocumentActivation(options: { cancelInput?: boolean } = {}): OperationGuard {
  if (options.cancelInput !== false) {
    cancelPendingDocumentInput()
  }

  documentActivationController?.abort()
  const controller = new AbortController()
  documentActivationController = controller
  return {
    isCurrent: () => !controller.signal.aborted && documentActivationController === controller,
    libraryWriteSignal: libraryWriteController.signal,
    signal: controller.signal,
  }
}

function invalidatePendingDocumentActivation(): void {
  cancelPendingDocumentInput()
  documentActivationController?.abort()
  documentActivationController = null
}

function invalidatePendingLibraryWrites(): void {
  libraryWriteController.abort()
  libraryWriteController = new AbortController()
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
  const operation = beginDocumentActivation()
  await libraryStore.deleteEntry(entry.id)
  persistReaderBookmarks(removeBookmarksForDocument(readerBookmarks.value, libraryBookmarkKey(entry.id)))

  if (activeLibraryEntryId.value === entry.id) {
    activeLibraryEntryId.value = null
    activePdfDocument.value = null
    documentState.source = 'sample'
    documentState.label = 'miru sample'
    documentState.markdown = sampleMarkdown
    if (!operation.isCurrent() && appMode.value !== 'library') {
      appMode.value = 'reader'
    }
  }

  await refreshLibraryEntries()
  if (operation.isCurrent()) {
    focusLibraryView()
  }
}

async function clearLibrary(): Promise<void> {
  const activeEntryIdAtClear = activeLibraryEntryId.value
  invalidatePendingLibraryWrites()
  const operation = beginDocumentActivation()
  await libraryStore.clearLibrary()
  persistReaderBookmarks(removeLibraryBookmarks(readerBookmarks.value))
  if (operation.isCurrent() || activeLibraryEntryId.value === activeEntryIdAtClear) {
    activeLibraryEntryId.value = null
    activePdfDocument.value = null
    documentState.source = 'sample'
    documentState.label = 'miru sample'
    documentState.markdown = sampleMarkdown
    if (!operation.isCurrent() && appMode.value !== 'library') {
      appMode.value = 'reader'
    }
  }

  await refreshLibraryEntries()
  if (operation.isCurrent()) {
    focusLibraryView()
  }
}

async function savePdfReadingPosition(position: PdfReadingLocation): Promise<void> {
  const pdfDocument = activePdfDocument.value
  if (pdfDocument?.entry.id !== position.documentId) {
    return
  }

  const activationSequence = pdfDocumentActivationSequence
  const saveSequence = ++pdfPositionSaveSequence
  activePdfDocument.value = {
    ...pdfDocument,
    position,
  }

  const saved = await libraryStore.saveReadingPosition(position)
  if (
    !saved
    || saved.type !== 'pdf'
    || saved.documentId !== position.documentId
    || activationSequence !== pdfDocumentActivationSequence
    || saveSequence !== pdfPositionSaveSequence
    || activePdfDocument.value?.entry.id !== position.documentId
  ) {
    return
  }

  activePdfDocument.value = {
    ...activePdfDocument.value,
    position: saved,
  }
}

function activatePdfDocument(document: ActivePdfDocument): void {
  pdfDocumentActivationSequence += 1
  activePdfDocument.value = document
}

function updatePdfProgress(progress: number): void {
  pdfProgress.value = clampProgress(progress)
}

async function refreshLibraryEntries(operation?: DocumentInputOperation): Promise<void> {
  const sequence = ++libraryRefreshSequence
  const entries = await libraryStore.listEntries(librarySortMode.value)
  if ((operation && !operation.isCurrent()) || sequence < libraryRefreshAppliedSequence) {
    return
  }

  libraryRefreshAppliedSequence = sequence
  libraryEntries.value = entries
}

async function onDocumentLoaded(
  source: ReaderDocument['source'],
  operation?: DocumentInputOperation,
): Promise<void> {
  if (source === 'sample') {
    return
  }

  if (operation && !operation.isCurrent()) {
    return
  }

  if (openSurfaceId.value) {
    closeSurface()
  }

  liveStatus.value = '文档已加载'

  await nextTick()
  if (operation && !operation.isCurrent()) {
    return
  }

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
  if (appMode.value === 'reader') {
    updateMarkdownProgress()
  }

  if (appMode.value !== 'reader' || !activeLibraryEntryId.value || pageScrollLock) {
    return
  }

  window.clearTimeout(positionSaveTimer)
  positionSaveTimer = window.setTimeout(() => {
    void saveActiveReadingPosition()
  }, 450)
}

function onWindowResize(): void {
  queueMarkdownProgressUpdate()
}

function queueMarkdownProgressUpdate(): void {
  if (progressSyncFrame !== undefined) {
    window.cancelAnimationFrame(progressSyncFrame)
  }

  progressSyncFrame = window.requestAnimationFrame(() => {
    progressSyncFrame = undefined
    updateMarkdownProgress()
  })
}

function updateMarkdownProgress(): void {
  if (appMode.value !== 'reader') {
    return
  }

  markdownProgress.value = getWindowScrollProgress()
}

function getWindowScrollProgress(): number {
  const scrollElement = document.scrollingElement ?? document.documentElement
  const maxScrollY = scrollElement.scrollHeight - window.innerHeight

  if (maxScrollY <= 1) {
    return 1
  }

  return clampProgress(getCurrentScrollY() / maxScrollY)
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, value))
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
      updateMarkdownProgress()
    })
  })
}

watch(() => rendered.isRendering.value, (value) => {
  restorePendingPositionIfReady()

  if (!value) {
    queueMarkdownProgressUpdate()
  }
})

watch(appMode, () => {
  if (appMode.value !== 'pdf') {
    pdfProgress.value = 0
  }

  queueMarkdownProgressUpdate()
})

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

async function focusPdfViewerWhenReady(operation?: DocumentInputOperation): Promise<void> {
  if (operation && !operation.isCurrent()) {
    return
  }

  try {
    await loadPdfViewer()
  }
  catch {
    if (operation && !operation.isCurrent()) {
      return
    }

    liveStatus.value = 'PDF 阅读器暂时无法加载，请重试。'
    return
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await nextTick()
    if (operation && !operation.isCurrent()) {
      return
    }

    if (pdfViewerRef.value) {
      pdfViewerRef.value.focus()
      return
    }

    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    if (operation && !operation.isCurrent()) {
      return
    }
  }
}
</script>

<template>
  <main
    class="app-shell"
    :class="{
      'app-shell--dragging': isDragging,
      'app-shell--library': appMode === 'library',
    }"
    @paste="onPaste"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      v-if="shouldShowReadingProgress"
      class="app-shell__reading-progress"
      aria-label="阅读进度"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="readingProgressPercent"
      role="progressbar"
      data-testid="reading-progress-line"
    >
      <span
        class="app-shell__reading-progress-fill"
        :class="{ 'app-shell__reading-progress-fill--motionless': isReducedMotion }"
        data-testid="reading-progress-fill"
        :style="{ inlineSize: readingProgressStyle }"
      />
    </div>

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
          aria-label="文档大纲与书签"
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
          v-if="isReadingSettingsAvailable"
          ref="settingsButton"
          class="app-shell__command-button"
          :class="{ 'app-shell__command-button--active': isSettingsSurfaceOpen }"
          type="button"
          aria-label="阅读设置"
          :aria-expanded="isSettingsSurfaceOpen"
          aria-controls="reading-settings-panel"
          data-testid="reading-settings-button"
          @pointerenter="preloadReadingSettings"
          @focus="preloadReadingSettings"
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

    <ReaderFindBar
      ref="findBar"
      :is-open="isFindBarOpen"
      :model-value="findInput"
      :match-count="findMatchCount"
      :active-index="activeFindIndex"
      :result-context="findResultContext"
      :status-text="findStatusText"
      @update:model-value="updateFindInput"
      @next="goToNextSearchMatch"
      @previous="goToPreviousSearchMatch"
      @close="closeFindBar"
    />

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
      @sample="resetToSample"
    />

    <PdfViewer
      v-else-if="appMode === 'pdf' && activePdfDocument"
      ref="pdfViewer"
      :entry="activePdfDocument.entry"
      :blob="activePdfDocument.blob"
      :position="activePdfDocument.position"
      :search-query="findQuery"
      @back="showLibrary"
      @position-change="savePdfReadingPosition"
      @progress-change="updatePdfProgress"
      @search-change="updateSearchState"
    />

    <template v-else>
      <ReaderSurface
        ref="reader"
        :document="documentState"
        :html="rendered.html.value"
        :is-rendering="rendered.isRendering.value"
        :search-query="findQuery"
        @outline-change="updateOutlineItems"
        @active-heading-change="updateActiveOutlineId"
        @search-change="updateSearchState"
      />

      <ReaderOutlineNavigation
        v-if="shouldRenderOutlineRail"
        mode="rail"
        :items="outlineItems"
        :active-id="activeOutlineId"
        :bookmarked-heading-ids="bookmarkedHeadingIds"
        :bookmarks="currentDocumentBookmarks"
        :is-open="false"
        :position="readingSettings.state.outlinePosition"
        @navigate="navigateToOutlineItem"
        @navigate-bookmark="navigateToBookmark"
        @remove-bookmark="removeBookmark"
        @toggle-heading-bookmark="toggleHeadingBookmark"
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
        :can-bookmark="isBookmarkAvailable"
        :can-search="isSearchAvailable"
        :url-conflict="pendingUrlImportConflict"
        :search-unavailable-text="searchUnavailableText"
        :status="status"
        @update:is-open="setActionsSurfaceOpen"
        @bookmark="bookmarkCurrentPosition"
        @paste="loadFromClipboard"
        @open-file="loadFromFile"
        @open-library="showLibrary"
        @fetch-url="loadFromUrl"
        @open-existing-url="openPendingUrlImport"
        @update-existing-url="updatePendingUrlImport"
        @search="openFindBar"
        @clear="resetToSample"
        @print="printDocument"
      />

      <ReadingSettingsControl
        v-else-if="isSettingsSurfaceOpen && isReadingSettingsAvailable"
        :is-open="isSettingsSurfaceOpen"
        :settings="readingSettings.state"
        :presets="readingPresetList"
        :local-fonts="readingLocalFontList"
        :local-font-message="readingLocalFontMessage"
        :active-preset-name="activeReadingPresetName"
        :is-default="readingSettings.isDefault.value"
        :show-outline-position-control="appMode === 'reader' && outlineItems.length > 0"
        @update-font-size="readingSettings.updateFontSize"
        @update-measure="readingSettings.updateMeasure"
        @update-line-height="readingSettings.updateLineHeight"
        @update-letter-spacing="readingSettings.updateLetterSpacing"
        @update-paragraph-gap="readingSettings.updateParagraphGap"
        @update-page-margin="readingSettings.updatePageMargin"
        @update-font-family="readingSettings.updateFontFamily"
        @update-theme-style="readingSettings.updateThemeStyle"
        @update-color-scheme="readingSettings.updateColorScheme"
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
        v-else-if="isOutlineSurfaceOpen && hasNavigationSurface"
        mode="sheet"
        :items="appMode === 'reader' ? outlineItems : []"
        :active-id="appMode === 'reader' ? activeOutlineId : ''"
        :bookmarked-heading-ids="bookmarkedHeadingIds"
        :bookmarks="currentDocumentBookmarks"
        :is-open="isOutlineSurfaceOpen"
        :position="readingSettings.state.outlinePosition"
        @navigate="navigateToOutlineItem"
        @navigate-bookmark="navigateToBookmark"
        @remove-bookmark="removeBookmark"
        @toggle-heading-bookmark="toggleHeadingBookmark"
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

.app-shell--library {
  background: var(--surface-canvas);
  color: var(--text-primary);
}

.app-shell__reading-progress {
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: var(--z-toast);
  block-size: var(--border-width-thick);
  pointer-events: none;
}

.app-shell__reading-progress-fill {
  display: block;
  block-size: 100%;
  background: var(--reading-accent);
  opacity: var(--opacity-emphasis);
  transition: inline-size var(--duration-fast) var(--ease-out-soft);
}

.app-shell__reading-progress-fill--motionless {
  transition: none;
}

.app-shell__header {
  position: sticky;
  top: max(var(--spacing-3), env(safe-area-inset-top));
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--spacing-2);
  min-block-size: var(--size-control-xl);
  max-width: var(--container-wide);
  margin: 0 auto;
  padding: var(--spacing-2);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  box-shadow: var(--shadow-panel);
  transition: var(--transition-surface);
}

.app-shell__mark {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  min-inline-size: 0;
  min-block-size: var(--touch-target-min);
  padding: 0 var(--spacing-3);
  border: 0;
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: transparent;
  font-family: var(--reading-font-heading);
  font-size: 1rem;
  font-weight: 650;
  line-height: 1;
  text-decoration: none;
}

.app-shell__mark-separator,
.app-shell__document-title {
  color: var(--text-secondary);
  font-family: var(--reading-font-body);
  font-size: 0.86rem;
  font-weight: 500;
}

.app-shell__mark-separator {
  display: grid;
  place-items: center;
  margin-inline: 0.45rem;
  line-height: 1;
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
  min-inline-size: var(--touch-target-min);
  min-block-size: var(--touch-target-min);
  padding: 0 var(--spacing-3);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  background: var(--surface-elevated);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
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
  border-radius: var(--radius-sm);
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
  color: var(--text-primary);
  border-color: var(--accent-primary);
}

.app-shell__command-button--active {
  background: var(--accent-soft);
}

.app-shell__command-surface {
  position: fixed;
  top: max(4.65rem, calc(env(safe-area-inset-top) + 4.65rem));
  right: max(1rem, calc(env(safe-area-inset-right) + 1rem));
  z-index: var(--z-popover);
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
