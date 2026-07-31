<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import type { LibraryEntry, PdfReadingPosition } from '@/features/library/types'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

type PdfScaleMode = PdfReadingPosition['scaleMode']
type PdfViewMode = PdfReadingPosition['viewMode']
type PdfRenderState = 'idle' | 'rendering' | 'ready' | 'error'
type PdfPageViewport = ReturnType<PDFPageProxy['getViewport']>
type PdfTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
type PdfTextLayer = InstanceType<(typeof import('pdfjs-dist'))['TextLayer']>

interface PdfSearchSpan {
  end: number
  start: number
}

interface PdfSearchSpanRange {
  end: number
  spanIndex: number
  start: number
}

interface PdfSearchPageText {
  normalizedText: string
  pageNumber: number
  spans: PdfSearchSpan[]
  textContent: PdfTextContent
}

interface PdfSearchMatch {
  id: string
  pageNumber: number
  spanRanges: PdfSearchSpanRange[]
}

interface PdfPageSlot {
  pageNumber: number
  width: number
  height: number
  renderState: PdfRenderState
  errorMessage: string
}

const props = defineProps<{
  blob: Blob
  entry: LibraryEntry
  position: PdfReadingPosition | null
  searchQuery: string
}>()

const emit = defineEmits<{
  back: []
  positionChange: [position: Omit<PdfReadingPosition, 'updatedAt'>]
  progressChange: [progress: number]
  searchChange: [state: { activeIndex: number, announcement?: string, resultContext?: string, statusText?: string, total: number }]
}>()

const minScale = 0.35
const maxScale = 2.75
const zoomStep = 0.15

const rootRef = useTemplateRef<HTMLElement>('root')
const stageFrameRef = useTemplateRef<HTMLElement>('stageFrame')
const pageStageRef = useTemplateRef<HTMLElement>('pageStage')
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')
const textLayerRef = useTemplateRef<HTMLDivElement>('textLayer')
const pageNumber = shallowRef(Math.max(1, props.position?.pageNumber ?? 1))
const totalPages = shallowRef(0)
const viewMode = shallowRef<PdfViewMode>(props.position?.viewMode ?? 'paged')
const scaleMode = shallowRef<PdfScaleMode>(props.position?.scaleMode ?? 'fit-width')
const customScale = shallowRef(props.position?.scale ?? 1)
const renderedScale = shallowRef(1)
const loadState = shallowRef<'loading' | 'ready' | 'error'>('loading')
const renderState = shallowRef<'idle' | 'rendering' | 'error'>('idle')
const errorMessage = shallowRef('')
const pageSlots = shallowRef<PdfPageSlot[]>([])
const bufferedScrollPages = shallowRef<Set<number>>(new Set())
const scrollModeStatus = shallowRef<'idle' | 'measuring' | 'error'>('idle')
const sideControlTop = shallowRef('50%')
const searchMatches = shallowRef<PdfSearchMatch[]>([])
const activeSearchIndex = shallowRef(-1)
const searchStatus = shallowRef<'idle' | 'extracting' | 'no-text'>('idle')

let loadingTask: PDFDocumentLoadingTask | null = null
let pdfDocument: PDFDocumentProxy | null = null
let renderTask: RenderTask | null = null
let resizeObserver: ResizeObserver | null = null
let scrollPageObserver: IntersectionObserver | null = null
let renderSequence = 0
let scrollMeasureSequence = 0
let scrollPositionSyncTimer: ReturnType<typeof window.setTimeout> | undefined
let sideControlFrame: number | undefined
const scrollPageElements = new Map<number, HTMLElement>()
const scrollCanvasElements = new Map<number, HTMLCanvasElement>()
const scrollTextLayerElements = new Map<number, HTMLDivElement>()
const scrollRenderTasks = new Map<number, RenderTask>()
const scrollRenderSequences = new Map<number, number>()
const intersectingScrollPages = new Set<number>()
const pdfSearchTextCache = new Map<number, Promise<PdfSearchPageText>>()
const scrollTextLayers = new Map<number, PdfTextLayer>()
let pagedTextLayer: PdfTextLayer | null = null
let searchSequence = 0

