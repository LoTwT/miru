<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { VirtualItem } from '@tanstack/vue-virtual'
import { computed, nextTick, onMounted, onUnmounted, shallowRef, triggerRef, useTemplateRef, watch } from 'vue'

import PdfViewerToolbar from '@/components/pdf/PdfViewerToolbar.vue'
import type { LibraryEntry, PdfReadingLocation } from '@/features/library/types'
import {
  getBufferedPdfPages,
  getDominantPdfPage,
  prioritizePdfPages,
} from '@/features/reader/pdfContinuousScroll'
import { getPdfCanvasMetrics, PdfPageRenderQueue } from '@/features/reader/pdfRenderBudget'
import {
  findActivePdfSearchHighlight,
  renderPdfSearchHighlights,
  updateActivePdfSearchHighlight,
} from '@/features/reader/pdfSearchHighlights'
import { createPdfSearchPageIndex, findPdfSearchMatches } from '@/features/reader/pdfSearchIndex'
import type { PdfSearchMatch, PdfSearchPageIndex } from '@/features/reader/pdfSearchIndex'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

type PdfScaleMode = PdfReadingLocation['scaleMode']
type PdfViewMode = PdfReadingLocation['viewMode']
type PdfDocumentLoadOutcome = 'document-error' | 'ready' | 'resource-error' | 'stale'
type PdfLoadState = Exclude<PdfDocumentLoadOutcome, 'stale'> | 'loading'
type PdfRenderState = 'idle' | 'rendering' | 'ready' | 'error'
type PdfPageViewport = ReturnType<PDFPageProxy['getViewport']>
type PdfTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
type PdfTextLayer = InstanceType<(typeof import('pdfjs-dist'))['TextLayer']>

interface PdfPageSlot {
  errorMessage: string
  height: number
  isMeasured: boolean
  pageNumber: number
  renderState: PdfRenderState
  scale: number
  width: number
}

interface PdfVirtualPage {
  item: VirtualItem
  slot: PdfPageSlot
}

interface PdfTextLayerRenderOptions {
  container: HTMLDivElement
  isCurrent?: () => boolean
  onLayerCreated?: (layer: PdfTextLayer) => void
  pageNumber: number
  viewport: PdfPageViewport
}

interface PdfSearchContext {
  document: PDFDocumentProxy
  normalizedQuery: string
  sequence: number
}

const props = defineProps<{
  blob: Blob
  entry: LibraryEntry
  position: PdfReadingLocation | null
  searchQuery: string
}>()

const emit = defineEmits<{
  back: []
  positionChange: [position: PdfReadingLocation]
  progressChange: [progress: number]
  searchChange: [state: { activeIndex: number, announcement?: string, resultContext?: string, statusText?: string, total: number }]
}>()

const minScale = 0.35
const maxScale = 2.75
const zoomStep = 0.15
const pdfTextContentCacheLimit = 8
const pdfSearchIndexCacheLimit = 64
const pdfSearchPagesPerYield = 4
const pdfSearchSliceBudgetMs = 12
const defaultScrollPageGap = 17.6
const scrollVirtualOverscan = 4

const rootRef = useTemplateRef<HTMLElement>('root')
const stageFrameRef = useTemplateRef<HTMLElement>('stageFrame')
const pageStageRef = useTemplateRef<HTMLElement>('pageStage')
const scrollStackRef = useTemplateRef<HTMLElement>('scrollStack')
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')
const textLayerRef = useTemplateRef<HTMLDivElement>('textLayer')
const pageNumber = shallowRef(Math.max(1, props.position?.pageNumber ?? 1))
const totalPages = shallowRef(0)
const viewMode = shallowRef<PdfViewMode>(props.position?.viewMode ?? 'paged')
const scaleMode = shallowRef<PdfScaleMode>(props.position?.scaleMode ?? 'fit-width')
const customScale = shallowRef(props.position?.scale ?? 1)
const renderedScale = shallowRef(1)
const loadState = shallowRef<PdfLoadState>('loading')
const renderState = shallowRef<'idle' | 'rendering' | 'error'>('idle')
const errorMessage = shallowRef('')
const pageSlots = shallowRef<PdfPageSlot[]>([])
const bufferedScrollPages = shallowRef<Set<number>>(new Set())
const scrollStackWidth = shallowRef(1)
const scrollModeStatus = shallowRef<'idle' | 'measuring' | 'error'>('idle')
const sideControlTop = shallowRef('50%')
const searchMatches = shallowRef<PdfSearchMatch[]>([])
const activeSearchIndex = shallowRef(-1)
const searchStatus = shallowRef<'error' | 'idle' | 'extracting' | 'no-text'>('idle')
const searchIndexedPages = shallowRef(0)

let loadingTask: PDFDocumentLoadingTask | null = null
let pdfDocument: PDFDocumentProxy | null = null
let renderTask: RenderTask | null = null
let documentLoadGeneration = 0
let resizeObserver: ResizeObserver | null = null
let scrollPageObserver: IntersectionObserver | null = null
let renderSequence = 0
let scrollPrepareSequence = 0
let scrollRenderGeneration = 0
let scrollPositionSyncTimer: ReturnType<typeof window.setTimeout> | undefined
let programmaticScrollPage: number | null = null
let scrollNavigationSequence = 0
let sideControlFrame: number | undefined
let pendingZoomDelta = 0
let zoomAdjustmentPromise: Promise<void> | null = null
let zoomAdjustmentGeneration = 0
const scrollPageElements = new Map<number, HTMLElement>()
const scrollCanvasElements = new Map<number, HTMLCanvasElement>()
const scrollTextLayerElements = new Map<number, HTMLDivElement>()
const scrollRenderQueue = new PdfPageRenderQueue(2)
const scrollRenderPromises = new Map<number, Promise<void>>()
const scrollRenderTasks = new Map<number, RenderTask>()
const scrollRenderSequences = new Map<number, number>()
const visibleScrollPageAreas = new Map<number, number>()
const pdfSearchIndexCache = new Map<number, Promise<PdfSearchPageIndex>>()
const searchMatchesByPage = new Map<number, PdfSearchMatch[]>()
const pdfTextContentCache = new Map<number, Promise<PdfTextContent>>()
const scrollTextLayers = new Map<number, PdfTextLayer>()
const pendingScrollTextLayers = new Map<number, PdfTextLayer>()
const scrollTextRenderSequences = new Map<number, number>()
const pdfLoadingTaskDestructions = new WeakMap<PDFDocumentLoadingTask, Promise<void>>()
let pagedTextLayer: PdfTextLayer | null = null
let pendingPagedTextLayer: PdfTextLayer | null = null
let searchSequence = 0
let activeDocumentLoad: Promise<PdfDocumentLoadOutcome> | null = null

const isReady = computed(() => loadState.value === 'ready' && totalPages.value > 0)
const canGoToPreviousPage = computed(() => isReady.value && pageNumber.value > 1)
const canGoToNextPage = computed(() => isReady.value && pageNumber.value < totalPages.value)
const hasMultiplePages = computed(() => isReady.value && totalPages.value > 1)
const scrollVirtualizerOptions = computed(() => ({
  count: viewMode.value === 'scroll' && scrollModeStatus.value === 'idle'
    ? pageSlots.value.length
    : 0,
  enabled: viewMode.value === 'scroll' && scrollModeStatus.value === 'idle',
  estimateSize: estimateScrollPageSize,
  gap: defaultScrollPageGap,
  getItemKey: getScrollPageKey,
  getScrollElement: getScrollElement,
  overscan: scrollVirtualOverscan,
}))
const scrollVirtualizer = useVirtualizer<HTMLElement, HTMLElement>(scrollVirtualizerOptions)
const virtualPages = computed(() => scrollVirtualizer.value.getVirtualItems())
const virtualTotalSize = computed(() => scrollVirtualizer.value.getTotalSize())
const visibleVirtualPages = computed<PdfVirtualPage[]>(() => virtualPages.value.flatMap((item) => {
  const slot = pageSlots.value[item.index]
  return slot ? [{ item, slot }] : []
}))

function estimateScrollPageSize(index: number): number {
  return pageSlots.value[index]?.height ?? 1
}

function getScrollPageKey(index: number): number {
  return pageSlots.value[index]?.pageNumber ?? index + 1
}

function getScrollElement(): HTMLElement | null {
  return pageStageRef.value
}

function focus(): void {
  rootRef.value?.focus()
}

function startPdfDocumentLoad(): Promise<PdfDocumentLoadOutcome> {
  const load = loadPdfDocument()
  activeDocumentLoad = load
  return load
}

function waitForLoad(): Promise<PdfDocumentLoadOutcome> {
  return activeDocumentLoad ?? Promise.resolve('stale')
}

defineExpose({ clearSearch, focus, goToPage, goToSearchMatch, waitForLoad })

async function loadPdfDocument(): Promise<PdfDocumentLoadOutcome> {
  const generation = ++documentLoadGeneration
  const blob = props.blob
  loadState.value = 'loading'
  renderState.value = 'idle'
  errorMessage.value = ''
  totalPages.value = 0
  try {
    await cleanupPdfDocument()
  }
  catch {
    if (!isDocumentLoadCurrent(generation)) {
      return 'stale'
    }

    return setPdfResourceLoadError()
  }
  if (!isDocumentLoadCurrent(generation)) {
    return 'stale'
  }

  let pdfjs: Awaited<ReturnType<typeof loadPdfJs>>
  try {
    pdfjs = await loadPdfJs()
  }
  catch {
    if (!isDocumentLoadCurrent(generation)) {
      return 'stale'
    }

    return setPdfResourceLoadError()
  }

  let task: PDFDocumentLoadingTask | null = null
  try {
    if (!isDocumentLoadCurrent(generation)) {
      return 'stale'
    }

    const data = new Uint8Array(await blob.arrayBuffer())
    if (!isDocumentLoadCurrent(generation)) {
      return 'stale'
    }

    task = pdfjs.getDocument({ data })
    loadingTask = task
    const document = await task.promise
    if (!isDocumentLoadCurrent(generation) || loadingTask !== task) {
      await destroyPdfLoadingTask(task)
      return 'stale'
    }

    loadingTask = null
    pdfDocument = document
    totalPages.value = document.numPages
    pageNumber.value = clampPageNumber(pageNumber.value)
    loadState.value = 'ready'
    await nextTick()
    if (!isDocumentLoadCurrent(generation) || pdfDocument !== document) {
      return 'stale'
    }

    await renderActiveView({ anchorPage: pageNumber.value })
    if (!isDocumentLoadCurrent(generation) || pdfDocument !== document) {
      return 'stale'
    }

    if (props.searchQuery.trim()) {
      await runPdfSearch(props.searchQuery)
    }
    if (!isDocumentLoadCurrent(generation) || pdfDocument !== document) {
      return 'stale'
    }

    emitPosition()
    return 'ready'
  }
  catch (reason) {
    if (task && loadingTask === task) {
      loadingTask = null
    }
    if (task) {
      await destroyPdfLoadingTask(task)
    }
    if (!isDocumentLoadCurrent(generation)) {
      return 'stale'
    }

    cancelProgrammaticScrollNavigation()
    if (isPdfCancellation(reason)) {
      return 'stale'
    }
    if (isPdfResourceLoadFailure(reason)) {
      return setPdfResourceLoadError()
    }

    loadState.value = 'document-error'
    errorMessage.value = '这个 PDF 打不开。文件可能已损坏, 或浏览器无法解析它。'
    return 'document-error'
  }
}

