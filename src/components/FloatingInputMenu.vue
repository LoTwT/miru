<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

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
}>()

const url = shallowRef('')
const isHovering = shallowRef(false)
const isHoverPreview = shallowRef(false)
const isFocusWithin = shallowRef(false)
const isReceded = shallowRef(false)
const showScrollTop = shallowRef(false)
const prefersReducedMotion = shallowRef(false)
const pendingFirstItemFocus = shallowRef(false)
const rootRef = useTemplateRef<HTMLElement>('root')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')
const fabRef = useTemplateRef<HTMLButtonElement>('fab')
const urlInputRef = useTemplateRef<HTMLInputElement>('urlInput')

let lastScrollY = 0
let recedeTimer: ReturnType<typeof setTimeout> | undefined
let mediaQuery: MediaQueryList | undefined

const isDimmed = computed(() =>
  isReceded.value && !props.isOpen && !isHovering.value && !isFocusWithin.value && !prefersReducedMotion.value,
)

function setOpen(value: boolean): void {
  emit('update:isOpen', value)
}

async function openMenu(options: { focusFirstItem?: boolean } = {}): Promise<void> {
  if (options.focusFirstItem) {
    pendingFirstItemFocus.value = true
  }

  setOpen(true)
  isReceded.value = false
  await nextTick()

  if (options.focusFirstItem) {
    focusFirstMenuItem()
  }
}

function closeMenu(options: { restoreFocus?: boolean } = {}): void {
  isHoverPreview.value = false
  setOpen(false)

  if (options.restoreFocus) {
    window.setTimeout(() => fabRef.value?.focus(), 0)
  }
}

function toggleMenu(): void {
  if (props.isOpen && isHoverPreview.value) {
    isHoverPreview.value = false
    focusFirstMenuItem()
    return
  }

  if (props.isOpen) {
    closeMenu({ restoreFocus: true })
    return
  }

  void openMenu({ focusFirstItem: true })
}

function onPointerEnter(event: PointerEvent): void {
  isHovering.value = true
  isReceded.value = false

  if (event.pointerType === 'mouse') {
    if (!props.isOpen) {
      isHoverPreview.value = true
    }
    void openMenu()
  }
}

function onPointerLeave(): void {
  isHovering.value = false

  if (!isFocusWithin.value) {
    closeMenu()
  }
}

function onFocusIn(): void {
  isFocusWithin.value = true
  isReceded.value = false
}

function onFocusOut(event: FocusEvent): void {
  const nextTarget = event.relatedTarget

  if (!(nextTarget instanceof Node) || !rootRef.value?.contains(nextTarget)) {
    isFocusWithin.value = false
  }
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target

  if (props.isOpen && (!(target instanceof Node) || !rootRef.value?.contains(target))) {
    closeMenu({ restoreFocus: true })
  }
}

function onWindowMouseMove(): void {
  if (!props.isOpen && !prefersReducedMotion.value) {
    isReceded.value = false
  }
}

function onWindowScroll(): void {
  const currentY = window.scrollY
  const delta = currentY - lastScrollY

  window.clearTimeout(recedeTimer)

  if (currentY < 160) {
    isReceded.value = false
    showScrollTop.value = false
  }
  else if (delta > 6) {
    showScrollTop.value = false
    if (!prefersReducedMotion.value) {
      recedeTimer = window.setTimeout(() => {
        if (!props.isOpen && !isFocusWithin.value && !isHovering.value) {
          isReceded.value = true
        }
      }, 520)
    }
  }
  else if (delta < -6) {
    isReceded.value = false
    showScrollTop.value = currentY > 320
  }

  lastScrollY = currentY
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu({ restoreFocus: true })
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
    const item = getMenuItems()[0]
    item?.focus()
    pendingFirstItemFocus.value = false
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
  emit('openLibrary')
  closeMenu()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (file) {
    emit('openFile', file)
    closeMenu()
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
  emit('clear')
  closeMenu({ restoreFocus: true })
}

function requestPaste(): void {
  emit('paste')
}

function scrollToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion.value ? 'auto' : 'smooth',
  })
}

function syncReducedMotion(): void {
  prefersReducedMotion.value = mediaQuery?.matches ?? false

  if (prefersReducedMotion.value) {
    isReceded.value = false
  }
}

watch(() => props.isOpen, async (isOpen) => {
  if (isOpen && pendingFirstItemFocus.value) {
    await nextTick()
    focusFirstMenuItem()
  }
})

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncReducedMotion()
  lastScrollY = window.scrollY

  mediaQuery.addEventListener('change', syncReducedMotion)
  window.addEventListener('scroll', onWindowScroll, { passive: true })
  window.addEventListener('mousemove', onWindowMouseMove, { passive: true })
  document.addEventListener('pointerdown', onDocumentPointerDown)
})