const isReady = computed(() => loadState.value === 'ready' && totalPages.value > 0)
const canGoToPreviousPage = computed(() => isReady.value && pageNumber.value > 1)
const canGoToNextPage = computed(() => isReady.value && pageNumber.value < totalPages.value)
const hasMultiplePages = computed(() => isReady.value && totalPages.value > 1)
const pageLabel = computed(() => totalPages.value > 0 ? `${pageNumber.value} / ${totalPages.value}` : '— / —')
const zoomLabel = computed(() => `${Math.round(renderedScale.value * 100)}%`)
const scaleModeLabel = computed(() => {
  if (scaleMode.value === 'fit-page') {
    return '整页'
  }

  if (scaleMode.value === 'custom') {
    return zoomLabel.value
  }

  return '适宽'
})

function focus(): void {
  rootRef.value?.focus()
}

defineExpose({ clearSearch, focus, goToPage, goToSearchMatch })

async function loadPdfDocument(): Promise<void> {
  loadState.value = 'loading'
  renderState.value = 'idle'
  errorMessage.value = ''
  totalPages.value = 0
  await cleanupPdfDocument()

  try {
    const pdfjs = await loadPdfJs()
    const data = new Uint8Array(await props.blob.arrayBuffer())
    loadingTask = pdfjs.getDocument({ data })
    const task = loadingTask
    pdfDocument = await task.promise
    if (loadingTask === task) {
      loadingTask = null
    }
    totalPages.value = pdfDocument.numPages
    pageNumber.value = clampPageNumber(pageNumber.value)
    loadState.value = 'ready'
    await nextTick()
    await renderActiveView({ anchorPage: pageNumber.value })
    if (props.searchQuery.trim()) {
      await runPdfSearch(props.searchQuery)
    }
    emitPosition()
  }
  catch (reason) {
    if (isPdfCancellation(reason)) {
      return
    }

    loadState.value = 'error'
    errorMessage.value = '这个 PDF 打不开。文件可能已损坏, 或浏览器无法解析它。'
  }
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
  await cancelRenderTask()
  await cancelScrollRenderTasks()
  clearSearch({ emitState: false })
  clearTextLayers()
  pdfSearchTextCache.clear()

  const task = loadingTask ?? pdfDocument?.loadingTask
  loadingTask = null
  pdfDocument = null

  if (task) {
    await task.destroy()
  }

  pageSlots.value = []
  bufferedScrollPages.value = new Set()
  scrollPageObserver?.disconnect()
  scrollPageObserver = null
  intersectingScrollPages.clear()
  scrollPageElements.clear()
  scrollCanvasElements.clear()
  scrollTextLayerElements.clear()
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
  const tasks = [...scrollRenderTasks.values()]
  scrollRenderTasks.clear()
  scrollRenderSequences.clear()
  for (const page of [...scrollTextLayers.keys()]) {
    clearScrollTextLayer(page)
  }

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
}

function clearTextLayers(): void {
  clearPagedTextLayer()
  for (const page of [...scrollTextLayers.keys()]) {
    clearScrollTextLayer(page)
  }
}

function clearPagedTextLayer(): void {
  pagedTextLayer?.cancel()
  pagedTextLayer = null
  clearTextLayerContent(textLayerRef.value)
}

function clearScrollTextLayer(page: number): void {
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
  searchMatches.value = []
  activeSearchIndex.value = -1
  searchStatus.value = 'idle'
  clearTextLayers()

  if (options.emitState !== false) {
    emitSearchState()
  }
}

async function runPdfSearch(query = props.searchQuery): Promise<void> {
  const normalizedQuery = query.trim()
  const sequence = ++searchSequence
  searchMatches.value = []
  activeSearchIndex.value = -1

  if (!normalizedQuery || !pdfDocument || loadState.value !== 'ready') {
    searchStatus.value = 'idle'
    clearTextLayers()
    emitSearchState()
    return
  }

  searchStatus.value = 'extracting'
  emitSearchState()

  const queryLower = normalizedQuery.toLocaleLowerCase()
  const matches: PdfSearchMatch[] = []
  let hasSearchableText = false

  for (let page = 1; page <= totalPages.value; page += 1) {
    const pageText = await getCachedPageText(page)
    if (sequence !== searchSequence) {
      return
    }

    if (pageText.normalizedText.length > 0) {
      hasSearchableText = true
    }

    matches.push(...findMatchesOnPage(pageText, queryLower))

    if (page % 4 === 0) {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    }
  }

  if (sequence !== searchSequence) {
    return
  }

  if (!hasSearchableText) {
    searchStatus.value = 'no-text'
    searchMatches.value = []
    activeSearchIndex.value = -1
    clearTextLayers()
    emitSearchState()
    return
  }

  searchStatus.value = 'idle'
  searchMatches.value = matches
  activeSearchIndex.value = matches.length > 0 ? 0 : -1

  if (matches.length > 0) {
    await revealSearchMatch(matches[0]!, { behavior: 'auto' })
  }
  else {
    clearTextLayers()
    emitSearchState()
  }
}