function setPdfResourceLoadError(): 'resource-error' {
  loadState.value = 'resource-error'
  errorMessage.value = 'PDF 阅读器资源暂时无法加载。请重新加载页面后从文库重新打开。'
  return 'resource-error'
}

function isPdfResourceLoadFailure(reason: unknown): boolean {
  return reason instanceof Error && reason.message.includes('Setting up fake worker failed')
}

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])

  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

async function cleanupPdfDocument(): Promise<void> {
  scrollPrepareSequence += 1
  renderSequence += 1
  cancelProgrammaticScrollNavigation()
  cancelPendingZoomAdjustment()
  const renderCancellation = cancelRenderTask()
  const scrollRenderCancellation = cancelScrollRenderTasks()
  clearSearch({ emitState: false })
  clearTextLayers()
  pdfSearchIndexCache.clear()
  pdfTextContentCache.clear()

  const tasks = new Set<PDFDocumentLoadingTask>()
  if (loadingTask) {
    tasks.add(loadingTask)
  }
  if (pdfDocument?.loadingTask) {
    tasks.add(pdfDocument.loadingTask)
  }
  loadingTask = null
  pdfDocument = null
  pageSlots.value = []
  bufferedScrollPages.value = new Set()
  scrollStackWidth.value = 1
  scrollRenderPromises.clear()
  scrollRenderSequences.clear()
  pendingScrollTextLayers.clear()
  scrollTextRenderSequences.clear()
  scrollPageObserver?.disconnect()
  scrollPageObserver = null
  visibleScrollPageAreas.clear()
  scrollPageElements.clear()
  scrollCanvasElements.clear()
  scrollTextLayerElements.clear()

  await renderCancellation
  await scrollRenderCancellation
  await Promise.all([...tasks].map(task => destroyPdfLoadingTask(task)))
}

function isDocumentLoadCurrent(generation: number): boolean {
  return generation === documentLoadGeneration
}

async function destroyPdfLoadingTask(task: PDFDocumentLoadingTask): Promise<void> {
  const existingDestruction = pdfLoadingTaskDestructions.get(task)
  if (existingDestruction) {
    return existingDestruction
  }

  let destruction: Promise<void>
  destruction = destroyPdfLoadingTaskWithRetry(task).then((destroyed) => {
    if (!destroyed && pdfLoadingTaskDestructions.get(task) === destruction) {
      pdfLoadingTaskDestructions.delete(task)
    }
  })
  pdfLoadingTaskDestructions.set(task, destruction)
  return destruction
}

async function destroyPdfLoadingTaskWithRetry(task: PDFDocumentLoadingTask): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await task.destroy()
      return true
    }
    catch {
      // A failed loading task can reject while releasing its worker and transport resources.
    }
  }

  return false
}

async function cancelRenderTask(): Promise<void> {
  if (!renderTask) {
    return
  }

  const task = renderTask
  renderTask = null
  task.cancel()

  try {
    await task.promise
  }
  catch {
    // pdf.js rejects canceled render tasks; cancellation is expected when paging/zooming quickly.
  }
}

async function cancelScrollRenderTasks(): Promise<void> {
  scrollRenderGeneration += 1
  const tasks = [...scrollRenderTasks.values()]
  const promises = [...scrollRenderPromises.values()]
  const activePages = new Set([
    ...scrollRenderPromises.keys(),
    ...scrollRenderTasks.keys(),
  ])

  for (const page of activePages) {
    scrollRenderSequences.set(page, (scrollRenderSequences.get(page) ?? 0) + 1)
  }
  scrollRenderQueue.cancelAllPending()
  scrollRenderTasks.clear()
  clearAllScrollTextLayers()

  for (const task of tasks) {
    task.cancel()
  }

  await Promise.all(tasks.map(async (task) => {
    try {
      await task.promise
    }
    catch {
      // pdf.js rejects canceled render tasks; scroll virtualization cancels expectedly.
    }
  }))
  await Promise.allSettled(promises)
}

function clearTextLayers(): void {
  clearPagedTextLayer()
  clearAllScrollTextLayers()
}

function clearPagedTextLayer(): void {
  pendingPagedTextLayer?.cancel()
  pendingPagedTextLayer = null
  pagedTextLayer?.cancel()
  pagedTextLayer = null
  clearTextLayerContent(textLayerRef.value)
}

function clearAllScrollTextLayers(): void {
  const pages = new Set([
    ...scrollTextLayers.keys(),
    ...pendingScrollTextLayers.keys(),
    ...scrollTextRenderSequences.keys(),
  ])
  for (const page of pages) {
    clearScrollTextLayer(page)
  }
}

function clearScrollTextLayer(page: number): void {
  scrollTextRenderSequences.set(page, (scrollTextRenderSequences.get(page) ?? 0) + 1)
  pendingScrollTextLayers.get(page)?.cancel()
  pendingScrollTextLayers.delete(page)
  scrollTextLayers.get(page)?.cancel()
  scrollTextLayers.delete(page)
  clearTextLayerContent(scrollTextLayerElements.get(page))
}

function clearTextLayerContent(container: HTMLDivElement | null | undefined): void {
  if (!container) {
    return
  }

  container.replaceChildren()
  container.removeAttribute('data-pdf-has-highlight')
}

function clearSearch(options: { emitState?: boolean } = {}): void {
  searchSequence += 1
  searchMatches.value = []
  searchMatchesByPage.clear()
  activeSearchIndex.value = -1
  searchStatus.value = 'idle'
  searchIndexedPages.value = 0
  clearTextLayers()

  if (options.emitState !== false) {
    emitSearchState()
  }
}

async function runPdfSearch(query = props.searchQuery): Promise<void> {
  const normalizedQuery = query.trim()
  const sequence = ++searchSequence
  const document = pdfDocument
  const matches: PdfSearchMatch[] = []
  searchMatches.value = matches
  searchMatchesByPage.clear()
  activeSearchIndex.value = -1
  searchIndexedPages.value = 0
  clearTextLayers()

  if (!normalizedQuery || !document || loadState.value !== 'ready') {
    searchStatus.value = 'idle'
    emitSearchState()
    return
  }

  searchStatus.value = 'extracting'
  emitSearchState()

  const queryLower = normalizedQuery.toLocaleLowerCase()
  let hasSearchableText = false
  let lastPublishedMatchCount = 0
  let sliceStartedAt = performance.now()

  for (let page = 1; page <= totalPages.value; page += 1) {
    let pageText: PdfSearchPageIndex
    try {
      pageText = await getCachedPageText(page)
    }
    catch {
      if (!isPdfSearchCurrent(sequence, normalizedQuery, document)) {
        return
      }

      reportPdfSearchExtractionError()
      return
    }
    if (!isPdfSearchCurrent(sequence, normalizedQuery, document)) {
      return
    }

    if (pageText.normalizedText.length > 0) {
      hasSearchableText = true
    }

    const pageMatches = findPdfSearchMatches(pageText, queryLower)
    if (pageMatches.length > 0) {
      searchMatchesByPage.set(page, pageMatches)
      matches.push(...pageMatches)
      applySearchHighlightsForRenderedPage(page)
    }

    searchIndexedPages.value = page
    const elapsed = performance.now() - sliceStartedAt
    const shouldYield = page % pdfSearchPagesPerYield === 0 || elapsed >= pdfSearchSliceBudgetMs
    const foundFirstMatch = lastPublishedMatchCount === 0 && matches.length > 0
    if (foundFirstMatch || shouldYield || page === totalPages.value) {
      publishPdfSearchProgress(page, foundFirstMatch)
      lastPublishedMatchCount = matches.length
    }

    if (shouldYield && page < totalPages.value) {
      await yieldPdfSearchWork()
      sliceStartedAt = performance.now()
      if (!isPdfSearchCurrent(sequence, normalizedQuery, document)) {
        return
      }
    }
  }

  if (!isPdfSearchCurrent(sequence, normalizedQuery, document)) {
    return
  }

  if (!hasSearchableText) {
    searchStatus.value = 'no-text'
    searchMatches.value = []
    searchMatchesByPage.clear()
    activeSearchIndex.value = -1
    clearTextLayers()
    emitSearchState()
    return
  }

  searchStatus.value = 'idle'
  triggerRef(searchMatches)

  if (matches.length > 0) {
    if (activeSearchIndex.value < 0) {
      activeSearchIndex.value = 0
      await revealSearchMatch(matches[0]!, { behavior: 'auto' })
    }
    else {
      emitSearchState()
    }
  }
  else {
    clearTextLayers()
    emitSearchState()
  }
}

function isPdfSearchCurrent(
  sequence: number,
  normalizedQuery: string,
  document: PDFDocumentProxy,
): boolean {
  return sequence === searchSequence
    && normalizedQuery === props.searchQuery.trim()
    && document === pdfDocument
    && loadState.value === 'ready'
}

function reportPdfSearchExtractionError(): void {
  searchMatches.value = []
  searchMatchesByPage.clear()
  activeSearchIndex.value = -1
  searchIndexedPages.value = 0
  searchStatus.value = 'error'
  clearTextLayers()
  emitSearchState()
}

function shouldRenderPdfSearchTextLayer(): boolean {
  return searchStatus.value !== 'error' && props.searchQuery.trim().length > 0
}

function capturePdfSearchContext(): PdfSearchContext | null {
  const document = pdfDocument
  const normalizedQuery = props.searchQuery.trim()
  if (!document || !normalizedQuery || !shouldRenderPdfSearchTextLayer()) {
    return null
  }

  return {
    document,
    normalizedQuery,
    sequence: searchSequence,
  }
}

