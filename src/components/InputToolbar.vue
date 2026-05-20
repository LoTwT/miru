<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue'

const props = defineProps<{
  isFetchingUrl: boolean
}>()

const emit = defineEmits<{
  paste: []
  openFile: [file: File]
  fetchUrl: [url: string]
  clear: []
}>()

const url = shallowRef('')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInput')

function submitUrl(): void {
  if (!url.value.trim()) {
    return
  }

  emit('fetchUrl', url.value)
}

function openFileDialog(): void {
  fileInputRef.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (file) {
    emit('openFile', file)
  }

  input.value = ''
}
</script>

<template>
  <section class="input-toolbar" aria-label="Markdown input">
    <div class="input-toolbar__actions">
      <button class="input-toolbar__button" type="button" @click="emit('paste')">
        粘贴
      </button>
      <button class="input-toolbar__button" type="button" @click="openFileDialog">
        打开文件
      </button>
      <button class="input-toolbar__button input-toolbar__button--quiet" type="button" @click="emit('clear')">
        示例
      </button>
      <input
        ref="fileInput"
        class="input-toolbar__file"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        @change="onFileChange"
      >
    </div>

    <form class="input-toolbar__url" @submit.prevent="submitUrl">
      <label class="input-toolbar__label" for="url-input">URL</label>
      <input
        id="url-input"
        v-model="url"
        class="input-toolbar__url-input"
        type="url"
        inputmode="url"
        placeholder="https://example.com/readme.md"
      >
      <button class="input-toolbar__button" type="submit" :disabled="props.isFetchingUrl">
        {{ props.isFetchingUrl ? '拉取中' : '拉取' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.input-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border: 1px solid var(--reading-rule);
  border-radius: 8px;
  background: color-mix(in srgb, var(--reading-code-bg) 76%, transparent);
}

.input-toolbar__actions,
.input-toolbar__url {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.input-toolbar__button {
  min-height: 2.25rem;
  padding: 0 0.8rem;
  border: 1px solid var(--reading-rule);
  border-radius: 999px;
  background: var(--reading-bg);
  color: var(--reading-fg);
  font: inherit;
  cursor: pointer;
}

.input-toolbar__button:hover,
.input-toolbar__button:focus-visible {
  border-color: var(--reading-accent);
}

.input-toolbar__button:disabled {
  cursor: progress;
  opacity: 0.6;
}

.input-toolbar__button--quiet {
  color: var(--reading-fg-muted);
}

.input-toolbar__file {
  display: none;
}

.input-toolbar__label {
  color: var(--reading-fg-muted);
  font-size: 0.9rem;
}

.input-toolbar__url-input {
  width: min(42vw, 22rem);
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--reading-rule);
  border-radius: 999px;
  background: var(--reading-bg);
  color: var(--reading-fg);
  font: inherit;
}

@media (max-width: 700px) {
  .input-toolbar {
    align-items: stretch;
  }

  .input-toolbar__url,
  .input-toolbar__url-input {
    width: 100%;
  }
}
</style>