async function getCachedPageText(pageNumberToRead: number): Promise<PdfSearchPageText> {
  const cached = pdfSearchTextCache.get(pageNumberToRead)
  if (cached) {
    return cached
  }

  const promise = extractPageText(pageNumberToRead)
  pdfSearchTextCache.set(pageNumberToRead, promise)
  return promise
}

async function extractPageText(pageNumberToRead: number): Promise<PdfSearchPageText> {
  const pdf = pdfDocument
  if (!pdf) {
    throw new Error('PDF document is not ready')
  }

  const page = await pdf.getPage(pageNumberToRead)
  const textContent = await page.getTextContent()
  const spans: PdfSearchSpan[] = []
  let text = ''

  for (const item of textContent.items) {
    if (!isTextContentItem(item) || !item.str) {
      continue
    }

    if (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
      text += ' '
    }

    const start = text.length
    text += item.str
    const end = text.length
    spans.push({ end, start })

    if (item.hasEOL) {
      text += '\n'
    }
  }

  return {
    normalizedText: text.toLocaleLowerCase(),
    pageNumber: pageNumberToRead,
    spans,
    textContent,
  }
}

function isTextContentItem(item: PdfTextContent['items'][number]): item is Extract<PdfTextContent['items'][number], { str: string }> {
  return 'str' in item && typeof item.str === 'string'
}

function findMatchesOnPage(pageText: PdfSearchPageText, queryLower: string): PdfSearchMatch[] {
  const matches: PdfSearchMatch[] = []
  let index = pageText.normalizedText.indexOf(queryLower)

  while (index !== -1) {
    const end = index + queryLower.length
    const spanRanges = getSpanRangesForMatch(pageText.spans, index, end)
    if (spanRanges.length > 0) {
      matches.push({
        id: `${pageText.pageNumber}:${index}:${matches.length}`,
        pageNumber: pageText.pageNumber,
        spanRanges,
      })
    }

    index = pageText.normalizedText.indexOf(queryLower, Math.max(end, index + 1))
  }

  return matches
}

function getSpanRangesForMatch(spans: PdfSearchSpan[], start: number, end: number): PdfSearchSpanRange[] {
  const ranges: PdfSearchSpanRange[] = []
  spans.forEach((span, index) => {
    if (span.end > start && span.start < end) {
      ranges.push({
        end: Math.min(span.end, end) - span.start,
        spanIndex: index,
        start: Math.max(span.start, start) - span.start,
      })
    }
  })
  return ranges
}

function goToSearchMatch(delta: number): void {
  if (searchMatches.value.length === 0) {
    emitSearchState()
    return
  }

  const nextIndex = activeSearchIndex.value < 0
    ? 0
    : (activeSearchIndex.value + delta + searchMatches.value.length) % searchMatches.value.length

  activeSearchIndex.value = nextIndex
  applySearchHighlights()
  emitSearchState()
  const match = searchMatches.value[nextIndex]
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

  if (pageNumber.value !== match.pageNumber) {
    pageNumber.value = match.pageNumber
  }

  await nextTick()
  await renderCurrentPage()
  applySearchHighlights()
  scrollActiveSearchElementIntoView(behavior)
  emitSearchState()
}

