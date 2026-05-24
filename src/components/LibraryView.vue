<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import type { LibraryEntry, LibrarySortMode } from '@/features/library/types'

const props = defineProps<{
  activeEntryId: string | null
  entries: readonly LibraryEntry[]
  sortMode: LibrarySortMode
  status: string
}>()

const emit = defineEmits<{
  add: []
  open: [entry: LibraryEntry]
  sort: [mode: LibrarySortMode]
  rename: [entry: LibraryEntry, title: string]
  togglePin: [entry: LibraryEntry]
  delete: [entry: LibraryEntry]
  clear: []
  close: []
}>()

const pendingDelete = shallowRef<LibraryEntry | null>(null)
const pendingClear = shallowRef(false)
const renamingId = shallowRef<string | null>(null)
const renameValue = shallowRef('')
const rootRef = useTemplateRef<HTMLElement>('root')
const deleteCancelRef = useTemplateRef<HTMLButtonElement>('deleteCancel')
const clearCancelRef = useTemplateRef<HTMLButtonElement>('clearCancel')
let dialogRestoreTarget: HTMLElement | null = null

const pinnedEntries = computed(() => props.entries.filter(entry => entry.pinned))
const regularEntries = computed(() => props.entries.filter(entry => !entry.pinned))
const hasEntries = computed(() => props.entries.length > 0)

function setSortMode(event: Event): void {
  const select = event.target as HTMLSelectElement
  emit('sort', select.value as LibrarySortMode)
}

function startRename(entry: LibraryEntry): void {
  renamingId.value = entry.id
  renameValue.value = entry.title
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('[data-library-rename-input]')
    input?.focus()
    input?.select()
  })
}

function submitRename(entry: LibraryEntry): void {
  const title = renameValue.value.trim()
  if (title && title !== entry.title) {
    emit('rename', entry, title)
  }
  cancelRename()
}

function cancelRename(): void {
  renamingId.value = null
  renameValue.value = ''
}

function requestDelete(entry: LibraryEntry): void {
  dialogRestoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pendingDelete.value = entry
}

function confirmDelete(): void {
  const entry = pendingDelete.value
  pendingDelete.value = null

  if (entry) {
    emit('delete', entry)
  }

  restoreDialogFocus()
}

function requestClear(): void {
  dialogRestoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pendingClear.value = true
}

function confirmClear(): void {
  pendingClear.value = false
  emit('clear')
  restoreDialogFocus()
}