function isPdfSearchContextCurrent(context: PdfSearchContext): boolean {
  return shouldRenderPdfSearchTextLayer()
    && isPdfSearchCurrent(context.sequence, context.normalizedQuery, context.document)
}

function publishPdfSearchProgress(
  indexedPage: number,
  foundFirstMatch: boolean,
): void {
  searchIndexedPages.value = indexedPage
  triggerRef(searchMatches)

  if (foundFirstMatch) {
    activeSearchIndex.value = 0
  }

  emitSearchState()
  if (foundFirstMatch) {
    void revealSearchMatch(searchMatches.value[0]!, { behavior: 'auto' })
  }
}

function yieldPdfSearchWork(): Promise<void> {
  return new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
}

async function getCachedPageText(pageNumberToRead: number): Promise<PdfSearchPageIndex> {
  const cached = pdfSearchIndexCache.get(pageNumberToRead)
  if (cached) {
    pdfSearchIndexCache.delete(pageNumberToRead)
    pdfSearchIndexCache.set(pageNumberToRead, cached)
    return cached
  }

  const promise = extractPageText(pageNumberToRead).catch((reason) => {
    if (pdfSearchIndexCache.get(pageNumberToRead) === promise) {
      pdfSearchIndexCache.delete(pageNumberToRead)
    }
    throw reason
  })
  pdfSearchIndexCache.set(pageNumberToRead, promise)

  while (pdfSearchIndexCache.size > pdfSearchIndexCacheLimit) {
    const oldestPage = pdfSearchIndexCache.keys().next().value
    if (oldestPage === undefined) {
      break
    }
    pdfSearchIndexCache.delete(oldestPage)
  }

  return promise
}

async function extractPageText(pageNumberToRead: number): Promise<PdfSearchPageIndex> {
  const textContent = await getCachedTextContent(pageNumberToRead)
  return createPdfSearchPageIndex(pageNumberToRead, textContent.items.flatMap(item => (
    isTextContentItem(item) && item.str
      ? [{ hasEOL: item.hasEOL, text: item.str }]
      : []
  )))
}

async function getCachedTextContent(pageNumberToRead: number): Promise<PdfTextContent> {
  const cached = pdfTextContentCache.get(pageNumberToRead)
  if (cached) {
    pdfTextContentCache.delete(pageNumberToRead)
    pdfTextContentCache.set(pageNumberToRead, cached)
    return cached
  }

  const pdf = pdfDocument
  if (!pdf) {
    throw new Error('PDF document is not ready')
  }

  const promise = pdf.getPage(pageNumberToRead).then(page => page.getTextContent())
  pdfTextContentCache.set(pageNumberToRead, promise)

  while (pdfTextContentCache.size > pdfTextContentCacheLimit) {
    const oldestPage = pdfTextContentCache.keys().next().value
    if (oldestPage === undefined) {
      break
    }
    pdfTextContentCache.delete(oldestPage)
  }

  try {
    return await promise
  }
  catch (reason) {
    if (pdfTextContentCache.get(pageNumberToRead) === promise) {
      pdfTextContentCache.delete(pageNumberToRead)
    }
    throw reason
  }
}

function isTextContentItem(item: PdfTextContent['items'][number]): item is Extract<PdfTextContent['items'][number], { str: string }> {
  return 'str' in item && typeof item.str === 'string'
}

function goToSearchMatch(delta: number): void {
  if (searchMatches.value.length === 0) {
    emitSearchState()
    return
  }

  const nextIndex = activeSearchIndex.value < 0
    ? 0
    : (activeSearchIndex.value + delta + searchMatches.value.length) % searchMatches.value.length

  const previousMatch = searchMatches.value[activeSearchIndex.value]
  activeSearchIndex.value = nextIndex
  const match = searchMatches.value[nextIndex]
  updateActiveSearchHighlights(previousMatch, match)
  emitSearchState()
  if (match) {
    void revealSearchMatch(match)
  }
}

async function revealSearchMatch(match: PdfSearchMatch, options: { behavior?: ScrollBehavior } = {}): Promise<void> {
  const behavior = options.behavior ?? getPreferredScrollBehavior()
  if (viewMode.value === 'scroll') {
    await revealScrollSearchMatch(match, behavior)
    return
  }

  const hasCurrentTextLayer = pageNumber.value === match.pageNumber && pagedTextLayer !== null
  if (!hasCurrentTextLayer) {
    pageNumber.value = match.pageNumber
    await nextTick()
    await renderCurrentPage()
  }
  updateActiveSearchHighlights(undefined, match)
  scrollActiveSearchElementIntoView(behavior)
  emitSearchState()
}

async function revealScrollSearchMatch(match: PdfSearchMatch, behavior: ScrollBehavior): Promise<void> {
  pageNumber.value = clampPageNumber(match.pageNumber)
  ensureScrollPageBuffered(match.pageNumber)
  await scrollToPage(match.pageNumber)
  await nextTick()
  await renderScrollPage(match.pageNumber, -1)
  updateActiveSearchHighlights(undefined, match)

  const target = getRenderedSearchMatchElement(match)
  const stage = pageStageRef.value
  if (!target || !stage) {
    emitSearchState()
    return
  }

  const stageRect = stage.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const nextTop = stage.scrollTop + targetRect.top - stageRect.top - (stage.clientHeight * 0.35)
  stage.scrollTo({ top: Math.max(0, nextTop), behavior })
  emitPosition()
  emitSearchState()
}

function ensureScrollPageBuffered(page: number): void {
  const nextPages = new Set(bufferedScrollPages.value)
  const center = clampPageNumber(page)
  for (let offset = -2; offset <= 2; offset += 1) {
    nextPages.add(clampPageNumber(center + offset))
  }
  bufferedScrollPages.value = nextPages
}

function scrollActiveSearchElementIntoView(behavior: ScrollBehavior): void {
  const match = searchMatches.value[activeSearchIndex.value]
  const target = match ? getRenderedSearchMatchElement(match) : null
  if (!target) {
    return
  }

  target.scrollIntoView({ behavior, block: 'center', inline: 'nearest' })
}

function updateActiveSearchHighlights(
  previousMatch: PdfSearchMatch | undefined,
  activeMatch: PdfSearchMatch | undefined,
): void {
  const pages = new Set([
    previousMatch?.pageNumber,
    activeMatch?.pageNumber,
  ])

  for (const page of pages) {
    if (page === undefined) {
      continue
    }

    if (pagedTextLayer && viewMode.value === 'paged' && pageNumber.value === page) {
      const container = getTextLayerContainer(pagedTextLayer)
      if (container) {
        updateActivePdfSearchHighlight(container, activeMatch?.id)
      }
    }

    const scrollLayer = scrollTextLayers.get(page)
    const scrollContainer = scrollLayer ? getTextLayerContainer(scrollLayer) : null
    if (scrollContainer) {
      updateActivePdfSearchHighlight(scrollContainer, activeMatch?.id)
    }
  }
}

function applySearchHighlightsForRenderedPage(page: number): void {
  if (pagedTextLayer && viewMode.value === 'paged' && pageNumber.value === page) {
    applySearchHighlightsToLayer(page, pagedTextLayer)
  }

  const scrollLayer = scrollTextLayers.get(page)
  if (scrollLayer) {
    applySearchHighlightsToLayer(page, scrollLayer)
  }
}

function applySearchHighlightsToLayer(page: number, layer: PdfTextLayer): void {
  const pageMatches = searchMatchesByPage.get(page) ?? []
  const activeMatch = searchMatches.value[activeSearchIndex.value]
  const container = getTextLayerContainer(layer)
  if (!container) {
    return
  }

  renderPdfSearchHighlights({
    activeMatchId: activeMatch?.id,
    container,
    matches: pageMatches,
    textDivs: layer.textDivs,
  })
}

function getTextLayerContainer(layer: PdfTextLayer): HTMLDivElement | null {
  if (viewMode.value === 'paged' && layer === pagedTextLayer) {
    return textLayerRef.value
  }

  for (const [page, candidate] of scrollTextLayers) {
    if (candidate === layer) {
      return scrollTextLayerElements.get(page) ?? null
    }
  }

  return null
}

function getRenderedSearchMatchElement(match: PdfSearchMatch): HTMLElement | null {
  const layer = viewMode.value === 'scroll'
    ? scrollTextLayers.get(match.pageNumber)
    : pagedTextLayer

  if (!layer) {
    return null
  }

  const container = getTextLayerContainer(layer)
  const activeMarker = container ? findActivePdfSearchHighlight(container, match.id) : null
  if (activeMarker) {
    return activeMarker
  }

  for (const spanRange of match.spanRanges) {
    const textDiv = layer.textDivs[spanRange.spanIndex]
    if (textDiv) {
      return textDiv
    }
  }

  return null
}

function emitSearchState(): void {
  const query = props.searchQuery.trim()
  if (!query) {
    emit('searchChange', { activeIndex: -1, total: 0 })
    return
  }

  if (searchStatus.value === 'extracting') {
    const activeMatch = searchMatches.value[activeSearchIndex.value]
    if (activeMatch) {
      emit('searchChange', {
        activeIndex: activeSearchIndex.value,
        resultContext: `第 ${activeMatch.pageNumber} 页 · 已读取 ${searchIndexedPages.value}/${totalPages.value} 页`,
        total: searchMatches.value.length,
      })
      return
    }

    emit('searchChange', {
      activeIndex: -1,
      announcement: searchIndexedPages.value === 0 ? '正在读取 PDF 文本…' : undefined,
      statusText: searchIndexedPages.value === 0
        ? '正在读取…'
        : `正在读取 ${searchIndexedPages.value}/${totalPages.value} 页…`,
      total: 0,
    })
    return
  }

  if (searchStatus.value === 'no-text') {
    emit('searchChange', {
      activeIndex: -1,
      announcement: '此 PDF 没有可搜索的文本, 可能是扫描件。',
      statusText: '无可搜索文本',
      total: 0,
    })
    return
  }

  if (searchStatus.value === 'error') {
    emit('searchChange', {
      activeIndex: -1,
      announcement: 'PDF 搜索文本读取失败, 请重试。',
      statusText: '搜索文本读取失败, 请重试',
      total: 0,
    })
    return
  }

  const activeMatch = searchMatches.value[activeSearchIndex.value]
  emit('searchChange', {
    activeIndex: activeSearchIndex.value,
    announcement: activeMatch
      ? `第 ${activeSearchIndex.value + 1} 个, 共 ${searchMatches.value.length} 个, 第 ${activeMatch.pageNumber} 页`
      : undefined,
    resultContext: activeMatch ? `第 ${activeMatch.pageNumber} 页` : undefined,
    total: searchMatches.value.length,
  })
}

