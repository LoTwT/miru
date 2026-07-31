<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

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
  sample: []
}>()

const pendingDelete = shallowRef<LibraryEntry | null>(null)
const pendingClear = shallowRef(false)
const renamingId = shallowRef<string | null>(null)
const renameValue = shallowRef('')
const openActionsEntryId = shallowRef<string | null>(null)
const isLibraryMenuOpen = shallowRef(false)
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
  closeActionsMenu()
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
  closeActionsMenu()
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
  closeAllMenus()
  dialogRestoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pendingClear.value = true
}

function openEntry(entry: LibraryEntry): void {
  closeActionsMenu()
  emit('open', entry)
}

function openSample(): void {
  closeActionsMenu()
  emit('sample')
}

function toggleActionsMenu(entry: LibraryEntry): void {
  isLibraryMenuOpen.value = false
  openActionsEntryId.value = openActionsEntryId.value === entry.id ? null : entry.id
}

function closeActionsMenu(): void {
  openActionsEntryId.value = null
}

function toggleLibraryMenu(): void {
  closeActionsMenu()
  isLibraryMenuOpen.value = !isLibraryMenuOpen.value
}

function closeLibraryMenu(): void {
  isLibraryMenuOpen.value = false
}

function closeAllMenus(): void {
  closeActionsMenu()
  closeLibraryMenu()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!openActionsEntryId.value && !isLibraryMenuOpen.value) {
    return
  }

  const target = event.target
  if (!(target instanceof Node)) {
    return
  }

  const openMenuRoot = rootRef.value?.querySelector<HTMLElement>('.library-entry__more-wrap[data-actions-open="true"]')
  if (openMenuRoot?.contains(target)) {
    return
  }

  const libraryMenuRoot = rootRef.value?.querySelector<HTMLElement>('.library-view__management[data-management-open="true"]')
  if (libraryMenuRoot?.contains(target)) {
    return
  }

  closeAllMenus()
}

function isActionsMenuOpen(entry: LibraryEntry): boolean {
  return openActionsEntryId.value === entry.id
}

function actionsMenuId(entry: LibraryEntry): string {
  return `library-entry-actions-${entry.id}`
}