async function revealScrollSearchMatch(match: PdfSearchMatch, behavior: ScrollBehavior): Promise<void> {
  pageNumber.value = clampPageNumber(match.pageNumber)
  ensureScrollPageBuffered(match.pageNumber)
  await nextTick()
  await renderScrollPage(match.pageNumber)
  applySearchHighlights()

  const target = getRenderedSearchMatchElement(match)
  const stage = pageStageRef.value
  if (!target || !stage) {
    scrollToPage(match.pageNumber, behavior)
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

function applySearchHighlights(): void {
  if (pagedTextLayer && viewMode.value === 'paged') {
    applySearchHighlightsToLayer(pageNumber.value, pagedTextLayer)
  }

  for (const [page, layer] of scrollTextLayers) {
    applySearchHighlightsToLayer(page, layer)
  }
}

function applySearchHighlightsToLayer(page: number, layer: PdfTextLayer): void {
  const pageMatches = searchMatches.value.filter(match => match.pageNumber === page)
  const activeMatch = searchMatches.value[activeSearchIndex.value]
  const container = getTextLayerContainer(layer)
  if (!container) {
    return
  }

  container
    .querySelectorAll('.pdf-viewer__search-match')
    .forEach(marker => marker.remove())
  container.removeAttribute('data-pdf-has-highlight')

  layer.textDivs.forEach((textDiv) => {
    delete textDiv.dataset.pdfSearchMatch
  })

  const containerRect = container.getBoundingClientRect()
  for (const match of pageMatches) {
    for (const spanRange of match.spanRanges) {
      const textDiv = layer.textDivs[spanRange.spanIndex]
      if (!textDiv) {
        continue
      }

      textDiv.dataset.pdfSearchMatch = match.id
      const textNode = textDiv.firstChild
      if (!(textNode instanceof Text) || spanRange.start >= spanRange.end) {
        continue
      }

      const range = document.createRange()
      range.setStart(textNode, Math.min(spanRange.start, textNode.length))
      range.setEnd(textNode, Math.min(spanRange.end, textNode.length))

      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) {
          continue
        }

        const marker = document.createElement('span')
        marker.className = activeMatch?.id === match.id
          ? 'pdf-viewer__search-match pdf-viewer__search-match--active'
          : 'pdf-viewer__search-match'
        marker.dataset.pdfSearchMatch = match.id
        marker.style.inlineSize = `${rect.width}px`
        marker.style.blockSize = `${rect.height}px`
        marker.style.insetInlineStart = `${rect.left - containerRect.left}px`
        marker.style.insetBlockStart = `${rect.top - containerRect.top}px`
        container.append(marker)
      }

      range.detach()
    }
  }

  if (container.querySelector('.pdf-viewer__search-match')) {
    container.dataset.pdfHasHighlight = 'true'
  }
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
  const activeMarker = container?.querySelector<HTMLElement>(
    `.pdf-viewer__search-match--active[data-pdf-search-match="${CSS.escape(match.id)}"]`,
  )
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
    emit('searchChange', {
      activeIndex: -1,
      announcement: '正在读取 PDF 文本…',
      statusText: '正在读取…',
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
    const ratio = window.devicePixelRatio || 1
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas context is not available')
    }

    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.inlineSize = `${viewport.width}px`
    canvas.style.blockSize = `${viewport.height}px`

    renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    })

    await renderTask.promise

    if (sequence === renderSequence) {
      if (props.searchQuery.trim()) {
        await renderPagedTextLayer(viewport, sequence)
      }
      else {
        clearPagedTextLayer()
      }
      renderState.value = 'idle'
      queueSideControlPositionUpdate()
    }
  }
  catch (reason) {
    if (isPdfCancellation(reason)) {
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
  if (!container || sequence !== renderSequence) {
    return
  }

  clearPagedTextLayer()
  pagedTextLayer = await renderTextLayer({
    container,
    pageNumber: pageNumber.value,
    viewport,
  })

  if (sequence !== renderSequence) {
    clearPagedTextLayer()
    return
  }

  applySearchHighlightsToLayer(pageNumber.value, pagedTextLayer)
}

async function renderScrollTextLayer(pageNumberToRender: number, viewport: PdfPageViewport): Promise<void> {
  const container = scrollTextLayerElements.get(pageNumberToRender)
  if (!container || !bufferedScrollPages.value.has(pageNumberToRender)) {
    return
  }

  clearScrollTextLayer(pageNumberToRender)
  const layer = await renderTextLayer({
    container,
    pageNumber: pageNumberToRender,
    viewport,
  })

  if (!bufferedScrollPages.value.has(pageNumberToRender)) {
    clearScrollTextLayer(pageNumberToRender)
    return
  }

  scrollTextLayers.set(pageNumberToRender, layer)
  applySearchHighlightsToLayer(pageNumberToRender, layer)
}

async function renderTextLayer(options: {
  container: HTMLDivElement
  pageNumber: number
  viewport: PdfPageViewport
}): Promise<PdfTextLayer> {
  const pdfjs = await loadPdfJs()
  const pageText = await getCachedPageText(options.pageNumber)
  options.container.replaceChildren()
  options.container.style.inlineSize = `${options.viewport.width}px`
  options.container.style.blockSize = `${options.viewport.height}px`
  options.container.style.setProperty('--total-scale-factor', String(options.viewport.scale))
  options.container.style.setProperty('--scale-factor', String(options.viewport.scale))
  options.container.style.setProperty('--user-unit', '1')
  pdfjs.setLayerDimensions(options.container, options.viewport)

  const layer = new pdfjs.TextLayer({
    container: options.container,
    textContentSource: pageText.textContent,
    viewport: options.viewport,
  })
  await layer.render()

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
  scaleMode.value = nextMode
  if (nextMode === 'custom') {
    customScale.value = renderedScale.value
  }
}

function zoomBy(delta: number): void {
  customScale.value = clampScale(renderedScale.value + delta)
  scaleMode.value = 'custom'
}

function goToPreviousPage(): void {
  goToPage(clampPageNumber(pageNumber.value - 1))
}

function goToNextPage(): void {
  goToPage(clampPageNumber(pageNumber.value + 1))
}

function goToPage(nextPageNumber: number, behavior: ScrollBehavior = getPreferredScrollBehavior()): void {
  const nextPage = clampPageNumber(nextPageNumber)

  if (viewMode.value === 'scroll') {
    scrollToPage(nextPage, behavior)
    return
  }

  pageNumber.value = nextPage
}

function setPageFromInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const value = Number.parseInt(input.value, 10)
  goToPage(Number.isFinite(value) ? value : pageNumber.value)
  input.value = String(pageNumber.value)
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
  void loadPdfDocument()
}