function preparePdfCanvas(canvas: HTMLCanvasElement, viewport: PdfPageViewport): number {
  const metrics = getPdfCanvasMetrics({
    cssHeight: viewport.height,
    cssWidth: viewport.width,
    devicePixelRatio: window.devicePixelRatio || 1,
  })
  canvas.width = metrics.width
  canvas.height = metrics.height
  canvas.style.inlineSize = `${viewport.width}px`
  canvas.style.blockSize = `${viewport.height}px`
  return metrics.scale
}

async function renderCurrentPage(): Promise<void> {
  const pdf = pdfDocument
  const canvas = canvasRef.value

  if (!pdf || !canvas || loadState.value !== 'ready') {
    return
  }

  const sequence = ++renderSequence
  renderState.value = 'rendering'
  await cancelRenderTask()

  try {
    const page = await pdf.getPage(clampPageNumber(pageNumber.value))
    if (sequence !== renderSequence) {
      return
    }

    const scale = calculateScale(page)
    renderedScale.value = scale
    const viewport = page.getViewport({ scale })
    const ratio = preparePdfCanvas(canvas, viewport)
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas context is not available')
    }

    renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    })

    await renderTask.promise

    if (sequence === renderSequence) {
      if (shouldRenderPdfSearchTextLayer()) {
        await renderPagedTextLayer(viewport, sequence)
      }
      else {
        clearPagedTextLayer()
      }
      if (sequence !== renderSequence) {
        return
      }
      renderState.value = 'idle'
      queueSideControlPositionUpdate()
    }
  }
  catch (reason) {
    if (
      isPdfCancellation(reason)
      || sequence !== renderSequence
      || pdf !== pdfDocument
    ) {
      return
    }

    renderState.value = 'error'
    errorMessage.value = '这一页暂时无法显示。可以换页或重新打开 PDF。'
  }
  finally {
    if (sequence === renderSequence) {
      renderTask = null
    }
  }
}

async function renderPagedTextLayer(viewport: PdfPageViewport, sequence: number): Promise<void> {
  const container = textLayerRef.value
  const searchContext = capturePdfSearchContext()
  if (!container || !searchContext || sequence !== renderSequence) {
    return
  }

  const page = pageNumber.value
  const isCurrent = (): boolean => (
    sequence === renderSequence
    && isPdfSearchContextCurrent(searchContext)
    && loadState.value === 'ready'
    && viewMode.value === 'paged'
    && textLayerRef.value === container
    && pageNumber.value === page
  )
  clearPagedTextLayer()
  let createdLayer: PdfTextLayer | null = null

  try {
    const layer = await renderTextLayer({
      container,
      isCurrent,
      onLayerCreated: (nextLayer) => {
        createdLayer = nextLayer
        pendingPagedTextLayer = nextLayer
      },
      pageNumber: page,
      viewport,
    })

    if (createdLayer && pendingPagedTextLayer === createdLayer) {
      pendingPagedTextLayer = null
    }
    if (!layer || !isCurrent()) {
      layer?.cancel()
      return
    }

    pagedTextLayer = layer
    applySearchHighlightsToLayer(page, layer)
  }
  catch (reason) {
    if (createdLayer && pendingPagedTextLayer === createdLayer) {
      pendingPagedTextLayer = null
    }
    if (!isPdfCancellation(reason) && isCurrent()) {
      reportPdfSearchExtractionError()
    }
  }
}

async function renderScrollTextLayer(pageNumberToRender: number, viewport: PdfPageViewport): Promise<void> {
  const generation = scrollRenderGeneration
  const pdf = pdfDocument
  const container = scrollTextLayerElements.get(pageNumberToRender)
  const searchContext = capturePdfSearchContext()
  if (!pdf || !container || !searchContext || !isPdfSearchContextCurrent(searchContext) || !isScrollTextLayerRenderCurrent({
    container,
    generation,
    page: pageNumberToRender,
    pdf,
  })) {
    return
  }

  clearScrollTextLayer(pageNumberToRender)
  const sequence = scrollTextRenderSequences.get(pageNumberToRender) ?? 0
  const isCurrent = (): boolean => (
    isPdfSearchContextCurrent(searchContext)
    && isScrollTextLayerRenderCurrent({
      container,
      generation,
      page: pageNumberToRender,
      pdf,
      sequence,
    })
  )
  let createdLayer: PdfTextLayer | null = null

  try {
    const layer = await renderTextLayer({
      container,
      isCurrent,
      onLayerCreated: (nextLayer) => {
        createdLayer = nextLayer
        pendingScrollTextLayers.set(pageNumberToRender, nextLayer)
      },
      pageNumber: pageNumberToRender,
      viewport,
    })

    if (createdLayer && pendingScrollTextLayers.get(pageNumberToRender) === createdLayer) {
      pendingScrollTextLayers.delete(pageNumberToRender)
    }
    if (!layer || !isCurrent()) {
      layer?.cancel()
      return
    }

    scrollTextLayers.set(pageNumberToRender, layer)
    applySearchHighlightsToLayer(pageNumberToRender, layer)
  }
  catch (reason) {
    if (createdLayer && pendingScrollTextLayers.get(pageNumberToRender) === createdLayer) {
      pendingScrollTextLayers.delete(pageNumberToRender)
    }
    if (!isPdfCancellation(reason) && isCurrent()) {
      reportPdfSearchExtractionError()
    }
  }
}

function isScrollTextLayerRenderCurrent(options: {
  container: HTMLDivElement
  generation: number
  page: number
  pdf: PDFDocumentProxy
  sequence?: number
}): boolean {
  return options.generation === scrollRenderGeneration
    && options.pdf === pdfDocument
    && loadState.value === 'ready'
    && viewMode.value === 'scroll'
    && scrollModeStatus.value === 'idle'
    && shouldRenderPdfSearchTextLayer()
    && bufferedScrollPages.value.has(options.page)
    && scrollTextLayerElements.get(options.page) === options.container
    && (options.sequence === undefined || scrollTextRenderSequences.get(options.page) === options.sequence)
}

async function renderTextLayer(options: PdfTextLayerRenderOptions): Promise<PdfTextLayer | null> {
  const [pdfjs, textContent] = await Promise.all([
    loadPdfJs(),
    getCachedTextContent(options.pageNumber),
  ])
  if (options.isCurrent && !options.isCurrent()) {
    return null
  }

  options.container.replaceChildren()
  options.container.style.inlineSize = `${options.viewport.width}px`
  options.container.style.blockSize = `${options.viewport.height}px`
  options.container.style.setProperty('--total-scale-factor', String(options.viewport.scale))
  options.container.style.setProperty('--scale-factor', String(options.viewport.scale))
  options.container.style.setProperty('--user-unit', '1')
  pdfjs.setLayerDimensions(options.container, options.viewport)

  const layer = new pdfjs.TextLayer({
    container: options.container,
    textContentSource: textContent,
    viewport: options.viewport,
  })
  options.onLayerCreated?.(layer)
  if (options.isCurrent && !options.isCurrent()) {
    layer.cancel()
    return null
  }

  await layer.render()
  if (options.isCurrent && !options.isCurrent()) {
    layer.cancel()
    return null
  }

  layer.textDivs.forEach((textDiv, index) => {
    textDiv.dataset.pdfTextIndex = String(index)
    textDiv.setAttribute('aria-hidden', 'true')
  })

  return layer
}

function calculateScale(page: PDFPageProxy): number {
  const baseViewport = page.getViewport({ scale: 1 })
  const stage = pageStageRef.value
  const stageRect = stage?.getBoundingClientRect()
  const stageStyles = stage ? window.getComputedStyle(stage) : null
  const horizontalPadding = stageStyles
    ? Number.parseFloat(stageStyles.paddingLeft) + Number.parseFloat(stageStyles.paddingRight)
    : 32
  const verticalPadding = stageStyles
    ? Number.parseFloat(stageStyles.paddingTop) + Number.parseFloat(stageStyles.paddingBottom)
    : 32
  const availableWidth = Math.max(280, (stageRect?.width ?? 820) - horizontalPadding)
  const availableHeight = Math.max(280, (stageRect?.height ?? (window.innerHeight - 220)) - verticalPadding)

  if (scaleMode.value === 'fit-page') {
    return clampScale(Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height))
  }

  if (scaleMode.value === 'custom') {
    return clampScale(customScale.value)
  }

  return clampScale(availableWidth / baseViewport.width)
}

function setScaleMode(nextMode: PdfScaleMode): void {
  cancelPendingZoomAdjustment()
  const nextCustomScale = getCurrentPageScale()
  scaleMode.value = nextMode
  if (nextMode === 'custom') {
    customScale.value = nextCustomScale
  }
}

function zoomBy(delta: number): void {
  const currentScale = getMeasuredCurrentPageScale()
  if (currentScale !== null && !zoomAdjustmentPromise) {
    applyZoom(currentScale, delta)
    return
  }

  pendingZoomDelta += delta
  queuePendingZoomAdjustment()
}

function applyZoom(currentScale: number, delta: number): void {
  customScale.value = clampScale(currentScale + delta)
  scaleMode.value = 'custom'
}

function getCurrentPageScale(): number {
  return getMeasuredCurrentPageScale() ?? renderedScale.value
}

function getMeasuredCurrentPageScale(): number | null {
  if (viewMode.value === 'scroll') {
    const slot = pageSlots.value[pageNumber.value - 1]
    if (slot?.isMeasured) {
      return slot.scale
    }

    return null
  }

  return renderedScale.value
}

function queuePendingZoomAdjustment(): void {
  if (zoomAdjustmentPromise) {
    return
  }

  const generation = zoomAdjustmentGeneration
  const request = applyPendingZoomAdjustment(generation)
  zoomAdjustmentPromise = request
  void request.then(
    () => finishPendingZoomAdjustment(request),
    () => finishPendingZoomAdjustment(request),
  )
}

function finishPendingZoomAdjustment(request: Promise<void>): void {
  if (zoomAdjustmentPromise !== request) {
    return
  }

  zoomAdjustmentPromise = null
  if (pendingZoomDelta !== 0) {
    queuePendingZoomAdjustment()
  }
}

function cancelPendingZoomAdjustment(): void {
  zoomAdjustmentGeneration += 1
  pendingZoomDelta = 0
  zoomAdjustmentPromise = null
}