function togglePinFromMenu(entry: LibraryEntry): void {
  emit('togglePin', entry)
  closeActionsMenu()
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

function pinLabel(entry: LibraryEntry): string {
  return entry.pinned ? '取消置顶' : '置顶'
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

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

      <div class="library-view__toolbar-actions">
        <div
          v-if="hasEntries"
          class="library-view__management"
          :data-management-open="isLibraryMenuOpen ? 'true' : undefined"
        >
          <button
            class="library-view__management-button"
            type="button"
            aria-label="文库管理"
            :aria-expanded="isLibraryMenuOpen"
            aria-controls="library-management-menu"
            data-testid="library-management-button"
            @click="toggleLibraryMenu"
          >
            管理
          </button>
          <div
            v-if="isLibraryMenuOpen"
            id="library-management-menu"
            class="library-view__management-menu"
            role="menu"
            @keydown.esc.stop.prevent="closeLibraryMenu"
          >
            <button
              class="library-view__management-item library-view__management-item--danger"
              type="button"
              role="menuitem"
              data-testid="library-clear-button"
              @click="requestClear"
            >
              清空全部
            </button>
          </div>
        </div>
        <button class="library-view__primary" type="button" data-testid="library-add-button" @click="emit('add')">
          ＋ 加入
        </button>
      </div>
    </div>

    <p v-if="props.status" class="library-view__status" role="status">
      {{ props.status }}
    </p>

    <div v-if="!hasEntries" class="library-view__empty" data-testid="library-empty">
      <p class="library-view__empty-title">你的文库还是空的</p>
      <p class="library-view__empty-copy">
        粘贴、打开文件或拉取 URL 后, miru 会把 Markdown 或 PDF 原件保存进本地文库。
      </p>
      <button class="library-view__primary" type="button" @click="emit('add')">
        加入第一篇
      </button>
      <button class="library-view__secondary" type="button" @click="emit('sample')">
        回到示例文档
      </button>
    </div>

    <div v-else class="library-view__sections">
      <section class="library-view__section" aria-labelledby="library-sample-title">
        <h2 id="library-sample-title" class="library-view__section-title">示例</h2>
        <ul class="library-view__list">
          <li>
            <article class="library-entry library-entry--sample" data-testid="library-sample-entry">
              <div class="library-entry__main">
                <span class="library-entry__type" data-entry-type="sample">示例</span>
                <div class="library-entry__body">
                  <h3 class="library-entry__title">
                    <button class="library-entry__title-button" type="button" @click="openSample">
                      miru 示例文档
                    </button>
                  </h3>
                  <p class="library-entry__meta">
                    <span>内置</span>
                    <span aria-hidden="true">·</span>
                    <span>随时回到起点</span>
                  </p>
                </div>
              </div>

              <div class="library-entry__actions">
                <button class="library-entry__open" type="button" @click="openSample">
                  打开示例
                </button>
              </div>
            </article>
          </li>
        </ul>
      </section>

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
                    <button class="library-entry__title-button" type="button" @click="openEntry(entry)">
                      {{ entry.title }}
                    </button>
                  </h3>
                  <p class="library-entry__meta">
                    <span>{{ formatSource(entry) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ formatOpenedAt(entry) }}</span>
                  </p>
                </div>
              </div>

              <div class="library-entry__actions">
                <button class="library-entry__open" type="button" @click="openEntry(entry)">
                  {{ entry.type === 'pdf' ? '看原件' : '打开' }}
                </button>
                <button class="library-entry__action library-entry__desktop-action" type="button" @click="emit('togglePin', entry)">
                  {{ pinLabel(entry) }}
                </button>
                <button class="library-entry__action library-entry__desktop-action" type="button" @click="startRename(entry)">
                  重命名
                </button>
                <button class="library-entry__danger library-entry__desktop-action" type="button" @click="requestDelete(entry)">
                  删除
                </button>
                <div class="library-entry__more-wrap" :data-actions-open="isActionsMenuOpen(entry) ? 'true' : undefined">
                  <button
                    class="library-entry__more"
                    type="button"
                    :aria-expanded="isActionsMenuOpen(entry)"
                    :aria-controls="actionsMenuId(entry)"
                    :aria-label="`${entry.title} 更多操作`"
                    @click="toggleActionsMenu(entry)"
                  >
                    ⋯
                  </button>
                  <div
                    v-if="isActionsMenuOpen(entry)"
                    :id="actionsMenuId(entry)"
                    class="library-entry__overflow-menu"
                    role="menu"
                    @keydown.esc.stop.prevent="closeActionsMenu"
                  >
                    <button class="library-entry__menu-item" type="button" role="menuitem" @click="togglePinFromMenu(entry)">
                      {{ pinLabel(entry) }}
                    </button>
                    <button class="library-entry__menu-item" type="button" role="menuitem" @click="startRename(entry)">
                      重命名
                    </button>
                    <button class="library-entry__menu-item library-entry__menu-item--danger" type="button" role="menuitem" @click="requestDelete(entry)">
                      删除
                    </button>
                  </div>
                </div>
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
                    <button class="library-entry__title-button" type="button" @click="openEntry(entry)">
                      {{ entry.title }}
                    </button>
                  </h3>
                  <p class="library-entry__meta">
                    <span>{{ formatSource(entry) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ formatOpenedAt(entry) }}</span>
                  </p>
                </div>
              </div>

              <div class="library-entry__actions">
                <button class="library-entry__open" type="button" @click="openEntry(entry)">
                  {{ entry.type === 'pdf' ? '看原件' : '打开' }}
                </button>
                <button class="library-entry__action library-entry__desktop-action" type="button" @click="emit('togglePin', entry)">
                  {{ pinLabel(entry) }}
                </button>
                <button class="library-entry__action library-entry__desktop-action" type="button" @click="startRename(entry)">
                  重命名
                </button>
                <button class="library-entry__danger library-entry__desktop-action" type="button" @click="requestDelete(entry)">
                  删除
                </button>
                <div class="library-entry__more-wrap" :data-actions-open="isActionsMenuOpen(entry) ? 'true' : undefined">
                  <button
                    class="library-entry__more"
                    type="button"
                    :aria-expanded="isActionsMenuOpen(entry)"
                    :aria-controls="actionsMenuId(entry)"
                    :aria-label="`${entry.title} 更多操作`"
                    @click="toggleActionsMenu(entry)"
                  >
                    ⋯
                  </button>
                  <div
                    v-if="isActionsMenuOpen(entry)"
                    :id="actionsMenuId(entry)"
                    class="library-entry__overflow-menu"
                    role="menu"
                    @keydown.esc.stop.prevent="closeActionsMenu"
                  >
                    <button class="library-entry__menu-item" type="button" role="menuitem" @click="togglePinFromMenu(entry)">
                      {{ pinLabel(entry) }}
                    </button>
                    <button class="library-entry__menu-item" type="button" role="menuitem" @click="startRename(entry)">
                      重命名
                    </button>
                    <button class="library-entry__menu-item library-entry__menu-item--danger" type="button" role="menuitem" @click="requestDelete(entry)">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </li>
        </ul>
      </section>

      <footer class="library-view__footer">
        <p>文档、PDF 原件和阅读位置都只存在本机 IndexedDB。删除后无法在 miru 中恢复。</p>
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
          将删除全部 {{ props.entries.length }} 篇文档及其阅读位置、书签、缓存。此操作不可恢复。
        </p>
        <p class="library-dialog__copy">
          不影响你的阅读设置、字体/主题、示例文档入口。
        </p>
        <div class="library-dialog__actions">
          <button ref="clearCancel" class="library-dialog__button" type="button" @click="closeDialogs">
            取消
          </button>
          <button class="library-dialog__danger" type="button" @click="confirmClear">
            清空全部
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
  color: var(--text-primary);
  font-family: var(--font-sans);
}

.library-view__hero {
  display: grid;
  gap: 1.4rem;
  margin-bottom: clamp(2rem, 6vw, 3.5rem);
}

.library-entry__action,
.library-entry__danger {
  width: fit-content;
  min-block-size: 2.75rem;
  padding: 0;
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--text-secondary) 38%, transparent);
  text-underline-offset: 0.18em;
  cursor: pointer;
}

