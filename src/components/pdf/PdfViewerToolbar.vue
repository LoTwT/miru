<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue'

import type { PdfReadingPosition } from '@/features/library/types'

type PdfScaleMode = PdfReadingPosition['scaleMode']
type PdfViewMode = PdfReadingPosition['viewMode']

const props = defineProps<{
  canGoToNextPage: boolean
  canGoToPreviousPage: boolean
  isReady: boolean
  pageNumber: number
  renderedScale: number
  scaleMode: PdfScaleMode
  totalPages: number
  viewMode: PdfViewMode
}>()

const emit = defineEmits<{
  nextPage: []
  previousPage: []
  requestPage: [pageNumber: number | null]
  selectScaleMode: [mode: PdfScaleMode]
  selectViewMode: [mode: PdfViewMode]
  zoomIn: []
  zoomOut: []
}>()

const pageInputValue = shallowRef(String(props.pageNumber))
let isPageInputEditing = false

const pageLabel = computed(() => props.totalPages > 0 ? `${props.pageNumber} / ${props.totalPages}` : '— / —')
const zoomLabel = computed(() => `${Math.round(props.renderedScale * 100)}%`)
const scaleModeLabel = computed(() => {
  if (props.scaleMode === 'fit-page') {
    return '整页'
  }

  if (props.scaleMode === 'custom') {
    return zoomLabel.value
  }

  return '适宽'
})

async function setPageFromInput(): Promise<void> {
  const value = Number.parseInt(pageInputValue.value, 10)
  isPageInputEditing = false
  emit('requestPage', Number.isFinite(value) ? value : null)
  await nextTick()
  pageInputValue.value = String(props.pageNumber)
}

function beginPageInputEdit(): void {
  isPageInputEditing = true
}

function endPageInputEdit(): void {
  isPageInputEditing = false
  pageInputValue.value = String(props.pageNumber)
}

function updatePageInput(event: Event): void {
  isPageInputEditing = true
  pageInputValue.value = (event.target as HTMLInputElement).value
}

watch(() => props.pageNumber, () => {
  if (!isPageInputEditing) {
    pageInputValue.value = String(props.pageNumber)
  }
})

watch(() => props.isReady, (isReady) => {
  if (!isReady) {
    isPageInputEditing = false
    pageInputValue.value = String(props.pageNumber)
  }
})
</script>

<template>
  <div class="pdf-viewer__toolbar" aria-label="PDF 查看工具">
    <div class="pdf-viewer__control-group" aria-label="页码">
      <button type="button" :disabled="!props.canGoToPreviousPage" aria-label="上一页" @click="emit('previousPage')">
        ◁
      </button>
      <label class="pdf-viewer__page-jump">
        <span class="pdf-viewer__sr-only">跳转页码</span>
        <input
          :value="pageInputValue"
          inputmode="numeric"
          pattern="[0-9]*"
          aria-label="跳转页码"
          :disabled="!props.isReady"
          @blur="endPageInputEdit"
          @change="setPageFromInput"
          @focus="beginPageInputEdit"
          @input="updatePageInput"
          @keydown.enter.prevent="setPageFromInput"
        >
      </label>
      <span class="pdf-viewer__page-total" aria-live="polite">{{ pageLabel }}</span>
      <button type="button" :disabled="!props.canGoToNextPage" aria-label="下一页" @click="emit('nextPage')">
        ▷
      </button>
    </div>

    <div class="pdf-viewer__control-group" aria-label="查看模式">
      <button
        type="button"
        :aria-pressed="props.viewMode === 'paged'"
        :disabled="!props.isReady"
        @click="emit('selectViewMode', 'paged')"
      >
        翻页
      </button>
      <button
        type="button"
        :aria-pressed="props.viewMode === 'scroll'"
        :disabled="!props.isReady"
        @click="emit('selectViewMode', 'scroll')"
      >
        滚动
      </button>
    </div>

    <div class="pdf-viewer__control-group" aria-label="缩放">
      <button type="button" :disabled="!props.isReady" aria-label="缩小" @click="emit('zoomOut')">
        −
      </button>
      <button
        type="button"
        :aria-pressed="props.scaleMode === 'fit-width'"
        :disabled="!props.isReady"
        @click="emit('selectScaleMode', 'fit-width')"
      >
        适宽
      </button>
      <button
        type="button"
        :aria-pressed="props.scaleMode === 'fit-page'"
        :disabled="!props.isReady"
        @click="emit('selectScaleMode', 'fit-page')"
      >
        整页
      </button>
      <span class="pdf-viewer__zoom-label">{{ scaleModeLabel }}</span>
      <button type="button" :disabled="!props.isReady" aria-label="放大" @click="emit('zoomIn')">
        ＋
      </button>
    </div>
  </div>
</template>

<style scoped>
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
  min-block-size: var(--touch-target-min);
  padding-inline: 0.72rem;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface-elevated);
  font: inherit;
  cursor: pointer;
}

.pdf-viewer__toolbar button:hover,
.pdf-viewer__toolbar button:focus-visible {
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

@media (max-width: 700px) {
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
}

@media (prefers-reduced-motion: reduce) {
  .pdf-viewer__toolbar {
    backdrop-filter: none;
  }
}
</style>