async function applyPendingZoomAdjustment(generation: number): Promise<void> {
  const currentScale = await resolveCurrentPageScale()
  if (generation !== zoomAdjustmentGeneration) {
    return
  }

  const delta = pendingZoomDelta
  pendingZoomDelta = 0
  if (currentScale !== null && delta !== 0) {
    applyZoom(currentScale, delta)
  }
}

async function resolveCurrentPageScale(): Promise<number | null> {
  const measuredScale = getMeasuredCurrentPageScale()
  if (measuredScale !== null) {
    return measuredScale
  }

  const pdf = pdfDocument
  const page = pageNumber.value
  const generation = scrollRenderGeneration
  const prepareSequence = scrollPrepareSequence
  if (!pdf || loadState.value !== 'ready' || viewMode.value !== 'scroll') {
    return null
  }

  try {
    const pdfPage = await pdf.getPage(page)
    if (
      pdf !== pdfDocument
      || generation !== scrollRenderGeneration
      || prepareSequence !== scrollPrepareSequence
      || loadState.value !== 'ready'
      || viewMode.value !== 'scroll'
      || pageNumber.value !== page
    ) {
      return null
    }

    return calculateScale(pdfPage)
  }
  catch {
    return null
  }
}

function goToPreviousPage(): void {
  goToPage(clampPageNumber(pageNumber.value - 1))
}

function goToNextPage(): void {
  goToPage(clampPageNumber(pageNumber.value + 1))
}

function goToPage(nextPageNumber: number): void {
  const nextPage = clampPageNumber(nextPageNumber)

  if (viewMode.value === 'scroll') {
    void scrollToPage(nextPage)
    return
  }

  pageNumber.value = nextPage
}

function requestPage(nextPageNumber: number | null): void {
  goToPage(nextPageNumber ?? pageNumber.value)
}

function handlePdfKeydown(event: KeyboardEvent): void {
  if (isTextInputTarget(event.target)) {
    return
  }

  if (event.key === 'ArrowLeft' && canGoToPreviousPage.value) {
    event.preventDefault()
    goToPreviousPage()
    return
  }

  if (event.key === 'ArrowRight' && canGoToNextPage.value) {
    event.preventDefault()
    goToNextPage()
  }
}

function retry(): void {
  void startPdfDocumentLoad()
}

function reloadPage(): void {
  window.location.reload()
}

function setViewMode(nextMode: PdfViewMode): void {
  if (viewMode.value === nextMode) {
    return
  }

  if (nextMode !== 'scroll') {
    cancelProgrammaticScrollNavigation()
  }
  cancelPendingZoomAdjustment()
  viewMode.value = nextMode
  void nextTick(async () => {
    await renderActiveView({ anchorPage: pageNumber.value })
    emitPosition()
  })
}

function emitPosition(): void {
  if (!isReady.value) {
    return
  }

  emit('positionChange', {
    documentId: props.entry.id,
    type: 'pdf',
    pageNumber: pageNumber.value,
    viewMode: viewMode.value,
    scaleMode: scaleMode.value,
    scale: scaleMode.value === 'custom' ? customScale.value : null,
  })
  emitProgress()
}

function emitProgress(): void {
  if (!isReady.value) {
    emit('progressChange', 0)
    return
  }

  emit('progressChange', calculateProgress())
}

function calculateProgress(): number {
  if (totalPages.value <= 0) {
    return 0
  }

  if (viewMode.value === 'scroll') {
    const stage = pageStageRef.value
    const maxScrollTop = stage ? stage.scrollHeight - stage.clientHeight : 0
    if (maxScrollTop > 1 && stage) {
      return clampProgress(stage.scrollTop / maxScrollTop)
    }
  }

  return clampProgress(pageNumber.value / totalPages.value)
}

async function renderActiveView(options: { anchorPage: number }): Promise<void> {
  if (viewMode.value === 'scroll') {
    renderSequence += 1
    await cancelRenderTask()
    await prepareScrollMode(options.anchorPage)
    return
  }

  scrollPrepareSequence += 1
  await cancelScrollRenderTasks()
  bufferedScrollPages.value = new Set()
  await renderCurrentPage()
}

async function prepareScrollMode(anchorPage: number): Promise<void> {
  const pdf = pdfDocument

  if (!pdf || loadState.value !== 'ready') {
    return
  }

  const sequence = ++scrollPrepareSequence
  cancelProgrammaticScrollNavigation()
  scrollModeStatus.value = 'measuring'
  await cancelScrollRenderTasks()

  try {
    const firstPage = await pdf.getPage(1)
    if (sequence !== scrollPrepareSequence || pdf !== pdfDocument) {
      return
    }

    const scale = calculateScale(firstPage)
    renderedScale.value = scale
    const firstViewport = firstPage.getViewport({ scale })
    const estimatedWidth = Math.round(firstViewport.width)
    const estimatedHeight = Math.round(firstViewport.height)

    pageSlots.value = Array.from({ length: pdf.numPages }, (_, index): PdfPageSlot => ({
      errorMessage: '',
      height: estimatedHeight,
      isMeasured: index === 0,
      pageNumber: index + 1,
      renderState: 'idle',
      scale,
      width: estimatedWidth,
    }))
    scrollStackWidth.value = estimatedWidth
    pageNumber.value = clampPageNumber(anchorPage)
    startProgrammaticScrollNavigation(pageNumber.value)
    scrollModeStatus.value = 'idle'

    await nextTick()
    scrollVirtualizer.value.measure()
    setupScrollPageObserver()
    await scrollToPage(pageNumber.value)
    updateBufferedScrollPages([pageNumber.value])
    queueSideControlPositionUpdate()
  }
  catch (reason) {
    if (
      sequence !== scrollPrepareSequence
      || pdf !== pdfDocument
    ) {
      return
    }

    cancelProgrammaticScrollNavigation()
    if (isPdfCancellation(reason)) {
      return
    }

    scrollModeStatus.value = 'error'
    errorMessage.value = '连续滚动模式暂时无法准备页面。可以切回翻页模式或重新打开 PDF。'
  }
}

function setScrollPageElement(page: number, element: unknown): void {
  const previousElement = scrollPageElements.get(page)
  if (previousElement && previousElement !== element) {
    scrollPageObserver?.unobserve(previousElement)
  }

  if (element instanceof HTMLElement) {
    scrollPageElements.set(page, element)
    element.dataset.pageNumber = String(page)
    scrollVirtualizer.value.measureElement(element)
    scrollPageObserver?.observe(element)
    return
  }

  visibleScrollPageAreas.delete(page)
  scrollPageElements.delete(page)
  void nextTick(() => scrollVirtualizer.value.measureElement(null))
}

function setScrollCanvasElement(page: number, element: unknown): void {
  if (element instanceof HTMLCanvasElement) {
    scrollCanvasElements.set(page, element)
    void nextTick(() => renderScrollPage(page))
    return
  }

  scrollCanvasElements.delete(page)
  void cancelScrollRenderTask(page)
}

function setScrollTextLayerElement(page: number, element: unknown): void {
  if (element instanceof HTMLDivElement) {
    if (scrollTextLayerElements.get(page) !== element) {
      clearScrollTextLayer(page)
    }
    scrollTextLayerElements.set(page, element)
    void nextTick(() => {
      if (shouldRenderPdfSearchTextLayer() && shouldRenderScrollPage(page)) {
        void ensureScrollTextLayer(page)
      }
    })
    return
  }

  clearScrollTextLayer(page)
  scrollTextLayerElements.delete(page)
}

function shouldRenderScrollPage(page: number): boolean {
  return bufferedScrollPages.value.has(page)
}

function getScrollPageAtViewportCenter(): number | null {
  const stage = pageStageRef.value
  const stack = scrollStackRef.value
  if (!stage || !stack) {
    return null
  }

  const stageRect = stage.getBoundingClientRect()
  const stackRect = stack.getBoundingClientRect()
  const viewportCenterOffset = stageRect.top + (stage.clientHeight / 2) - stackRect.top
  let closestPage: number | null = null
  let closestDistance = Number.POSITIVE_INFINITY

  for (const item of virtualPages.value) {
    if (viewportCenterOffset >= item.start && viewportCenterOffset <= item.end) {
      return item.index + 1
    }

    const distance = Math.min(
      Math.abs(viewportCenterOffset - item.start),
      Math.abs(viewportCenterOffset - item.end),
    )
    if (distance < closestDistance) {
      closestDistance = distance
      closestPage = item.index + 1
    }
  }

  return closestPage
}

function handleStageScroll(event: Event): void {
  if (programmaticScrollPage !== null && !event.isTrusted) {
    cancelProgrammaticScrollNavigation()
  }

  if (viewMode.value !== 'scroll' || scrollModeStatus.value !== 'idle') {
    queueSideControlPositionUpdate()
    return
  }

  const prepareSequence = scrollPrepareSequence
  const estimatedPage = programmaticScrollPage
    ?? getScrollBoundaryPage()
    ?? getScrollPageAtViewportCenter()
    ?? pageNumber.value
  refreshVisibleScrollPageAreas()
  updateBufferedScrollPages([estimatedPage])
  emitProgress()
  queueSideControlPositionUpdate()

  if (programmaticScrollPage !== null) {
    scheduleProgrammaticScrollRelease()
    return
  }

  clearScrollPositionSyncTimer()
  scrollPositionSyncTimer = window.setTimeout(() => {
    scrollPositionSyncTimer = undefined
    if (
      viewMode.value !== 'scroll'
      || scrollModeStatus.value !== 'idle'
      || prepareSequence !== scrollPrepareSequence
    ) {
      return
    }

    const dominantPage = getScrollBoundaryPage()
      ?? getDominantVisiblePage()
      ?? getScrollPageAtViewportCenter()
      ?? estimatedPage
    if (dominantPage) {
      pageNumber.value = dominantPage
      emitPosition()
    }
  }, 100)
}

function getScrollBoundaryPage(): number | null {
  const stage = pageStageRef.value
  if (!stage) {
    return null
  }

  if (stage.scrollTop <= 2) {
    return 1
  }

  const maxScrollTop = stage.scrollHeight - stage.clientHeight
  if (maxScrollTop > 0 && stage.scrollTop >= maxScrollTop - 2) {
    return totalPages.value
  }

  return null
}

function startProgrammaticScrollNavigation(page: number): number {
  scrollNavigationSequence += 1
  programmaticScrollPage = page
  clearScrollPositionSyncTimer()
  return scrollNavigationSequence
}