.library-entry__action:hover,
.library-entry__action:focus-visible {
  color: var(--text-primary);
}

.library-view__eyebrow,
.library-view__intro,
.library-entry__meta,
.library-view__empty-copy,
.library-view__footer,
.library-dialog__copy {
  color: var(--text-secondary);
}

.library-view__eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.86rem;
  letter-spacing: 0;
}

.library-view__title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
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

.library-view__toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.55rem;
}

.library-view__sort-label {
  display: grid;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.library-view__sort,
.library-entry__rename-input {
  min-block-size: 2.75rem;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface-elevated);
  font: inherit;
}

.library-view__sort {
  min-inline-size: 9.5rem;
  padding: 0 2.35rem 0 0.85rem;
}

.library-view__primary,
.library-view__secondary,
.library-entry__open,
.library-dialog__button,
.library-dialog__danger,
.library-entry__rename button {
  min-block-size: 2.75rem;
  padding: 0 1rem;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--accent-soft);
  font: inherit;
  cursor: pointer;
}

.library-view__primary:hover,
.library-view__primary:focus-visible,
.library-view__secondary:hover,
.library-view__secondary:focus-visible,
.library-entry__open:hover,
.library-entry__open:focus-visible,
.library-dialog__button:hover,
.library-dialog__button:focus-visible,
.library-entry__rename button:hover,
.library-entry__rename button:focus-visible {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
}

.library-view__secondary {
  border-color: var(--border-default);
  color: var(--text-secondary);
  background: var(--surface-subtle);
}

.library-view__management {
  position: relative;
}

.library-view__management-button {
  min-block-size: 2.75rem;
  padding: 0 0.9rem;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  background: var(--surface-elevated);
  cursor: pointer;
  font: inherit;
}

.library-view__management-button:hover,
.library-view__management-button:focus-visible {
  border-color: var(--accent-primary);
  color: var(--text-primary);
}

.library-view__management-menu {
  position: absolute;
  inset-block-start: calc(100% + 0.35rem);
  inset-inline-end: 0;
  z-index: var(--z-popover);
  display: grid;
  min-inline-size: 9.5rem;
  padding: var(--spacing-1-5);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-panel);
}

.library-view__management-item {
  min-block-size: 2.75rem;
  border: 0;
  border-radius: var(--radius-control);
  padding: 0 0.75rem;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: start;
}

.library-view__management-item:not(.library-view__management-item--danger):hover,
.library-view__management-item:not(.library-view__management-item--danger):focus-visible {
  background: var(--accent-soft);
}