function closeDialogs(): void {
  pendingDelete.value = null
  pendingClear.value = false
  restoreDialogFocus()
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDialogs()
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const focusableElements = getDialogFocusableElements()
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

function getDialogFocusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.library-dialog__panel button, .library-dialog__panel [href], .library-dialog__panel input, .library-dialog__panel select, .library-dialog__panel textarea, .library-dialog__panel [tabindex]:not([tabindex="-1"])'))
    .filter(element => !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden'))
}

function restoreDialogFocus(): void {
  void nextTick(() => {
    if (dialogRestoreTarget?.isConnected) {
      dialogRestoreTarget.focus()
    }
    else {
      rootRef.value?.focus()
    }
    dialogRestoreTarget = null
  })
}

function formatSource(entry: LibraryEntry): string {
  if (entry.source.kind === 'url') {
    return `URL · ${entry.source.domain}`
  }

  if (entry.source.kind === 'file') {
    return `文件 · ${entry.source.fileName}`
  }

  return '粘贴'
}

function formatOpenedAt(entry: LibraryEntry): string {
  const value = entry.lastOpenedAt ?? entry.updatedAt
  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp)) {
    return '最近读过'
  }

  const diffMs = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) {
    return '刚刚读过'
  }

  if (diffMs < hour) {
    return `${Math.max(1, Math.round(diffMs / minute))} 分钟前`
  }

  if (diffMs < day) {
    return `${Math.max(1, Math.round(diffMs / hour))} 小时前`
  }

  if (diffMs < 7 * day) {
    return `${Math.max(1, Math.round(diffMs / day))} 天前`
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function typeLabel(entry: LibraryEntry): string {
  return entry.type === 'pdf' ? 'PDF' : 'MD'
}

watch(pendingDelete, async (entry) => {
  if (entry) {
    await nextTick()
    deleteCancelRef.value?.focus()
  }
})

watch(pendingClear, async (value) => {
  if (value) {
    await nextTick()
    clearCancelRef.value?.focus()
  }
})
</script>

<template>
  <section ref="root" class="library-view" aria-labelledby="library-title" data-testid="library-view" tabindex="-1">
    <header class="library-view__hero">
      <button class="library-view__quiet-link" type="button" @click="emit('close')">
        返回阅读
      </button>
      <div>
        <p class="library-view__eyebrow">本地文库</p>
        <h1 id="library-title" class="library-view__title">你的文库</h1>
        <p class="library-view__intro">
          文档只保存在这台设备上。打开一本, 像翻开一册安静的小书。
        </p>
      </div>
    </header>

    <div class="library-view__toolbar" aria-label="文库操作">
      <label class="library-view__sort-label">
        <span>排序</span>
        <select class="library-view__sort" :value="props.sortMode" data-testid="library-sort" @change="setSortMode">
          <option value="last-opened">最近打开</option>
          <option value="created">加入时间</option>
          <option value="title">标题</option>
        </select>
      </label>

      <button class="library-view__primary" type="button" data-testid="library-add-button" @click="emit('add')">
        ＋ 加入
      </button>
    </div>

    <p v-if="props.status" class="library-view__status" role="status">
      {{ props.status }}
    </p>

    <div v-if="!hasEntries" class="library-view__empty" data-testid="library-empty">
      <p class="library-view__empty-title">你的文库还是空的</p>
      <p class="library-view__empty-copy">
        粘贴、打开文件或拉取 URL 后, miru 会把 Markdown 保存进本地文库。
      </p>
      <button class="library-view__primary" type="button" @click="emit('add')">
        加入第一篇
      </button>
    </div>

    <div v-else class="library-view__sections">
      <section v-if="pinnedEntries.length > 0" class="library-view__section" aria-labelledby="library-pinned-title">
        <h2 id="library-pinned-title" class="library-view__section-title">置顶</h2>
        <ul class="library-view__list">
          <li v-for="entry in pinnedEntries" :key="entry.id">
            <article
              class="library-entry"
              :class="{ 'library-entry--active': entry.id === props.activeEntryId }"
              data-testid="library-entry"
            >
              <div class="library-entry__main">
                <span class="library-entry__type" :data-entry-type="entry.type">{{ typeLabel(entry) }}</span>
                <div class="library-entry__body">
                  <form v-if="renamingId === entry.id" class="library-entry__rename" @submit.prevent="submitRename(entry)">
                    <input
                      v-model="renameValue"
                      class="library-entry__rename-input"
                      :aria-label="`重命名 ${entry.title}`"
                      data-library-rename-input
                    >
                    <button type="submit">保存</button>
                    <button type="button" @click="cancelRename">取消</button>
                  </form>
                  <h3 v-else class="library-entry__title">
                    {{ entry.title }}
                  </h3>
                  <p class="library-entry__meta">
                    <span>{{ formatSource(entry) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ formatOpenedAt(entry) }}</span>
                  </p>
                </div>
              </div>

              <div class="library-entry__actions">
                <button class="library-entry__open" type="button" @click="emit('open', entry)">
                  {{ entry.type === 'pdf' ? '看原件' : '打开' }}
                </button>
                <button class="library-entry__action" type="button" @click="emit('togglePin', entry)">
                  取消置顶
                </button>
                <button class="library-entry__action" type="button" @click="startRename(entry)">
                  重命名
                </button>
                <button class="library-entry__danger" type="button" @click="requestDelete(entry)">
                  删除
                </button>
              </div>
            </article>
          </li>
        </ul>
      </section>

      <section class="library-view__section" aria-labelledby="library-all-title">
        <h2 id="library-all-title" class="library-view__section-title">全部文档</h2>
        <ul class="library-view__list">
          <li v-for="entry in regularEntries" :key="entry.id">
            <article
              class="library-entry"
              :class="{ 'library-entry--active': entry.id === props.activeEntryId }"
              data-testid="library-entry"
            >
              <div class="library-entry__main">
                <span class="library-entry__type" :data-entry-type="entry.type">{{ typeLabel(entry) }}</span>
                <div class="library-entry__body">
                  <form v-if="renamingId === entry.id" class="library-entry__rename" @submit.prevent="submitRename(entry)">
                    <input
                      v-model="renameValue"
                      class="library-entry__rename-input"
                      :aria-label="`重命名 ${entry.title}`"
                      data-library-rename-input
                    >
                    <button type="submit">保存</button>
                    <button type="button" @click="cancelRename">取消</button>
                  </form>
                  <h3 v-else class="library-entry__title">
                    {{ entry.title }}
                  </h3>
                  <p class="library-entry__meta">
                    <span>{{ formatSource(entry) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ formatOpenedAt(entry) }}</span>
                  </p>
                </div>
              </div>

              <div class="library-entry__actions">
                <button class="library-entry__open" type="button" @click="emit('open', entry)">
                  {{ entry.type === 'pdf' ? '看原件' : '打开' }}
                </button>
                <button class="library-entry__action" type="button" @click="emit('togglePin', entry)">
                  置顶
                </button>
                <button class="library-entry__action" type="button" @click="startRename(entry)">
                  重命名
                </button>
                <button class="library-entry__danger" type="button" @click="requestDelete(entry)">
                  删除
                </button>
              </div>
            </article>
          </li>
        </ul>
      </section>

      <footer class="library-view__footer">
        <p>文档、PDF 原件和阅读位置都只存在本机 IndexedDB。删除后无法在 miru 中恢复。</p>
        <button class="library-view__danger-link" type="button" @click="requestClear">
          清空文库
        </button>
      </footer>
    </div>

    <div
      v-if="pendingDelete"
      class="library-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-delete-title"
      @keydown.capture="onDialogKeydown"
    >
      <div class="library-dialog__panel">
        <h2 id="library-delete-title" class="library-dialog__title">
          删除「{{ pendingDelete.title }}」?
        </h2>
        <p class="library-dialog__copy">
          它只保存在这台设备上, 删除后无法恢复。
        </p>
        <div class="library-dialog__actions">
          <button ref="deleteCancel" class="library-dialog__button" type="button" @click="closeDialogs">
            取消
          </button>
          <button class="library-dialog__danger" type="button" @click="confirmDelete">
            删除
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="pendingClear"
      class="library-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-clear-title"
      @keydown.capture="onDialogKeydown"
    >
      <div class="library-dialog__panel">
        <h2 id="library-clear-title" class="library-dialog__title">
          清空文库?
        </h2>
        <p class="library-dialog__copy">
          这会删除所有本地文档、PDF 原件和阅读位置。阅读设置会保留。
        </p>
        <div class="library-dialog__actions">
          <button ref="clearCancel" class="library-dialog__button" type="button" @click="closeDialogs">
            取消
          </button>
          <button class="library-dialog__danger" type="button" @click="confirmClear">
            清空
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.library-view {
  max-width: min(100%, 48rem);
  margin: 0 auto;
  padding: clamp(2.5rem, 7vw, 5rem) 0 7rem;
}

.library-view__hero {
  display: grid;
  gap: 1.4rem;
  margin-bottom: clamp(2rem, 6vw, 3.5rem);
}

.library-view__quiet-link,
.library-entry__action,
.library-entry__danger,
.library-view__danger-link {
  width: fit-content;
  min-block-size: 2.75rem;
  padding: 0;
  border: 0;
  color: var(--reading-fg-muted);
  background: transparent;
  font: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--reading-fg-muted) 38%, transparent);
  text-underline-offset: 0.18em;
  cursor: pointer;
}