function scheduleProgrammaticScrollRelease(): void {
  const targetPage = programmaticScrollPage
  if (targetPage === null) {
    return
  }

  const navigationSequence = scrollNavigationSequence
  const prepareSequence = scrollPrepareSequence
  clearScrollPositionSyncTimer()
  scrollPositionSyncTimer = window.setTimeout(() => {
    scrollPositionSyncTimer = undefined
    if (
      navigationSequence !== scrollNavigationSequence
      || prepareSequence !== scrollPrepareSequence
      || programmaticScrollPage !== targetPage
      || viewMode.value !== 'scroll'
      || scrollModeStatus.value !== 'idle'
    ) {
      return
    }

    programmaticScrollPage = null
    pageNumber.value = targetPage
    updateBufferedScrollPages([targetPage])
    emitPosition()
    queueSideControlPositionUpdate()
  }, 140)
}

function cancelProgrammaticScrollNavigation(): void {
  scrollNavigationSequence += 1
  programmaticScrollPage = null
  clearScrollPositionSyncTimer()
}

function handleManualScrollIntent(): void {
  if (programmaticScrollPage !== null) {
    cancelProgrammaticScrollNavigation()
  }
}

function clearScrollPositionSyncTimer(): void {
  if (scrollPositionSyncTimer === undefined) {
    return
  }

  window.clearTimeout(scrollPositionSyncTimer)
  scrollPositionSyncTimer = undefined
}

function refreshVisibleScrollPageAreas(): void {
  const stage = pageStageRef.value
  if (!stage) {
    return
  }

  const stageRect = stage.getBoundingClientRect()
  for (const page of [...visibleScrollPageAreas.keys()]) {
    const rect = scrollPageElements.get(page)?.getBoundingClientRect()
    if (!rect) {
      visibleScrollPageAreas.delete(page)
      continue
    }

    const visibleWidth = Math.min(rect.right, stageRect.right) - Math.max(rect.left, stageRect.left)
    const visibleHeight = Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top)
    if (visibleWidth <= 0 || visibleHeight <= 0) {
      visibleScrollPageAreas.delete(page)
      continue
    }

    visibleScrollPageAreas.set(page, visibleWidth * visibleHeight)
  }
}

function setupScrollPageObserver(): void {
  const stage = pageStageRef.value
  if (!stage) {
    return
  }

  scrollPageObserver?.disconnect()
  visibleScrollPageAreas.clear()
  scrollPageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const page = Number((entry.target as HTMLElement).dataset.pageNumber)
      if (!Number.isFinite(page)) {
        continue
      }

      if (entry.isIntersecting) {
        const visibleArea = entry.intersectionRect.width * entry.intersectionRect.height
        visibleScrollPageAreas.set(page, Math.max(1, visibleArea))
      }
      else {
        visibleScrollPageAreas.delete(page)
      }
    }

    updateBufferedScrollPages()
  }, { root: stage, threshold: [0, 0.25, 0.5, 0.75, 1] })

  for (const element of scrollPageElements.values()) {
    scrollPageObserver.observe(element)
  }
}

function updateBufferedScrollPages(additionalAnchors: Iterable<number> = []): void {
  if (viewMode.value !== 'scroll' || pageSlots.value.length === 0) {
    return
  }

  const nextPages = getBufferedPdfPages({
    anchorPages: [...visibleScrollPageAreas.keys(), ...additionalAnchors],
    fallbackPage: getDominantVisiblePage() ?? pageNumber.value,
    totalPages: totalPages.value,
  })
  const previousPages = bufferedScrollPages.value
  bufferedScrollPages.value = nextPages

  for (const page of previousPages) {
    if (!nextPages.has(page)) {
      void cancelScrollRenderTask(page)
      clearScrollTextLayer(page)
      updatePageSlot(page, { renderState: 'idle' })
    }
  }

  void nextTick(() => {
    const prioritizedPages = prioritizePdfPages({
      focusPage: getDominantVisiblePage() ?? pageNumber.value,
      pages: nextPages,
      visibleAreas: visibleScrollPageAreas,
    })
    for (const [priority, page] of prioritizedPages.entries()) {
      void renderScrollPage(page, priority)
    }
    queueSideControlPositionUpdate()
  })
}

function queueSideControlPositionUpdate(): void {
  if (sideControlFrame !== undefined) {
    window.cancelAnimationFrame(sideControlFrame)
  }

  sideControlFrame = window.requestAnimationFrame(() => {
    sideControlFrame = undefined
    updateSideControlPosition()
  })
}

function updateSideControlPosition(): void {
  const frame = stageFrameRef.value
  const stage = pageStageRef.value
  if (!frame || !stage) {
    sideControlTop.value = '50%'
    return
  }

  const frameRect = frame.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const targetRect = getCurrentPageVisualRect()
  const center = targetRect ? getVisibleRectCenter(targetRect, stageRect) : getRectCenter(stageRect)
  sideControlTop.value = `${Math.round(center - frameRect.top)}px`
}

function getCurrentPageVisualRect(): DOMRect | null {
  if (viewMode.value === 'paged') {
    return canvasRef.value?.getBoundingClientRect() ?? null
  }

  const page = getDominantVisiblePage() ?? pageNumber.value
  return scrollPageElements.get(page)?.getBoundingClientRect() ?? null
}

function getVisibleRectCenter(targetRect: DOMRect, stageRect: DOMRect): number {
  const visibleTop = Math.max(targetRect.top, stageRect.top)
  const visibleBottom = Math.min(targetRect.bottom, stageRect.bottom)

  if (visibleBottom > visibleTop) {
    return (visibleTop + visibleBottom) / 2
  }

  return getRectCenter(stageRect)
}

function getRectCenter(rect: DOMRect): number {
  return rect.top + rect.height / 2
}

function getDominantVisiblePage(): number | null {
  return getDominantPdfPage(visibleScrollPageAreas)
}

async function renderScrollPage(page: number, priority = getScrollRenderPriority(page)): Promise<void> {
  const existingPromise = scrollRenderPromises.get(page)
  if (existingPromise) {
    scrollRenderQueue.schedule(page, priority, () => performScrollPageRender(page))
    return existingPromise
  }

  const queuedPromise = scrollRenderQueue.schedule(page, priority, () => performScrollPageRender(page))
  const promise = queuedPromise.finally(() => {
    if (scrollRenderPromises.get(page) === promise) {
      scrollRenderPromises.delete(page)
    }
    const slot = pageSlots.value[page - 1]
    if (
      slot?.renderState === 'idle'
      && bufferedScrollPages.value.has(page)
      && scrollCanvasElements.has(page)
      && viewMode.value === 'scroll'
      && scrollModeStatus.value === 'idle'
      && loadState.value === 'ready'
    ) {
      void renderScrollPage(page)
    }
  })
  scrollRenderPromises.set(page, promise)
  return promise
}

function getScrollRenderPriority(page: number): number {
  const pages = prioritizePdfPages({
    focusPage: getDominantVisiblePage() ?? pageNumber.value,
    pages: bufferedScrollPages.value,
    visibleAreas: visibleScrollPageAreas,
  })
  const priority = pages.indexOf(page)
  return priority >= 0 ? priority : pages.length
}

async function performScrollPageRender(page: number): Promise<void> {
  const generation = scrollRenderGeneration
  const pdf = pdfDocument
  const canvas = scrollCanvasElements.get(page)

  if (
    !pdf
    || !canvas
    || loadState.value !== 'ready'
    || viewMode.value !== 'scroll'
    || scrollModeStatus.value !== 'idle'
    || !bufferedScrollPages.value.has(page)
  ) {
    return
  }

  const slot = pageSlots.value[page - 1]
  if (!slot) {
    return
  }

  if (slot.renderState === 'ready') {
    if (page === pageNumber.value) {
      renderedScale.value = slot.scale
    }
    if (shouldRenderPdfSearchTextLayer()) {
      await ensureScrollTextLayer(page)
    }
    return
  }

  await cancelScrollRenderTask(page)
  if (generation !== scrollRenderGeneration) {
    return
  }

  const sequence = (scrollRenderSequences.get(page) ?? 0) + 1
  scrollRenderSequences.set(page, sequence)
  updatePageSlot(page, { renderState: 'rendering', errorMessage: '' })

  try {
    const pdfPage = await pdf.getPage(page)
    if (
      scrollRenderSequences.get(page) !== sequence
      || generation !== scrollRenderGeneration
      || pdf !== pdfDocument
      || loadState.value !== 'ready'
      || viewMode.value !== 'scroll'
      || scrollModeStatus.value !== 'idle'
      || !bufferedScrollPages.value.has(page)
      || scrollCanvasElements.get(page) !== canvas
    ) {
      return
    }

    const scale = calculateScale(pdfPage)
    const viewport = pdfPage.getViewport({ scale })
    const viewportHeight = Math.round(viewport.height)
    const viewportWidth = Math.round(viewport.width)
    updatePageSlot(page, {
      height: viewportHeight,
      isMeasured: true,
      scale,
      width: viewportWidth,
    })
    scrollVirtualizer.value.resizeItem(page - 1, viewportHeight)
    scrollStackWidth.value = Math.max(scrollStackWidth.value, viewportWidth)
    if (page === pageNumber.value) {
      renderedScale.value = scale
    }
    await nextTick()
    const pageElement = scrollPageElements.get(page)
    if (pageElement) {
      scrollVirtualizer.value.measureElement(pageElement)
    }
    refreshVisibleScrollPageAreas()
    emitProgress()
    queueSideControlPositionUpdate()

    const ratio = preparePdfCanvas(canvas, viewport)
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas context is not available')
    }

    const task = pdfPage.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    })
    scrollRenderTasks.set(page, task)

    await task.promise

    if (
      scrollRenderSequences.get(page) === sequence
      && generation === scrollRenderGeneration
      && pdf === pdfDocument
      && loadState.value === 'ready'
      && viewMode.value === 'scroll'
      && scrollModeStatus.value === 'idle'
      && bufferedScrollPages.value.has(page)
      && scrollCanvasElements.get(page) === canvas
    ) {
      if (shouldRenderPdfSearchTextLayer()) {
        await renderScrollTextLayer(page, viewport)
      }
      else {
        clearScrollTextLayer(page)
      }
      if (
        scrollRenderSequences.get(page) === sequence
        && generation === scrollRenderGeneration
        && pdf === pdfDocument
        && loadState.value === 'ready'
        && viewMode.value === 'scroll'
        && scrollModeStatus.value === 'idle'
        && bufferedScrollPages.value.has(page)
        && scrollCanvasElements.get(page) === canvas
      ) {
        updatePageSlot(page, { renderState: 'ready' })
      }
    }
  }
  catch (reason) {
    if (
      isPdfCancellation(reason)
      || generation !== scrollRenderGeneration
      || scrollRenderSequences.get(page) !== sequence
    ) {
      return
    }

    updatePageSlot(page, {
      renderState: 'error',
      errorMessage: '这一页暂时无法显示。',
    })
  }
  finally {
    if (scrollRenderSequences.get(page) === sequence) {
      scrollRenderTasks.delete(page)
    }
  }
}

