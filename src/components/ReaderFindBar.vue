<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  activeIndex: number
  isOpen: boolean
  matchCount: number
  modelValue: string
}>()

const emit = defineEmits<{
  close: []
  next: []
  previous: []
  'update:modelValue': [value: string]
}>()

const inputRef = useTemplateRef<HTMLInputElement>('input')

const counterLabel = computed(() => {
  if (!props.modelValue.trim()) {
    return '0 / 0'
  }

  if (props.matchCount === 0) {
    return '0 / 0'
  }

  return `${props.activeIndex + 1} / ${props.matchCount}`
})

const statusLabel = computed(() => {
  if (!props.modelValue.trim()) {
    return '输入关键词'
  }

  return props.matchCount === 0 ? '无匹配' : counterLabel.value
})

watch(() => props.isOpen, async (value) => {
  if (!value) {
    return
  }

  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})

defineExpose({
  focusInput: () => {
    inputRef.value?.focus()
    inputRef.value?.select()
  },
})

function updateValue(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) {
      emit('previous')
    }
    else {
      emit('next')
    }
    return
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (event.key === 'ArrowUp') {
      emit('previous')
    }
    else {
      emit('next')
    }
  }
}
</script>

<template>
  <section
    v-if="props.isOpen"
    class="reader-find"
    aria-label="文内搜索"
    data-testid="reader-find-bar"
    @keydown="onKeydown"
  >
    <label class="reader-find__label" for="reader-find-input">搜索当前文档</label>
    <input
      id="reader-find-input"
      ref="input"
      class="reader-find__input"
      type="search"
      :value="props.modelValue"
      autocomplete="off"
      spellcheck="false"
      placeholder="搜索当前文档"
      data-testid="reader-find-input"
      @input="updateValue"
    >
    <span
      class="reader-find__counter"
      :class="{ 'reader-find__counter--empty': props.modelValue.trim() && props.matchCount === 0 }"
      aria-live="polite"
      data-testid="reader-find-counter"
    >
      {{ statusLabel }}
    </span>
    <div class="reader-find__actions" aria-label="搜索结果导航">
      <button
        class="reader-find__button"
        type="button"
        :disabled="props.matchCount === 0"
        aria-label="上一个匹配"
        @click="emit('previous')"
      >
        ↑
      </button>
      <button
        class="reader-find__button"
        type="button"
        :disabled="props.matchCount === 0"
        aria-label="下一个匹配"
        @click="emit('next')"
      >
        ↓
      </button>
      <button class="reader-find__button" type="button" aria-label="关闭搜索" @click="emit('close')">
        ×
      </button>
    </div>
  </section>
</template>

<style scoped>
.reader-find {
  position: fixed;
  inset-block-start: max(4.9rem, calc(env(safe-area-inset-top) + 4.9rem));
  inset-inline-end: max(1rem, var(--reading-page-margin));
  z-index: 75;
  display: grid;
  grid-template-columns: minmax(10rem, 18rem) auto auto;
  gap: 0.45rem;
  align-items: center;
  max-inline-size: calc(100vw - 2rem);
  padding: 0.42rem;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 76%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-bg) 94%, transparent);
  box-shadow: 0 14px 34px rgb(0 0 0 / 12%);
  backdrop-filter: blur(14px);
}

.reader-find__label {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.reader-find__input {
  min-block-size: 36px;
  min-inline-size: 0;
  border: 0;
  border-radius: 999px;
  padding: 0 0.85rem;
  color: var(--reading-fg);
  background: color-mix(in srgb, var(--reading-code-bg) 52%, var(--reading-bg));
  font: inherit;
}

.reader-find__input:focus-visible,
.reader-find__button:focus-visible {
  outline: 2px solid var(--reading-focus);
  outline-offset: 2px;
}

.reader-find__counter {
  min-inline-size: 3.8rem;
  color: var(--reading-fg-muted);
  font-size: 0.82rem;
  text-align: center;
  white-space: nowrap;
}

.reader-find__counter--empty {
  color: var(--reading-accent);
}

.reader-find__actions {
  display: flex;
  gap: 0.2rem;
}

.reader-find__button {
  display: grid;
  place-items: center;
  min-inline-size: 36px;
  min-block-size: 36px;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 76%, transparent);
  border-radius: 999px;
  color: var(--reading-fg);
  background: color-mix(in srgb, var(--reading-bg) 90%, var(--reading-fg) 10%);
  font: inherit;
  cursor: pointer;
}

.reader-find__button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.reader-find__button:not(:disabled):hover {
  border-color: var(--reading-accent);
  color: var(--reading-accent);
}

@media (max-width: 640px) {
  .reader-find {
    inset-inline: 0.75rem;
    grid-template-columns: minmax(0, 1fr) minmax(2.6rem, auto) auto;
    border-radius: 16px;
  }

  .reader-find__counter {
    min-inline-size: 2.6rem;
    font-size: 0.76rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reader-find {
    backdrop-filter: none;
  }
}
</style>