function setViewMode(nextMode: PdfViewMode): void {
  if (viewMode.value === nextMode) {
    return
  }

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
    await cancelRenderTask()
    await prepareScrollMode(options.anchorPage)
    return
  }

  await cancelScrollRenderTasks()
  bufferedScrollPages.value = new Set()
  await renderCurrentPage()
}

async function prepareScrollMode(anchorPage: number): Promise<void> {
  const pdf = pdfDocument

  if (!pdf || loadState.value !== 'ready') {
    return
  }

  const sequence = ++scrollMeasureSequence
  scrollModeStatus.value = 'measuring'
  await cancelScrollRenderTasks()

  try {
    const firstPage = await pdf.getPage(1)
    if (sequence !== scrollMeasureSequence) {
      return
    }

    const scale = calculateScale(firstPage)
    renderedScale.value = scale
    const slots: PdfPageSlot[] = []

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = pageIndex === 1 ? firstPage : await pdf.getPage(pageIndex)
      if (sequence !== scrollMeasureSequence) {
        return
      }

      const viewport = page.getViewport({ scale })
      slots.push({
        pageNumber: pageIndex,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        renderState: 'idle',
        errorMessage: '',
      })
    }

    if (sequence !== scrollMeasureSequence) {
      return
    }

    pageSlots.value = slots
    scrollModeStatus.value = 'idle'
    pageNumber.value = clampPageNumber(anchorPage)

    await nextTick()
    setupScrollPageObserver()
    scrollToPage(pageNumber.value, 'auto')
    updateBufferedScrollPages()
    queueSideControlPositionUpdate()
  }
  catch (reason) {
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
    scrollPageObserver?.observe(element)
    return
  }

  intersectingScrollPages.delete(page)
  scrollPageElements.delete(page)
}

function setScrollCanvasElement(page: number, element: unknown): void {
  if (element instanceof HTMLCanvasElement) {
    scrollCanvasElements.set(page, element)
    void nextTick(() => renderScrollPage(page))
    return
  }

  scrollCanvasElements.delete(page)
  updatePageSlot(page, { renderState: 'idle' })
}

