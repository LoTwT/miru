<script setup lang="ts">
import { nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  canBookmark: boolean
  canSearch: boolean
  isFetchingUrl: boolean
  isOpen: boolean
  searchUnavailableText: string
  status: string
  urlConflict: {
    domain: string
    title: string
  } | null
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  bookmark: []
  paste: []
  openFile: [file: File]
  openLibrary: []
  openExistingUrl: []
  fetchUrl: [url: string]
  updateExistingUrl: []
  search: []
  clear: []
  print: []
}>()

const url = shallowRef('')
const rootRef = useTemplateRef<HTMLElement>('root')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')
const urlInputRef = useTemplateRef<HTMLInputElement>('urlInput')

function closeMenu(): void {
  emit('update:isOpen', false)
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    return
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return
  }

  const items = getMenuItems()
  const activeIndex = items.findIndex(item => item === document.activeElement)

  if (activeIndex === -1) {
    return
  }

  event.preventDefault()
  const offset = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex = (activeIndex + offset + items.length) % items.length
  items[nextIndex]?.focus()
}

function focusFirstMenuItem(): void {
  window.setTimeout(() => {
    getMenuItems()[0]?.focus()
  }, 0)
}

function getMenuItems(): HTMLElement[] {
  return Array.from(rootRef.value?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])
    .filter(element => !element.hasAttribute('disabled'))
}

function openFileDialog(): void {
  fileInputRef.value?.click()
}

function openLibrary(): void {
  closeMenu()
  emit('openLibrary')
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (file) {
    closeMenu()
    emit('openFile', file)
  }

  input.value = ''
}

function submitUrl(): void {
  const trimmed = url.value.trim()

  if (!trimmed) {
    urlInputRef.value?.focus()
    return
  }

  emit('fetchUrl', trimmed)
}

function clearDocument(): void {
  closeMenu()
  emit('clear')
}

function requestPaste(): void {
  emit('paste')
}

function requestSearch(): void {
  if (!props.canSearch) {
    return
  }

  emit('search')
}

function bookmarkCurrentPosition(): void {
  if (!props.canBookmark) {
    return
  }

  closeMenu()
  emit('bookmark')
}

function printDocument(): void {
  closeMenu()
  emit('print')
}

watch(() => props.isOpen, async (isOpen) => {
  if (!isOpen) {
    return
  }

  await nextTick()
  focusFirstMenuItem()
})

onMounted(() => {
  if (props.isOpen) {
    focusFirstMenuItem()
  }
})
</script>

<template>
  <section
    v-if="props.isOpen"
    id="floating-input-menu"
    ref="root"
    class="floating-input"
    aria-labelledby="floating-input-title"
    data-testid="floating-affordance-menu"
    @keydown="onMenuKeydown"
  >
    <div class="floating-input__handle" aria-hidden="true" />

    <header class="floating-input__header">
      <div>
        <h2 id="floating-input-title" class="floating-input__title">
          文档操作
        </h2>
        <p class="floating-input__caption">
          加载、导入或整理当前阅读
        </p>
      </div>
      <button class="floating-input__close" type="button" aria-label="关闭文档操作" @click="closeMenu">
        ×
      </button>
    </header>

    <button
      class="floating-input__item"
      type="button"
      :disabled="!props.canSearch"
      data-menu-item
      @click="requestSearch"
    >
      <span>搜索</span>
      <small>{{ props.canSearch ? 'Cmd/Ctrl+F' : props.searchUnavailableText }}</small>
    </button>

    <button
      class="floating-input__item"
      type="button"
      :disabled="!props.canBookmark"
      data-menu-item
      @click="bookmarkCurrentPosition"
    >
      <span>书签此处</span>
      <small>{{ props.canBookmark ? '保存当前位置' : '打开文档后可用' }}</small>
    </button>

    <button
      class="floating-input__item"
      type="button"
      data-menu-item
      @click="requestPaste"
    >
      <span>粘贴</span>
      <small>也可按 Cmd/Ctrl+V</small>
    </button>

    <form class="floating-input__url" @submit.prevent="submitUrl">
      <label class="floating-input__label" for="floating-url-input">URL 导入</label>
      <div class="floating-input__url-row">
        <input
          id="floating-url-input"
          ref="urlInput"
          v-model="url"
          class="floating-input__url-input"
          type="url"
          inputmode="url"
          placeholder="https://example.com/readme.md"
          data-menu-item
        >
        <button
          class="floating-input__fetch"
          type="submit"
          :disabled="props.isFetchingUrl"
          data-menu-item
        >
          {{ props.isFetchingUrl ? '拉取中' : '拉取' }}
        </button>
      </div>
    </form>

    <div
      v-if="props.urlConflict"
      class="floating-input__url-conflict"
      role="group"
      aria-label="重复 URL 导入"
      data-testid="url-import-conflict"
    >
      <p>该链接已在文库中</p>
      <small>
        {{ props.urlConflict.title }}<template v-if="props.urlConflict.domain"> · {{ props.urlConflict.domain }}</template>
      </small>
      <div class="floating-input__url-conflict-actions">
        <button
          class="floating-input__url-conflict-button"
          type="button"
          data-menu-item
          @click="emit('openExistingUrl')"
        >
          打开已有
        </button>
        <button
          class="floating-input__url-conflict-button floating-input__url-conflict-button--primary"
          type="button"
          :disabled="props.isFetchingUrl"
          data-menu-item
          @click="emit('updateExistingUrl')"
        >
          更新到最新
        </button>
      </div>
    </div>

    <button
      class="floating-input__item"
      type="button"
      data-menu-item
      @click="openFileDialog"
    >
      <span>打开文件</span>
      <small>.md / .txt / .pdf</small>
    </button>

    <button
      class="floating-input__item"
      type="button"
      data-menu-item
      @click="openLibrary"
    >
      <span>文库</span>
      <small>本机保存的文档</small>
    </button>

    <button
      class="floating-input__item"
      type="button"
      data-menu-item
      @click="printDocument"
    >
      <span>打印 / 保存 PDF</span>
      <small>使用浏览器打印</small>
    </button>

    <button
      class="floating-input__item floating-input__item--danger"
      type="button"
      data-menu-item
      @click="clearDocument"
    >
      <span>清空当前</span>
      <small>回到示例文档 · 不影响文库</small>
    </button>

    <p
      v-if="props.isFetchingUrl || props.status"
      class="floating-input__status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span v-if="props.isFetchingUrl">正在拉取 URL…</span>
      <span v-if="props.status">{{ props.status }}</span>
    </p>

    <input
      ref="fileInput"
      class="floating-input__file"
      type="file"
      @change="onFileChange"
    >
  </section>