onUnmounted(() => {
  window.clearTimeout(recedeTimer)
  mediaQuery?.removeEventListener('change', syncReducedMotion)
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('mousemove', onWindowMouseMove)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <button
    v-if="showScrollTop"
    class="floating-return-mark"
    type="button"
    aria-label="回到顶部"
    data-testid="scroll-top-button"
    @click="scrollToTop"
  >
    miru ↑
  </button>

  <section
    ref="root"
    class="floating-input"
    :class="{ 'floating-input--dimmed': isDimmed, 'floating-input--open': props.isOpen }"
    aria-label="Markdown input"
    data-testid="floating-affordance"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @pointerdown="isReceded = false"
  >
    <div
      v-if="props.isOpen"
      id="floating-input-menu"
      class="floating-input__panel"
      role="group"
      aria-label="加载文档菜单"
      data-testid="floating-affordance-menu"
      @keydown="onMenuKeydown"
    >
      <button
        class="floating-input__item"
        type="button"
        data-menu-item
        @click="requestPaste"
      >
        <span>粘贴</span>
        <small>也可按 Cmd/Ctrl+V</small>
      </button>

      <button
        class="floating-input__item"
        type="button"
        data-menu-item
        @click="openFileDialog"
      >
        <span>打开文件</span>
        <small>.md / text / PDF</small>
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

      <form class="floating-input__url" @submit.prevent="submitUrl">
        <label class="floating-input__label" for="floating-url-input">URL</label>
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
        class="floating-input__item floating-input__item--quiet"
        type="button"
        data-menu-item
        @click="clearDocument"
      >
        <span>清空</span>
        <small>回到示例文档</small>
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
    </div>

    <button
      ref="fab"
      class="floating-input__fab"
      type="button"
      aria-label="加载文档"
      :aria-expanded="props.isOpen"
      aria-controls="floating-input-menu"
      data-testid="floating-affordance-button"
      @click="toggleMenu"
      @keydown.enter.prevent="openMenu({ focusFirstItem: true })"
      @keydown.space.prevent="openMenu({ focusFirstItem: true })"
      @keydown.arrow-down.prevent="openMenu({ focusFirstItem: true })"
      @keydown.escape.prevent="closeMenu({ restoreFocus: true })"
    >
      <span aria-hidden="true">＋</span>
    </button>
  </section>
</template>

<style scoped>
.floating-input {
  position: fixed;
  right: max(1rem, calc(env(safe-area-inset-right) + 1rem));
  bottom: max(1rem, calc(env(safe-area-inset-bottom) + 1rem));
  z-index: 20;
  display: grid;
  justify-items: end;
  gap: 0.75rem;
  opacity: 1;
  transition: opacity 160ms ease;
}

.floating-input--dimmed {
  opacity: 0.32;
}

.floating-input:focus-within,
.floating-input:hover {
  opacity: 1;
}

.floating-input__panel {
  inline-size: min(20rem, calc(100vw - 2rem));
  padding: 0.65rem;
  border: 1px solid var(--reading-rule);
  border-radius: 18px;
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  box-shadow: 0 18px 44px rgb(0 0 0 / 16%);
  backdrop-filter: blur(14px);
}

.floating-input__fab {
  display: grid;
  place-items: center;
  inline-size: 48px;
  block-size: 48px;
  border: 1px solid var(--reading-rule);
  border-radius: 50%;
  background: var(--reading-fg);
  color: var(--reading-bg);
  box-shadow: 0 12px 30px rgb(0 0 0 / 14%);
  cursor: pointer;
}

.floating-input__fab span {
  display: block;
  font-size: 1.6rem;
  line-height: 1;
  transform: translateY(-0.03em);
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
.floating-input__fetch:focus-visible {
  border-color: var(--reading-accent);
}

.floating-input__item--quiet {
  color: var(--reading-fg-muted);
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

.floating-return-mark {
  position: fixed;
  top: max(1rem, env(safe-area-inset-top));
  left: max(1rem, env(safe-area-inset-left));
  z-index: 20;
  min-block-size: 36px;
  padding-inline: 0.78rem;
  border: 1px solid var(--reading-rule);
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-bg) 92%, transparent);
  color: var(--reading-fg);
  box-shadow: 0 10px 24px rgb(0 0 0 / 10%);
  backdrop-filter: blur(12px);
  cursor: pointer;
  font-family: var(--reading-font-heading);
  font-weight: 650;
}

@media (max-width: 700px) {
  .floating-input__panel {
    inline-size: min(21rem, calc(100vw - 2rem));
  }
}

@media (prefers-reduced-motion: reduce) {
  .floating-input {
    opacity: 1;
    transition: none;
  }
}
</style>