.library-view__quiet-link:hover,
.library-view__quiet-link:focus-visible,
.library-entry__action:hover,
.library-entry__action:focus-visible,
.library-entry__danger:hover,
.library-entry__danger:focus-visible,
.library-view__danger-link:hover,
.library-view__danger-link:focus-visible {
  color: var(--reading-fg);
}

.library-view__eyebrow,
.library-view__intro,
.library-entry__meta,
.library-view__empty-copy,
.library-view__footer,
.library-dialog__copy {
  color: var(--reading-fg-muted);
}

.library-view__eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.86rem;
  letter-spacing: 0;
}

.library-view__title {
  margin: 0;
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: clamp(2.55rem, 7vw, 4rem);
  font-weight: 680;
  line-height: 0.98;
}

.library-view__intro {
  max-width: 34rem;
  margin: 0.9rem 0 0;
  font-size: 1.02rem;
}

.library-view__toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.1rem;
}

.library-view__sort-label {
  display: grid;
  gap: 0.35rem;
  color: var(--reading-fg-muted);
  font-size: 0.86rem;
}

.library-view__sort,
.library-entry__rename-input {
  min-block-size: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 86%, transparent);
  border-radius: 8px;
  color: var(--reading-fg);
  background: var(--reading-bg);
  font: inherit;
}

.library-view__sort {
  min-inline-size: 9.5rem;
  padding: 0 2.35rem 0 0.85rem;
}

.library-view__primary,
.library-entry__open,
.library-dialog__button,
.library-dialog__danger,
.library-entry__rename button {
  min-block-size: 2.75rem;
  padding: 0 1rem;
  border: 1px solid color-mix(in srgb, var(--reading-accent) 62%, transparent);
  border-radius: 8px;
  color: var(--reading-fg);
  background: color-mix(in srgb, var(--reading-accent) 8%, transparent);
  font: inherit;
  cursor: pointer;
}