async function ensureScrollTextLayer(page: number): Promise<void> {
  const generation = scrollRenderGeneration
  const pdf = pdfDocument
  const container = scrollTextLayerElements.get(page)

  if (!pdf || !container || !isScrollTextLayerRenderCurrent({
    container,
    generation,
    page,
    pdf,
  })) {
    return
  }

  const layer = scrollTextLayers.get(page)
  if (layer) {
    const activeMatch = searchMatches.value[activeSearchIndex.value]
    const container = getTextLayerContainer(layer)
    if (container) {
      updateActivePdfSearchHighlight(container, activeMatch?.id)
    }
    return
  }

  try {
    const pdfPage = await pdf.getPage(page)
    if (!isScrollTextLayerRenderCurrent({ container, generation, page, pdf })) {
      return
    }

    const slot = pageSlots.value[page - 1]
    if (!slot) {
      return
    }

    const viewport = pdfPage.getViewport({ scale: slot.scale })
    await renderScrollTextLayer(page, viewport)
  }
  catch (reason) {
    if (!isPdfCancellation(reason) && isScrollTextLayerRenderCurrent({ container, generation, page, pdf })) {
      clearScrollTextLayer(page)
    }
  }
}

async function cancelScrollRenderTask(page: number): Promise<void> {
  scrollRenderSequences.set(page, (scrollRenderSequences.get(page) ?? 0) + 1)
  scrollRenderQueue.cancelPending(page)
  const task = scrollRenderTasks.get(page)
  if (!task) {
    updatePageSlot(page, { renderState: 'idle' })
    return
  }

  scrollRenderTasks.delete(page)
  task.cancel()

  try {
    await task.promise
  }
  catch {
    // pdf.js rejects canceled render tasks; cancellation is expected when pages leave the buffer.
  }

  updatePageSlot(page, { renderState: 'idle' })
}

function updatePageSlot(page: number, patch: Partial<Omit<PdfPageSlot, 'pageNumber'>>): void {
  const index = page - 1
  const slot = pageSlots.value[index]
  if (!slot) {
    return
  }

  pageSlots.value[index] = { ...slot, ...patch }
  triggerRef(pageSlots)
}

async function scrollToPage(page: number): Promise<void> {
  const previousPage = pageNumber.value
  const nextPage = clampPageNumber(page)
  if (nextPage !== previousPage) {
    cancelPendingZoomAdjustment()
  }
  pageNumber.value = nextPage
  const navigationSequence = startProgrammaticScrollNavigation(nextPage)
  updateBufferedScrollPages([nextPage])
  scrollVirtualizer.value.scrollToIndex(nextPage - 1, {
    align: 'start',
    behavior: 'auto',
  })
  scheduleProgrammaticScrollRelease()

  await nextTick()
  if (navigationSequence !== scrollNavigationSequence || programmaticScrollPage !== nextPage) {
    return
  }
  const stage = pageStageRef.value
  const element = scrollPageElements.get(nextPage)
  if (!stage || !element) {
    emitPosition()
    return
  }

  const stageRect = stage.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const nextTop = stage.scrollTop + elementRect.top - stageRect.top
  stage.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' })
  scheduleProgrammaticScrollRelease()
  queueSideControlPositionUpdate()
  emitPosition()
}

function getPreferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function clampPageNumber(value: number): number {
  const maxPage = Math.max(1, totalPages.value || 1)
  return Math.min(Math.max(1, Math.round(value)), maxPage)
}

function clampScale(value: number): number {
  return Math.min(maxScale, Math.max(minScale, Number(value.toFixed(2))))
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, value))
}

function isPdfCancellation(reason: unknown): boolean {
  return reason instanceof Error && (
    reason.name === 'RenderingCancelledException'
    || reason.name === 'AbortException'
  )
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
}

watch(() => props.blob, () => {
  pageNumber.value = Math.max(1, props.position?.pageNumber ?? 1)
  viewMode.value = props.position?.viewMode ?? 'paged'
  scaleMode.value = props.position?.scaleMode ?? 'fit-width'
  customScale.value = props.position?.scale ?? 1
  void startPdfDocumentLoad()
})

watch(() => props.searchQuery, () => {
  void runPdfSearch(props.searchQuery)
})

watch(pageNumber, () => {
  if (!isReady.value) {
    return
  }

  if (viewMode.value === 'paged') {
    void renderCurrentPage()
  }
  else {
    const slot = pageSlots.value[pageNumber.value - 1]
    if (slot?.isMeasured) {
      renderedScale.value = slot.scale
    }
  }

  emitPosition()
  queueSideControlPositionUpdate()
})

watch([scaleMode, customScale], () => {
  if (!isReady.value) {
    return
  }

  void renderActiveView({ anchorPage: pageNumber.value })
  emitPosition()
  queueSideControlPositionUpdate()
})

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (scaleMode.value === 'custom') {
      queueSideControlPositionUpdate()
      return
    }

    void renderActiveView({ anchorPage: pageNumber.value })
    queueSideControlPositionUpdate()
  })

  if (pageStageRef.value) {
    resizeObserver.observe(pageStageRef.value)
  }

  void startPdfDocumentLoad()
})

onUnmounted(() => {
  documentLoadGeneration += 1
  if (sideControlFrame !== undefined) {
    window.cancelAnimationFrame(sideControlFrame)
  }
  cancelProgrammaticScrollNavigation()
  resizeObserver?.disconnect()
  void cleanupPdfDocument().catch(() => undefined)
})
</script>

<template>
  <section
    ref="root"
    class="pdf-viewer"
    aria-labelledby="pdf-viewer-title"
    data-testid="pdf-viewer"
    tabindex="-1"
    @keydown="handlePdfKeydown"
  >
    <header class="pdf-viewer__header">
      <button class="pdf-viewer__back" type="button" @click="emit('back')">
        ← 文库
      </button>
      <div class="pdf-viewer__title-block">
        <p class="pdf-viewer__eyebrow">
          <span class="pdf-viewer__chip">PDF</span>
          原件查看
        </p>
        <h1 id="pdf-viewer-title" class="pdf-viewer__title">
          {{ props.entry.title }}
        </h1>
      </div>
    </header>

    <PdfViewerToolbar
      :can-go-to-next-page="canGoToNextPage"
      :can-go-to-previous-page="canGoToPreviousPage"
      :is-ready="isReady"
      :page-number="pageNumber"
      :rendered-scale="renderedScale"
      :scale-mode="scaleMode"
      :total-pages="totalPages"
      :view-mode="viewMode"
      @next-page="goToNextPage"
      @previous-page="goToPreviousPage"
      @request-page="requestPage"
      @select-scale-mode="setScaleMode"
      @select-view-mode="setViewMode"
      @zoom-in="zoomBy(zoomStep)"
      @zoom-out="zoomBy(-zoomStep)"
    />

    <p class="pdf-viewer__note">
      PDF 保持原样显示; 只有使用搜索时才在浏览器内读取文本层, 不上传。
    </p>

    <div
      ref="stageFrame"
      class="pdf-viewer__stage-frame"
      :class="{ 'pdf-viewer__stage-frame--with-side-controls': hasMultiplePages }"
      :style="{ '--pdf-side-control-top': sideControlTop }"
    >
      <button
        v-if="hasMultiplePages"
        class="pdf-viewer__side-page-button pdf-viewer__side-page-button--previous"
        type="button"
        :disabled="!canGoToPreviousPage"
        aria-label="上一页"
        data-testid="pdf-viewer-side-prev"
        @click="goToPreviousPage"
      >
        <svg class="pdf-viewer__side-page-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 6 9 12l6 6" />
        </svg>
      </button>

      <div
        ref="pageStage"
        class="pdf-viewer__stage"
        :class="{ 'pdf-viewer__stage--no-horizontal-scroll': scaleMode !== 'custom' }"
        :aria-label="viewMode === 'scroll' ? `PDF 连续滚动，共 ${totalPages} 页` : undefined"
        data-testid="pdf-viewer-stage"
        :role="viewMode === 'scroll' ? 'document' : undefined"
        @pointerdown="handleManualScrollIntent"
        @scroll="handleStageScroll"
        @touchstart.passive="handleManualScrollIntent"
        @wheel.passive="handleManualScrollIntent"
      >
        <div v-if="loadState === 'loading'" class="pdf-viewer__state" role="status">
          正在打开 PDF…
        </div>

        <div
          v-else-if="loadState === 'document-error' || loadState === 'resource-error'"
          class="pdf-viewer__state pdf-viewer__state--error"
          role="alert"
        >
          <p>{{ errorMessage }}</p>
          <button v-if="loadState === 'document-error'" type="button" @click="retry">
            再试一次
          </button>
          <button v-else type="button" @click="reloadPage">
            重新加载页面
          </button>
        </div>

        <div v-else-if="viewMode === 'paged'" class="pdf-viewer__page-shell" data-testid="pdf-viewer-paged-page">
          <canvas
            ref="canvas"
            class="pdf-viewer__canvas"
            :aria-label="`PDF 第 ${pageNumber} 页, 共 ${totalPages} 页`"
            data-testid="pdf-viewer-canvas"
          />
          <div
            ref="textLayer"
            class="pdf-viewer__text-layer textLayer"
            aria-hidden="true"
            data-testid="pdf-viewer-text-layer"
          />
          <p v-if="renderState === 'rendering'" class="pdf-viewer__render-status" role="status">
            正在渲染第 {{ pageNumber }} 页…
          </p>
          <p v-else-if="renderState === 'error'" class="pdf-viewer__render-status pdf-viewer__render-status--error" role="alert">
            {{ errorMessage }}
          </p>
        </div>

        <div
          v-else
          ref="scrollStack"
          class="pdf-viewer__scroll-stack"
          :style="{
            blockSize: scrollModeStatus === 'idle' ? `${virtualTotalSize}px` : undefined,
            inlineSize: `${scrollStackWidth}px`,
          }"
          aria-label="PDF 页面"
          data-testid="pdf-viewer-scroll-stack"
          role="list"
        >
          <div v-if="scrollModeStatus === 'measuring'" class="pdf-viewer__state" role="status">
            正在准备连续滚动…
          </div>
          <div v-else-if="scrollModeStatus === 'error'" class="pdf-viewer__state pdf-viewer__state--error" role="alert">
            {{ errorMessage }}
          </div>
          <template v-else>
            <article
              v-for="virtualPage in visibleVirtualPages"
              :key="virtualPage.slot.pageNumber"
              :ref="element => setScrollPageElement(virtualPage.slot.pageNumber, element)"
              class="pdf-viewer__scroll-page-slot"
              :style="{
                inlineSize: `${virtualPage.slot.width}px`,
                blockSize: `${virtualPage.slot.height}px`,
                transform: `translate3d(-50%, ${virtualPage.item.start}px, 0)`,
              }"
              :aria-current="virtualPage.slot.pageNumber === pageNumber ? 'page' : undefined"
              :aria-label="`PDF 第 ${virtualPage.slot.pageNumber} 页, 共 ${totalPages} 页`"
              :aria-posinset="virtualPage.slot.pageNumber"
              :aria-setsize="totalPages"
              :data-index="virtualPage.item.index"
              :data-page-number="virtualPage.slot.pageNumber"
              data-testid="pdf-viewer-scroll-page"
              role="listitem"
            >
              <canvas
                v-if="shouldRenderScrollPage(virtualPage.slot.pageNumber)"
                :ref="element => setScrollCanvasElement(virtualPage.slot.pageNumber, element)"
                class="pdf-viewer__canvas pdf-viewer__canvas--scroll"
                aria-hidden="true"
                data-testid="pdf-viewer-scroll-canvas"
              />
              <div
                v-if="shouldRenderScrollPage(virtualPage.slot.pageNumber)"
                :ref="element => setScrollTextLayerElement(virtualPage.slot.pageNumber, element)"
                class="pdf-viewer__text-layer textLayer"
                aria-hidden="true"
                data-testid="pdf-viewer-scroll-text-layer"
              />
              <div v-else class="pdf-viewer__scroll-placeholder" aria-hidden="true" />
              <p v-if="virtualPage.slot.renderState === 'rendering'" class="pdf-viewer__render-status" role="status">
                正在渲染第 {{ virtualPage.slot.pageNumber }} 页…
              </p>
              <p v-else-if="virtualPage.slot.renderState === 'error'" class="pdf-viewer__render-status pdf-viewer__render-status--error" role="alert">
                {{ virtualPage.slot.errorMessage }}
              </p>
            </article>
          </template>
        </div>
      </div>

      <button
        v-if="hasMultiplePages"
        class="pdf-viewer__side-page-button pdf-viewer__side-page-button--next"
        type="button"
        :disabled="!canGoToNextPage"
        aria-label="下一页"
        data-testid="pdf-viewer-side-next"
        @click="goToNextPage"
      >
        <svg class="pdf-viewer__side-page-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </div>
  </section>