function setScrollTextLayerElement(page: number, element: unknown): void {
  if (element instanceof HTMLDivElement) {
    scrollTextLayerElements.set(page, element)
    void nextTick(() => {
      if (props.searchQuery.trim() && shouldRenderScrollPage(page)) {
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

function handleStageScroll(): void {
  if (viewMode.value !== 'scroll') {
    queueSideControlPositionUpdate()
    return
  }

  updateBufferedScrollPages()
  emitProgress()
  queueSideControlPositionUpdate()

  window.clearTimeout(scrollPositionSyncTimer)
  scrollPositionSyncTimer = window.setTimeout(() => {
    const dominantPage = getDominantVisiblePage()
    if (dominantPage) {
      pageNumber.value = dominantPage
      emitPosition()
    }
  }, 100)
}

function setupScrollPageObserver(): void {
  const stage = pageStageRef.value
  if (!stage) {
    return
  }

  scrollPageObserver?.disconnect()
  intersectingScrollPages.clear()
  scrollPageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const page = Number((entry.target as HTMLElement).dataset.pageNumber)
      if (!Number.isFinite(page)) {
        continue
      }

      if (entry.isIntersecting) {
        intersectingScrollPages.add(page)
      }
      else {
        intersectingScrollPages.delete(page)
      }
    }

    updateBufferedScrollPages()
  }, { root: stage, threshold: 0 })

  for (const element of scrollPageElements.values()) {
    scrollPageObserver.observe(element)
  }
}

function updateBufferedScrollPages(): void {
  if (viewMode.value !== 'scroll' || pageSlots.value.length === 0) {
    return
  }

  const visiblePages = getVisibleScrollPages()
  const dominantPage = getDominantVisiblePage()
  const observerPages = [...intersectingScrollPages].sort((left, right) => left - right)
  const measuredPages = [...new Set([...visiblePages, ...observerPages])].sort((left, right) => left - right)
  const anchorPages = measuredPages.length > 0 ? measuredPages : [dominantPage ?? pageNumber.value]
  const nextPages = new Set<number>()

  for (const page of anchorPages) {
    const center = clampPageNumber(page)
    for (let offset = -2; offset <= 2; offset += 1) {
      nextPages.add(clampPageNumber(center + offset))
    }
  }

  for (const page of [...bufferedScrollPages.value]) {
    if (!nextPages.has(page)) {
      void cancelScrollRenderTask(page)
      clearScrollTextLayer(page)
      updatePageSlot(page, { renderState: 'idle' })
    }
  }

  bufferedScrollPages.value = nextPages

  void nextTick(() => {
    for (const page of nextPages) {
      void renderScrollPage(page)
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

function getVisibleScrollPages(): number[] {
  const stage = pageStageRef.value
  if (!stage) {
    return []
  }

  const stageRect = stage.getBoundingClientRect()
  const pages: number[] = []

  for (const [page, element] of scrollPageElements) {
    const rect = element.getBoundingClientRect()
    const overlap = Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top)
    if (overlap > 0) {
      pages.push(page)
    }
  }

  return pages.sort((left, right) => left - right)
}

function getDominantVisiblePage(): number | null {
  const stage = pageStageRef.value
  if (!stage) {
    return null
  }

  const stageRect = stage.getBoundingClientRect()
  let bestPage: number | null = null
  let bestVisibleArea = -1

  for (const [page, element] of scrollPageElements) {
    const rect = element.getBoundingClientRect()
    const visibleBlock = Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top)
    if (visibleBlock <= 0) {
      continue
    }

    const visibleArea = visibleBlock * Math.max(1, Math.min(rect.width, stageRect.width))
    if (visibleArea > bestVisibleArea) {
      bestVisibleArea = visibleArea
      bestPage = page
    }
  }

  return bestPage
}

async function renderScrollPage(page: number): Promise<void> {
  const pdf = pdfDocument
  const canvas = scrollCanvasElements.get(page)

  if (!pdf || !canvas || loadState.value !== 'ready' || viewMode.value !== 'scroll') {
    return
  }

  const slot = pageSlots.value.find(item => item.pageNumber === page)
  if (!slot || slot.renderState === 'rendering') {
    return
  }

  if (slot.renderState === 'ready') {
    if (props.searchQuery.trim()) {
      await ensureScrollTextLayer(page)
    }
    return
  }

  const sequence = (scrollRenderSequences.get(page) ?? 0) + 1
  scrollRenderSequences.set(page, sequence)
  updatePageSlot(page, { renderState: 'rendering', errorMessage: '' })
  await cancelScrollRenderTask(page)

  try {
    const pdfPage = await pdf.getPage(page)
    if (scrollRenderSequences.get(page) !== sequence || !bufferedScrollPages.value.has(page)) {
      return
    }

    const viewport = pdfPage.getViewport({ scale: renderedScale.value })
    const ratio = window.devicePixelRatio || 1
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas context is not available')
    }

    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.inlineSize = `${viewport.width}px`
    canvas.style.blockSize = `${viewport.height}px`

    const task = pdfPage.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    })
    scrollRenderTasks.set(page, task)

    await task.promise

    if (scrollRenderSequences.get(page) === sequence) {
      if (props.searchQuery.trim()) {
        await renderScrollTextLayer(page, viewport)
      }
      else {
        clearScrollTextLayer(page)
      }
      updatePageSlot(page, { renderState: 'ready' })
    }
  }
  catch (reason) {
    if (isPdfCancellation(reason)) {
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
  const pdf = pdfDocument
  const container = scrollTextLayerElements.get(page)

  if (!pdf || !container || !bufferedScrollPages.value.has(page) || viewMode.value !== 'scroll') {
    return
  }

  const layer = scrollTextLayers.get(page)
  if (layer) {
    applySearchHighlightsToLayer(page, layer)
    return
  }

  const pdfPage = await pdf.getPage(page)
  const viewport = pdfPage.getViewport({ scale: renderedScale.value })
  await renderScrollTextLayer(page, viewport)
}

async function cancelScrollRenderTask(page: number): Promise<void> {
  const task = scrollRenderTasks.get(page)
  if (!task) {
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
  pageSlots.value = pageSlots.value.map(slot =>
    slot.pageNumber === page ? { ...slot, ...patch } : slot,
  )
}

function scrollToPage(page: number, behavior: ScrollBehavior = getPreferredScrollBehavior()): void {
  const nextPage = clampPageNumber(page)
  pageNumber.value = nextPage

  void nextTick(() => {
    const stage = pageStageRef.value
    const element = scrollPageElements.get(nextPage)
    if (!stage || !element) {
      return
    }

    const stageRect = stage.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const nextTop = stage.scrollTop + elementRect.top - stageRect.top
    stage.scrollTo({ top: Math.max(0, nextTop), behavior })
    updateBufferedScrollPages()
    queueSideControlPositionUpdate()
    emitPosition()
  })
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
  void loadPdfDocument()
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

  void loadPdfDocument()
})

onUnmounted(() => {
  if (sideControlFrame !== undefined) {
    window.cancelAnimationFrame(sideControlFrame)
  }
  window.clearTimeout(scrollPositionSyncTimer)
  resizeObserver?.disconnect()
  void cleanupPdfDocument()
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

    <div class="pdf-viewer__toolbar" aria-label="PDF 查看工具">
      <div class="pdf-viewer__control-group" aria-label="页码">
        <button type="button" :disabled="!canGoToPreviousPage" aria-label="上一页" @click="goToPreviousPage">
          ◁
        </button>
        <label class="pdf-viewer__page-jump">
          <span class="pdf-viewer__sr-only">跳转页码</span>
          <input
            :value="pageNumber"
            inputmode="numeric"
            pattern="[0-9]*"
            aria-label="跳转页码"
            :disabled="!isReady"
            @change="setPageFromInput"
            @keydown.enter.prevent="setPageFromInput"
          >
        </label>
        <span class="pdf-viewer__page-total" aria-live="polite">{{ pageLabel }}</span>
        <button type="button" :disabled="!canGoToNextPage" aria-label="下一页" @click="goToNextPage">
          ▷
        </button>
      </div>

      <div class="pdf-viewer__control-group" aria-label="查看模式">
        <button
          type="button"
          :aria-pressed="viewMode === 'paged'"
          :disabled="!isReady"
          @click="setViewMode('paged')"
        >
          翻页
        </button>
        <button
          type="button"
          :aria-pressed="viewMode === 'scroll'"
          :disabled="!isReady"
          @click="setViewMode('scroll')"
        >
          滚动
        </button>
      </div>

      <div class="pdf-viewer__control-group" aria-label="缩放">
        <button type="button" :disabled="!isReady" aria-label="缩小" @click="zoomBy(-zoomStep)">
          −
        </button>
        <button
          type="button"
          :aria-pressed="scaleMode === 'fit-width'"
          :disabled="!isReady"
          @click="setScaleMode('fit-width')"
        >
          适宽
        </button>
        <button
          type="button"
          :aria-pressed="scaleMode === 'fit-page'"
          :disabled="!isReady"
          @click="setScaleMode('fit-page')"
        >
          整页
        </button>
        <span class="pdf-viewer__zoom-label">{{ scaleModeLabel }}</span>
        <button type="button" :disabled="!isReady" aria-label="放大" @click="zoomBy(zoomStep)">
          ＋
        </button>
      </div>
    </div>

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
        data-testid="pdf-viewer-stage"
        @scroll="handleStageScroll"
      >
        <div v-if="loadState === 'loading'" class="pdf-viewer__state" role="status">
          正在打开 PDF…
        </div>

        <div v-else-if="loadState === 'error'" class="pdf-viewer__state pdf-viewer__state--error" role="alert">
          <p>{{ errorMessage }}</p>
          <button type="button" @click="retry">
            再试一次
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

        <div v-else class="pdf-viewer__scroll-stack" data-testid="pdf-viewer-scroll-stack">
          <div v-if="scrollModeStatus === 'measuring'" class="pdf-viewer__state" role="status">
            正在准备连续滚动…
          </div>
          <div v-else-if="scrollModeStatus === 'error'" class="pdf-viewer__state pdf-viewer__state--error" role="alert">
            {{ errorMessage }}
          </div>
          <template v-else>
            <article
              v-for="slot in pageSlots"
              :key="slot.pageNumber"
              :ref="element => setScrollPageElement(slot.pageNumber, element)"
              class="pdf-viewer__scroll-page-slot"
              :style="{ inlineSize: `${slot.width}px`, blockSize: `${slot.height}px` }"
              :aria-label="`PDF 第 ${slot.pageNumber} 页, 共 ${totalPages} 页`"
              :data-page-number="slot.pageNumber"
              data-testid="pdf-viewer-scroll-page"
            >
              <canvas
                v-if="shouldRenderScrollPage(slot.pageNumber)"
                :ref="element => setScrollCanvasElement(slot.pageNumber, element)"
                class="pdf-viewer__canvas pdf-viewer__canvas--scroll"
                :aria-label="`PDF 第 ${slot.pageNumber} 页, 共 ${totalPages} 页`"
                data-testid="pdf-viewer-scroll-canvas"
              />
              <div
                v-if="shouldRenderScrollPage(slot.pageNumber)"
                :ref="element => setScrollTextLayerElement(slot.pageNumber, element)"
                class="pdf-viewer__text-layer textLayer"
                aria-hidden="true"
                data-testid="pdf-viewer-scroll-text-layer"
              />
              <div v-else class="pdf-viewer__scroll-placeholder" aria-hidden="true" />
              <p v-if="slot.renderState === 'rendering'" class="pdf-viewer__render-status" role="status">
                正在渲染第 {{ slot.pageNumber }} 页…
              </p>
              <p v-else-if="slot.renderState === 'error'" class="pdf-viewer__render-status pdf-viewer__render-status--error" role="alert">
                {{ slot.errorMessage }}
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
.pdf-viewer__toolbar button,
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
.pdf-viewer__toolbar button:hover,
.pdf-viewer__toolbar button:focus-visible,
.pdf-viewer__state button:hover,
.pdf-viewer__state button:focus-visible {
  border-color: var(--accent-primary);
  color: var(--text-primary);
}

.pdf-viewer__toolbar button:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.pdf-viewer__toolbar button[aria-pressed="true"] {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
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

.pdf-viewer__toolbar {
  position: sticky;
  top: max(5.5rem, calc(env(safe-area-inset-top) + 5.5rem));
  z-index: var(--z-sticky);
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2-5);
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-3-5);
  padding: var(--spacing-2);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
}

.pdf-viewer__control-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.pdf-viewer__toolbar button {
  min-inline-size: 44px;
  padding-inline: 0.72rem;
}

.pdf-viewer__page-jump input {
  inline-size: 4rem;
  min-block-size: 44px;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface-subtle);
  font: inherit;
  text-align: center;
}

.pdf-viewer__page-total,
.pdf-viewer__zoom-label {
  min-inline-size: 3.8rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
  text-align: center;
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
  display: grid;
  gap: 1.1rem;
  justify-items: center;
  min-inline-size: max-content;
}

.pdf-viewer__scroll-page-slot {
  position: relative;
  display: grid;
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

.pdf-viewer__sr-only {
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

  .pdf-viewer__toolbar {
    position: static;
    align-items: stretch;
  }

  .pdf-viewer__control-group {
    inline-size: 100%;
  }

  .pdf-viewer__control-group > button,
  .pdf-viewer__page-jump,
  .pdf-viewer__page-jump input {
    flex: 1 1 auto;
  }

  .pdf-viewer__stage {
    max-inline-size: calc(100vw - 2.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pdf-viewer__toolbar,
  .pdf-viewer__side-page-button {
    backdrop-filter: none;
  }

  .pdf-viewer__side-page-button {
    transition: none;
  }
}
</style>