.library-view__management-item--danger {
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.library-view__status {
  margin: 0 0 1rem;
  color: var(--text-accent);
}

.library-view__empty {
  display: grid;
  place-items: start;
  gap: 0.9rem;
  padding: clamp(2rem, 8vw, 4rem) 0;
  border-block-start: var(--border-width-thin) solid var(--border-subtle);
}

.library-view__empty-title {
  margin: 0;
  font-family: var(--font-display);
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
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 0.9rem;
  font-weight: 600;
}

.library-view__list {
  display: grid;
  gap: 0;
  padding: 0;
  margin: 0;
  list-style: none;
  border-block-start: var(--border-width-thin) solid var(--border-subtle);
}

.library-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.25rem;
  padding: 1rem 0;
  border-block-end: var(--border-width-thin) solid var(--border-subtle);
}

.library-entry--active .library-entry__title-button {
  color: var(--text-accent);
}

.library-entry--sample .library-entry__title-button {
  color: var(--text-primary);
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
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
}

.library-entry__type[data-entry-type="pdf"] {
  color: var(--text-accent);
  border-color: var(--accent-primary);
}

.library-entry__type[data-entry-type="sample"] {
  color: var(--text-secondary);
  background: var(--accent-soft);
}

.library-entry__body {
  min-width: 0;
}

.library-entry__title {
  margin: 0;
  line-height: 1.15;
}

.library-entry__title-button {
  display: block;
  border: 0;
  padding: 0;
  background: transparent;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 1.28rem;
  font-weight: 620;
  line-height: inherit;
  text-align: start;
  cursor: pointer;
}

.library-entry__title-button:hover,
.library-entry__title-button:focus-visible {
  color: var(--text-accent);
}

.library-entry__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.35rem 0 0;
  font-size: 0.88rem;
}

.library-entry__actions {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: end;
  gap: 0.7rem;
}

.library-entry__more-wrap {
  position: relative;
  display: none;
}

.library-entry__more {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface-elevated);
  font: inherit;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.library-entry__overflow-menu {
  position: absolute;
  inset-block-start: calc(100% + 0.35rem);
  inset-inline-end: 0;
  z-index: var(--z-popover);
  display: grid;
  min-inline-size: 9.5rem;
  padding: var(--spacing-1-5);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-panel);
}

.library-entry__menu-item {
  min-block-size: 2.75rem;
  border: 0;
  border-radius: var(--radius-control);
  padding: 0 0.75rem;
  color: var(--text-primary);
  background: transparent;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.library-entry__menu-item:not(.library-entry__menu-item--danger):hover,
.library-entry__menu-item:not(.library-entry__menu-item--danger):focus-visible {
  background: var(--accent-soft);
}

.library-entry__more:hover,
.library-entry__more:focus-visible {
  background: var(--accent-soft);
}

.library-entry__menu-item--danger {
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.library-entry__danger {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.library-entry__danger:hover,
.library-entry__danger:focus-visible,
.library-entry__menu-item--danger:hover,
.library-entry__menu-item--danger:focus-visible,
.library-view__management-item--danger:hover,
.library-view__management-item--danger:focus-visible {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
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
  border-block-start: var(--border-width-thin) solid var(--border-subtle);
  font-size: 0.9rem;
}

.library-view__footer p {
  margin: 0;
}

.library-dialog {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: color-mix(in srgb, var(--text-primary) 24%, transparent);
}

.library-dialog__panel {
  width: min(100%, 29rem);
  padding: var(--spacing-5);
  border: var(--border-width-surface) solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--surface-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-panel);
}

.library-dialog__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.5rem;
}

.library-dialog__copy {
  margin: 0.7rem 0 0;
  color: var(--text-secondary);
}

.library-dialog__actions {
  display: flex;
  justify-content: end;
  gap: 0.75rem;
  margin-top: 1.2rem;
}

.library-dialog__danger {
  border-color: var(--status-danger-border);
  color: var(--status-danger-fg);
  background: var(--status-danger-bg);
}

.library-dialog__button {
  border-color: var(--border-default);
  color: var(--text-primary);
  background: var(--surface-elevated);
}

.library-dialog__button:hover,
.library-dialog__button:focus-visible {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
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
  .library-view__footer {
    align-items: stretch;
  }

  .library-entry__actions {
    justify-content: end;
  }

  .library-dialog__actions {
    justify-content: start;
  }

  .library-entry__open,
  .library-entry__desktop-action {
    display: none;
  }

  .library-entry__more-wrap {
    display: block;
    margin-inline-start: auto;
  }

  .library-view__primary,
  .library-view__sort {
    width: 100%;
  }
}
</style>
