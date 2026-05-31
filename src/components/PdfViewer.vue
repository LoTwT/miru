<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import type { LibraryEntry, PdfReadingPosition } from '@/features/library/types'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

type PdfScaleMode = PdfReadingPosition['scaleMode']
type PdfViewMode = PdfReadingPosition['viewMode']
type PdfRenderState = 'idle' | 'rendering' | 'ready' | 'error'

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
}>()

const emit = defineEmits<{
  back: []
  positionChange: [position: Omit<PdfReadingPosition, 'updatedAt'>]
}>()

const minScale = 0.35
const maxScale = 2.75
const zoomStep = 0.15

const rootRef = useTemplateRef<HTMLElement>('root')
const pageStageRef = useTemplateRef<HTMLElement>('pageStage')
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')
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

let loadingTask: PDFDocumentLoadingTask | null = null
let pdfDocument: PDFDocumentProxy | null = null
let renderTask: RenderTask | null = null
let resizeObserver: ResizeObserver | null = null
let scrollPageObserver: IntersectionObserver | null = null
let renderSequence = 0
let scrollMeasureSequence = 0
let scrollPositionSyncTimer: ReturnType<typeof window.setTimeout> | undefined
const scrollPageElements = new Map<number, HTMLElement>()
const scrollCanvasElements = new Map<number, HTMLCanvasElement>()
const scrollRenderTasks = new Map<number, RenderTask>()
const scrollRenderSequences = new Map<number, number>()
const intersectingScrollPages = new Set<number>()

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

defineExpose({ focus })

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

  if (loadingTask) {
    await loadingTask.destroy()
    loadingTask = null
  }

  if (pdfDocument) {
    await pdfDocument.destroy()
    pdfDocument = null
  }

  pageSlots.value = []
  bufferedScrollPages.value = new Set()
  scrollPageObserver?.disconnect()
  scrollPageObserver = null
  intersectingScrollPages.clear()
  scrollPageElements.clear()
  scrollCanvasElements.clear()
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
      renderState.value = 'idle'
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

function shouldRenderScrollPage(page: number): boolean {
  return bufferedScrollPages.value.has(page)
}

function handleStageScroll(): void {
  if (viewMode.value !== 'scroll') {
    return
  }

  updateBufferedScrollPages()

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
  const anchorPages = observerPages.length > 0
    ? observerPages
    : visiblePages.length > 0 ? visiblePages : [dominantPage ?? pageNumber.value]
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
      updatePageSlot(page, { renderState: 'idle' })
    }
  }

  bufferedScrollPages.value = nextPages

  void nextTick(() => {
    for (const page of nextPages) {
      void renderScrollPage(page)
    }
  })
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
  if (!slot || slot.renderState === 'ready' || slot.renderState === 'rendering') {
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

watch(pageNumber, () => {
  if (!isReady.value) {
    return
  }

  if (viewMode.value === 'paged') {
    void renderCurrentPage()
  }

  emitPosition()
})

watch([scaleMode, customScale], () => {
  if (!isReady.value) {
    return
  }

  void renderActiveView({ anchorPage: pageNumber.value })
  emitPosition()
})

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (scaleMode.value === 'custom') {
      return
    }

    void renderActiveView({ anchorPage: pageNumber.value })
  })

  if (pageStageRef.value) {
    resizeObserver.observe(pageStageRef.value)
  }

  void loadPdfDocument()
})

onUnmounted(() => {
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
      PDF 保持原样显示, 不做文字提取或上传。
    </p>

    <div
      class="pdf-viewer__stage-frame"
      :class="{ 'pdf-viewer__stage-frame--with-side-controls': hasMultiplePages }"
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
        <span aria-hidden="true">‹</span>
      </button>

      <div
        ref="pageStage"
        class="pdf-viewer__stage"
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
        <span aria-hidden="true">›</span>
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
  min-block-size: 44px;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 82%, transparent);
  border-radius: 8px;
  color: var(--reading-fg);
  background: color-mix(in srgb, var(--reading-bg) 92%, var(--reading-fg) 8%);
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
  border-color: var(--reading-accent);
  color: var(--reading-fg);
}

.pdf-viewer__toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pdf-viewer__toolbar button[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--reading-accent) 72%, transparent);
  background: color-mix(in srgb, var(--reading-accent) 12%, transparent);
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
  border: 1px solid color-mix(in srgb, var(--reading-accent) 54%, transparent);
  border-radius: 6px;
  color: var(--reading-accent);
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
  top: 0.75rem;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.85rem;
  padding: 0.55rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 70%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  box-shadow: 0 12px 34px rgb(0 0 0 / 10%);
  backdrop-filter: blur(14px);
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
  border: 1px solid color-mix(in srgb, var(--reading-rule) 82%, transparent);
  border-radius: 8px;
  color: var(--reading-fg);
  background: var(--reading-bg);
  font: inherit;
  text-align: center;
}

.pdf-viewer__page-total,
.pdf-viewer__zoom-label {
  min-inline-size: 3.8rem;
  color: var(--reading-fg-muted);
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
  border: 1px solid color-mix(in srgb, var(--reading-rule) 58%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--reading-code-bg) 54%, var(--reading-bg));
  overscroll-behavior: contain;
  overflow: auto;
}

.pdf-viewer__stage-frame {
  position: relative;
}

.pdf-viewer__side-page-button {
  position: absolute;
  inset-block-start: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  inline-size: 44px;
  min-block-size: 54px;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 78%, transparent);
  border-radius: 999px;
  color: var(--reading-fg);
  background: color-mix(in srgb, var(--reading-bg) 88%, transparent);
  box-shadow: 0 14px 32px rgb(0 0 0 / 16%);
  font: inherit;
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.58;
  transform: translateY(-50%);
  transition: opacity 160ms ease, border-color 160ms ease, color 160ms ease;
  backdrop-filter: blur(12px);
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
  color: var(--reading-accent);
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
  color: var(--reading-accent);
}

.pdf-viewer__render-status {
  position: sticky;
  bottom: 0.8rem;
  justify-self: center;
  margin: 1rem 0 0;
  padding: 0.45rem 0.7rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 72%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  color: var(--reading-fg-muted);
  font-size: 0.86rem;
}

.pdf-viewer__render-status--error {
  color: var(--reading-accent);
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
