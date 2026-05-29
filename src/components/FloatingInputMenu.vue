<script setup lang="ts">
import { nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  isFetchingUrl: boolean
  isOpen: boolean
  status: string
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  paste: []
  openFile: [file: File]
  openLibrary: []
  fetchUrl: [url: string]
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

    <p v-if="props.isFetchingUrl" class="floating-input__status" role="status">
      正在拉取 URL…
    </p>
    <p v-else-if="props.status" class="floating-input__status" role="status" aria-live="polite">
      {{ props.status }}
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
  padding: 0.8rem;
  border: 1px solid var(--reading-rule);
  border-radius: 18px;
  background: color-mix(in srgb, var(--reading-bg) 94%, transparent);
  box-shadow: 0 18px 44px rgb(0 0 0 / 16%);
  backdrop-filter: blur(16px);
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
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: 1.05rem;
  line-height: 1.2;
}

.floating-input__caption {
  margin-block-start: 0.2rem;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
}

.floating-input__close {
  display: grid;
  place-items: center;
  inline-size: 44px;
  block-size: 44px;
  border: 1px solid var(--reading-rule);
  border-radius: 50%;
  background: var(--reading-bg);
  color: var(--reading-fg-muted);
  cursor: pointer;
  font: inherit;
}

.floating-input__item,
.floating-input__fetch {
  border: 1px solid var(--reading-rule);
  background: var(--reading-bg);
  color: var(--reading-fg);
  cursor: pointer;
  font: inherit;
}

.floating-input__item {
  display: grid;
  inline-size: 100%;
  min-block-size: 44px;
  margin-block-end: 0.45rem;
  padding: 0.55rem 0.75rem;
  border-radius: 12px;
  text-align: left;
}

.floating-input__item small {
  color: var(--reading-fg-muted);
  font-size: 0.78rem;
}

.floating-input__item:hover,
.floating-input__item:focus-visible,
.floating-input__fetch:hover,
.floating-input__fetch:focus-visible,
.floating-input__close:hover,
.floating-input__close:focus-visible {
  border-color: var(--reading-accent);
}

.floating-input__item--danger {
  color: var(--reading-accent);
}

.floating-input__url {
  margin-block-end: 0.45rem;
}

.floating-input__label {
  display: block;
  margin-block-end: 0.35rem;
  color: var(--reading-fg-muted);
  font-size: 0.78rem;
}

.floating-input__url-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
}

.floating-input__url-input,
.floating-input__fetch {
  min-block-size: 44px;
  border-radius: 12px;
}

.floating-input__url-input {
  min-inline-size: 0;
  padding-inline: 0.75rem;
  border: 1px solid var(--reading-rule);
  background: var(--reading-bg);
  color: var(--reading-fg);
  font: inherit;
}

.floating-input__fetch {
  padding-inline: 0.78rem;
}

.floating-input__fetch:disabled {
  cursor: progress;
  opacity: 0.65;
}

.floating-input__status {
  margin: 0.2rem 0 0;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--reading-rule);
  border-radius: 12px;
  background: var(--reading-code-bg);
  color: var(--reading-fg-muted);
  font-size: 0.86rem;
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
    border-radius: 18px 18px 0 0;
  }

  .floating-input__handle {
    display: block;
    inline-size: 2.7rem;
    block-size: 0.28rem;
    margin: 0 auto 0.7rem;
    border-radius: 999px;
    background: var(--reading-rule);
  }
}
</style>