.library-view__primary:hover,
.library-view__primary:focus-visible,
.library-entry__open:hover,
.library-entry__open:focus-visible,
.library-dialog__button:hover,
.library-dialog__button:focus-visible,
.library-entry__rename button:hover,
.library-entry__rename button:focus-visible {
  border-color: var(--reading-accent);
  background: color-mix(in srgb, var(--reading-accent) 14%, transparent);
}

.library-view__status {
  margin: 0 0 1rem;
  color: var(--reading-accent);
}

.library-view__empty {
  display: grid;
  place-items: start;
  gap: 0.9rem;
  padding: clamp(2rem, 8vw, 4rem) 0;
  border-block-start: 1px solid color-mix(in srgb, var(--reading-rule) 45%, transparent);
}

.library-view__empty-title {
  margin: 0;
  font-family: var(--reading-font-heading);
  font-size: 1.65rem;
}

.library-view__empty-copy {
  max-width: 33rem;
  margin: 0;
}

.library-view__sections {
  display: grid;
  gap: 2rem;
}

.library-view__section-title {
  margin: 0 0 0.75rem;
  color: var(--reading-fg-muted);
  font-family: var(--reading-font-body);
  font-size: 0.9rem;
  font-weight: 600;
}

.library-view__list {
  display: grid;
  gap: 0;
  padding: 0;
  margin: 0;
  list-style: none;
  border-block-start: 1px solid color-mix(in srgb, var(--reading-rule) 55%, transparent);
}

.library-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.25rem;
  padding: 1rem 0;
  border-block-end: 1px solid color-mix(in srgb, var(--reading-rule) 42%, transparent);
}

.library-entry--active .library-entry__title {
  color: var(--reading-accent);
}

.library-entry__main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.8rem;
  min-width: 0;
}

.library-entry__type {
  min-inline-size: 2.35rem;
  padding: 0.2rem 0.45rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 65%, transparent);
  border-radius: 6px;
  color: var(--reading-fg-muted);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
}

.library-entry__type[data-entry-type="pdf"] {
  color: var(--reading-accent);
  border-color: color-mix(in srgb, var(--reading-accent) 54%, transparent);
}

.library-entry__body {
  min-width: 0;
}

.library-entry__title {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--reading-fg);
  font-family: var(--reading-font-heading);
  font-size: 1.28rem;
  font-weight: 620;
  line-height: 1.15;
}

.library-entry__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.35rem 0 0;
  font-size: 0.88rem;
}

.library-entry__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: end;
  gap: 0.7rem;
}

.library-entry__danger,
.library-view__danger-link {
  color: color-mix(in srgb, #9b2f23 82%, var(--reading-fg));
}

.library-entry__rename {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.library-entry__rename-input {
  min-inline-size: min(100%, 18rem);
  padding: 0 0.75rem;
}

.library-view__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1.5rem;
  border-block-start: 1px solid color-mix(in srgb, var(--reading-rule) 45%, transparent);
  font-size: 0.9rem;
}

.library-view__footer p {
  margin: 0;
}

.library-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: color-mix(in srgb, var(--reading-bg) 76%, #000 24%);
}

.library-dialog__panel {
  width: min(100%, 29rem);
  padding: 1.35rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 86%, transparent);
  border-radius: 8px;
  background: var(--reading-bg);
  box-shadow: 0 24px 60px color-mix(in srgb, var(--reading-fg) 16%, transparent);
}

.library-dialog__title {
  margin: 0;
  font-family: var(--reading-font-heading);
  font-size: 1.5rem;
}

.library-dialog__copy {
  margin: 0.7rem 0 0;
}

.library-dialog__actions {
  display: flex;
  justify-content: end;
  gap: 0.75rem;
  margin-top: 1.2rem;
}

.library-dialog__danger {
  border-color: color-mix(in srgb, #9b2f23 72%, transparent);
  color: #fdf8f0;
  background: #9b2f23;
}

@media (max-width: 720px) {
  .library-view {
    padding-block-start: 2rem;
  }

  .library-view__toolbar,
  .library-view__footer,
  .library-entry {
    grid-template-columns: 1fr;
  }

  .library-view__toolbar,
  .library-entry__actions,
  .library-view__footer {
    align-items: stretch;
  }

  .library-entry__actions,
  .library-dialog__actions {
    justify-content: start;
  }

  .library-entry__actions > *,
  .library-view__primary,
  .library-view__sort {
    width: 100%;
  }
}
</style>