</template>

<style scoped>
.pdf-viewer {
  max-width: min(100%, 68rem);
  margin: 0 auto;
  padding: clamp(2rem, 5vw, 3.5rem) 0 7rem;
  color: var(--reading-fg);
}

.pdf-viewer__header {
  display: flex;
  align-items: start;
  gap: 1.2rem;
  margin-bottom: clamp(1.4rem, 4vw, 2.4rem);
}

.pdf-viewer__back,
.pdf-viewer__state button {
  min-block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface-elevated);
  font: inherit;
  cursor: pointer;
}

.pdf-viewer__back {
  padding-inline: 0.9rem;
}

.pdf-viewer__back:hover,
.pdf-viewer__back:focus-visible,
.pdf-viewer__state button:hover,
.pdf-viewer__state button:focus-visible {
  border-color: var(--accent-primary);
  color: var(--text-primary);
}

.pdf-viewer__title-block {
  min-width: 0;
}

.pdf-viewer__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.3rem;
  color: var(--reading-fg-muted);
  font-size: 0.86rem;
}

.pdf-viewer__chip {
  min-inline-size: 2.35rem;
  padding: 0.2rem 0.45rem;
  border: var(--border-width-control) solid color-mix(in srgb, var(--reading-accent) 54%, transparent);
  border-radius: var(--radius-control);
  color: var(--reading-accent-text);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
}

.pdf-viewer__title {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--reading-font-heading);
  font-size: clamp(2rem, 6vw, 3.35rem);
  font-weight: 680;
  line-height: 1;
}

.pdf-viewer__note {
  margin: 0 0 1rem;
  color: var(--reading-fg-muted);
  font-size: 0.9rem;
}

.pdf-viewer__stage {
  display: grid;
  block-size: min(68vh, 52rem);
  min-block-size: 22rem;
  padding: clamp(0.75rem, 3vw, 1.35rem);
  border: var(--border-width-surface) solid color-mix(in srgb, var(--reading-rule) 58%, transparent);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--reading-code-bg) 54%, var(--reading-bg));
  overscroll-behavior: contain;
  overflow: auto;
}

.pdf-viewer__stage--no-horizontal-scroll {
  overflow-x: hidden;
}

.pdf-viewer__stage-frame {
  position: relative;
  --pdf-side-control-top: 50%;
}

.pdf-viewer__side-page-button {
  position: absolute;
  inset-block-start: var(--pdf-side-control-top);
  z-index: 2;
  display: grid;
  place-items: center;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: var(--border-width-control) solid color-mix(in srgb, var(--reading-rule) 78%, transparent);
  border-radius: var(--radius-full);
  color: var(--reading-fg);
  background: color-mix(in srgb, var(--reading-bg) 88%, transparent);
  box-shadow: var(--shadow-panel);
  font: inherit;
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.58;
  transform: translateY(-50%);
  transition: var(--transition-interactive);
  backdrop-filter: blur(12px);
}

.pdf-viewer__side-page-icon {
  inline-size: 1.18rem;
  block-size: 1.18rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.3;
}

.pdf-viewer__stage-frame--with-side-controls .pdf-viewer__stage {
  padding-inline: clamp(3.65rem, 6vw, 4.75rem);
}

.pdf-viewer__side-page-button--previous {
  inset-inline-start: clamp(0.45rem, 1.7vw, 0.95rem);
}

.pdf-viewer__side-page-button--next {
  inset-inline-end: clamp(0.45rem, 1.7vw, 0.95rem);
}

.pdf-viewer__side-page-button:hover,
.pdf-viewer__side-page-button:focus-visible {
  border-color: var(--reading-accent);
  color: var(--reading-accent-text);
  opacity: 1;
}

.pdf-viewer__stage-frame:hover .pdf-viewer__side-page-button:not(:disabled),
.pdf-viewer__stage-frame:focus-within .pdf-viewer__side-page-button:not(:disabled) {
  opacity: 1;
}

.pdf-viewer__side-page-button:disabled {
  cursor: not-allowed;
  opacity: 0.32;
}

.pdf-viewer__page-shell {
  position: relative;
  display: grid;
  justify-items: center;
  min-inline-size: max-content;
}

.pdf-viewer__scroll-stack {
  position: relative;
  min-inline-size: max-content;
}

.pdf-viewer__scroll-page-slot {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 50%;
  display: grid;
  content-visibility: auto;
  place-items: center;
  max-inline-size: none;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 18px 44px rgb(0 0 0 / 18%);
}

.pdf-viewer__scroll-placeholder {
  inline-size: 100%;
  block-size: 100%;
  border-radius: inherit;
  background:
    linear-gradient(
      90deg,
      rgb(255 255 255 / 0%),
      rgb(255 255 255 / 54%),
      rgb(255 255 255 / 0%)
    ),
    #fff;
}

.pdf-viewer__canvas {
  display: block;
  max-inline-size: none;
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 18px 44px rgb(0 0 0 / 18%);
}

.pdf-viewer__canvas--scroll {
  box-shadow: none;
}

.pdf-viewer__text-layer {
  --min-font-size: 1;
  --min-font-size-inv: calc(1 / var(--min-font-size));
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: clip;
  color-scheme: only light;
  line-height: 1;
  text-align: initial;
  text-size-adjust: none;
  transform-origin: 0 0;
  pointer-events: none;
  forced-color-adjust: none;
}

.pdf-viewer__text-layer :deep(span),
.pdf-viewer__text-layer :deep(br) {
  position: absolute;
  color: transparent;
  white-space: pre;
  transform-origin: 0% 0%;
}

.pdf-viewer__text-layer :deep(:not(.markedContent)),
.pdf-viewer__text-layer :deep(.markedContent span:not(.markedContent)) {
  z-index: 1;
  font-size: calc(var(--text-scale-factor) * var(--font-height, 1));
  transform:
    rotate(var(--rotate, 0deg))
    scaleX(var(--scale-x, 1))
    scale(var(--min-font-size-inv));
}

.pdf-viewer__text-layer :deep(.pdf-viewer__search-match) {
  position: absolute;
  display: block;
  z-index: 2;
  border-radius: 2px;
  background: color-mix(in srgb, var(--reading-accent) 24%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--reading-accent) 12%, transparent);
  transform: none;
}

.pdf-viewer__text-layer :deep(.pdf-viewer__search-match--active) {
  background: color-mix(in srgb, var(--reading-accent) 46%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--reading-accent) 30%, transparent);
}

.pdf-viewer__state {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.85rem;
  min-block-size: 22rem;
  color: var(--reading-fg-muted);
  text-align: center;
}

.pdf-viewer__state--error {
  color: var(--reading-accent-text);
}

.pdf-viewer__render-status {
  position: sticky;
  bottom: 0.8rem;
  justify-self: center;
  margin: 1rem 0 0;
  padding: 0.45rem 0.7rem;
  border: var(--border-width-control) solid color-mix(in srgb, var(--reading-rule) 72%, transparent);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  color: var(--reading-fg-muted);
  font-size: 0.86rem;
}

.pdf-viewer__render-status--error {
  color: var(--reading-accent-text);
}

@media (max-width: 900px) {
  .pdf-viewer__stage-frame--with-side-controls .pdf-viewer__stage {
    padding-inline: clamp(0.75rem, 3vw, 1.35rem);
  }

  .pdf-viewer__side-page-button {
    display: none;
  }
}

@media (max-width: 700px) {
  .pdf-viewer {
    padding-block-start: 1.5rem;
  }

  .pdf-viewer__header {
    display: grid;
  }

  .pdf-viewer__stage {
    max-inline-size: calc(100vw - 2.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pdf-viewer__side-page-button {
    backdrop-filter: none;
  }

  .pdf-viewer__side-page-button {
    transition: none;
  }
}
</style>