</template>

<style scoped>
.floating-input {
  inline-size: min(22rem, calc(100vw - 2rem));
  position: relative;
  z-index: var(--z-raised);
  padding: var(--spacing-3);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  box-shadow: var(--shadow-panel);
  transition: var(--transition-surface);
}

.floating-input__handle {
  display: none;
}

.floating-input__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.8rem;
}

.floating-input__title,
.floating-input__caption {
  margin: 0;
}

.floating-input__title {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-md);
  line-height: var(--leading-tight);
}

.floating-input__caption {
  margin-block-start: 0.2rem;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.floating-input__close {
  display: grid;
  place-items: center;
  inline-size: var(--touch-target-min);
  block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
}

.floating-input__item,
.floating-input__fetch {
  border: var(--border-width-control) solid var(--border-default);
  background: var(--surface-elevated);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
}

.floating-input__item {
  display: grid;
  inline-size: 100%;
  min-block-size: var(--touch-target-min);
  margin-block-end: 0.45rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-control);
  text-align: left;
}

.floating-input__item small {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.floating-input__item:not(.floating-input__item--danger):hover,
.floating-input__item:not(.floating-input__item--danger):focus-visible,
.floating-input__fetch:hover,
.floating-input__fetch:focus-visible,
.floating-input__close:hover,
.floating-input__close:focus-visible {
  border-color: var(--accent-primary);
}

.floating-input__item:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.floating-input__item:disabled:hover {
  border-color: var(--border-default);
}

.floating-input__item--danger {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.floating-input__item--danger:hover,
.floating-input__item--danger:focus-visible,
.floating-input__item--danger:disabled:hover {
  border-color: var(--status-danger-border);
}

.floating-input__url {
  margin-block-end: 0.45rem;
}

.floating-input__label {
  display: block;
  margin-block-end: 0.35rem;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.floating-input__url-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
}

.floating-input__url-input,
.floating-input__fetch {
  min-block-size: var(--touch-target-min);
  border-radius: var(--radius-control);
}

.floating-input__url-input {
  min-inline-size: 0;
  padding-inline: 0.75rem;
  border: var(--border-width-control) solid var(--border-default);
  background: var(--surface-elevated);
  color: var(--text-primary);
  font: inherit;
}

.floating-input__fetch {
  padding-inline: 0.78rem;
}

.floating-input__fetch:disabled {
  cursor: progress;
  opacity: var(--opacity-muted);
}

.floating-input__url-conflict {
  display: grid;
  gap: 0.65rem;
  margin-block: 0 0.55rem;
  padding: 0.72rem;
  border: var(--border-width-surface) solid var(--status-info-border);
  border-radius: var(--radius-card);
  background: var(--status-info-bg);
}

.floating-input__url-conflict p,
.floating-input__url-conflict small {
  margin: 0;
}

.floating-input__url-conflict p {
  color: var(--status-info-fg);
  font-weight: 620;
}

.floating-input__url-conflict small {
  color: var(--status-info-fg);
  overflow-wrap: anywhere;
}

.floating-input__url-conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.floating-input__url-conflict-button {
  min-block-size: var(--touch-target-min);
  padding-inline: 0.78rem;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface-elevated);
  cursor: pointer;
  font: inherit;
}

.floating-input__url-conflict-button:hover,
.floating-input__url-conflict-button:focus-visible {
  border-color: var(--accent-primary);
}

.floating-input__url-conflict-button--primary {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
}

.floating-input__status {
  margin: 0.2rem 0 0;
  padding: 0.6rem 0.7rem;
  border: var(--border-width-surface) solid var(--border-subtle);
  border-radius: var(--radius-card);
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.floating-input__status > span {
  display: block;
}

.floating-input__status > span + span {
  margin-block-start: 0.35rem;
}

.floating-input__file {
  display: none;
}

@media (max-width: 640px) {
  .floating-input {
    inline-size: 100vw;
    max-block-size: min(72vh, 34rem);
    overflow-y: auto;
    padding: 0.72rem 1rem max(1rem, calc(env(safe-area-inset-bottom) + 1rem));
    border-inline: 0;
    border-block-end: 0;
    border-radius: var(--radius-card) var(--radius-card) 0 0;
  }

  .floating-input__handle {
    display: block;
    inline-size: 2.7rem;
    block-size: 0.28rem;
    margin: 0 auto 0.7rem;
    border-radius: var(--radius-full);
    background: var(--border-default);
  }
}
</style>
