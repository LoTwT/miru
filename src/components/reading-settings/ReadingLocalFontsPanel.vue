<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import type { LocalFontOption } from '@/features/settings/localFonts'
import type { ReadingFontFamilyId } from '@/features/settings/readingSettingsOptions'

const props = defineProps<{
  active: boolean
  localFonts: readonly LocalFontOption[]
}>()

const emit = defineEmits<{
  updateFontFamily: [value: ReadingFontFamilyId]
  renameLocalFont: [id: string, name: string]
  deleteLocalFont: [id: string]
}>()

const renamingLocalFontId = shallowRef<string | null>(null)
const renameLocalFontInput = shallowRef('')
const pendingDeleteLocalFontId = shallowRef<string | null>(null)
const normalizedRenameLocalFontInput = computed(() => normalizeLocalFontInput(renameLocalFontInput.value))
const canRenameLocalFont = computed(() =>
  Boolean(normalizedRenameLocalFontInput.value)
  && Boolean(renamingLocalFontId.value)
  && !hasLocalFontName(normalizedRenameLocalFontInput.value, renamingLocalFontId.value ?? undefined),
)

function startRenameLocalFont(font: LocalFontOption): void {
  renamingLocalFontId.value = font.id
  renameLocalFontInput.value = font.name
  pendingDeleteLocalFontId.value = null
}

function cancelRenameLocalFont(): void {
  renamingLocalFontId.value = null
  renameLocalFontInput.value = ''
}

function confirmRenameLocalFont(): void {
  if (!renamingLocalFontId.value || !canRenameLocalFont.value) {
    return
  }

  emit('renameLocalFont', renamingLocalFontId.value, normalizedRenameLocalFontInput.value)
  cancelRenameLocalFont()
}

function confirmRenameLocalFontOnEnter(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  confirmRenameLocalFont()
}

function requestDeleteLocalFont(id: string): void {
  if (pendingDeleteLocalFontId.value === id) {
    emit('deleteLocalFont', id)
    pendingDeleteLocalFontId.value = null
    cancelRenameLocalFont()
    return
  }

  pendingDeleteLocalFontId.value = id
  cancelRenameLocalFont()
}

function hasLocalFontName(name: string, ignoredFontId?: string): boolean {
  const normalizedName = normalizeLocalFontInput(name).toLowerCase()
  return props.localFonts.some(font => font.id !== ignoredFontId && font.name.toLowerCase() === normalizedName)
}

function normalizeLocalFontInput(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 32)
}

watch(() => props.active, (active) => {
  if (active) {
    return
  }

  pendingDeleteLocalFontId.value = null
  cancelRenameLocalFont()
})
</script>

<template>
  <div
    v-if="props.active"
    id="reading-settings-fonts-panel"
    class="reading-settings__content"
    data-testid="reading-settings-fonts-panel"
  >
    <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-fonts-title">
      <h3 id="reading-settings-fonts-title" class="reading-settings__group-title">
        我的字体
      </h3>
      <div v-if="props.localFonts.length > 0" class="reading-settings__saved-presets">
        <article
          v-for="font in props.localFonts"
          :key="font.id"
          class="reading-settings__saved-preset"
          :data-pending-delete="pendingDeleteLocalFontId === font.id"
        >
          <div v-if="renamingLocalFontId === font.id" class="reading-settings__preset-rename">
            <input
              v-model="renameLocalFontInput"
              class="reading-settings__preset-input"
              type="text"
              maxlength="32"
              :aria-label="`重命名字体 ${font.name}`"
              data-settings-item
              @keydown.enter="confirmRenameLocalFontOnEnter"
              @keydown.escape.prevent="cancelRenameLocalFont"
            >
            <button
              class="reading-settings__preset-action"
              type="button"
              :disabled="!canRenameLocalFont"
              data-settings-item
              @click="confirmRenameLocalFont"
            >
              保存
            </button>
            <button
              class="reading-settings__preset-action reading-settings__preset-action--muted"
              type="button"
              data-settings-item
              @click="cancelRenameLocalFont"
            >
              取消
            </button>
          </div>
          <template v-else>
            <div class="reading-settings__saved-preset-summary">
              <strong :style="{ fontFamily: font.fontStack }">{{ font.name }}</strong>
              <span>{{ font.fileName }} · {{ Math.ceil(font.byteSize / 1024) }}KB</span>
            </div>
            <div class="reading-settings__saved-preset-actions">
              <button
                class="reading-settings__preset-action"
                type="button"
                data-settings-item
                @click="emit('updateFontFamily', font.familyId)"
              >
                应用
              </button>
              <button
                class="reading-settings__preset-action reading-settings__preset-action--muted"
                type="button"
                data-settings-item
                @click="startRenameLocalFont(font)"
              >
                重命名
              </button>
              <button
                class="reading-settings__preset-action reading-settings__preset-action--danger"
                type="button"
                data-settings-item
                @click="requestDeleteLocalFont(font.id)"
              >
                {{ pendingDeleteLocalFontId === font.id ? '确认删除' : '删除' }}
              </button>
            </div>
          </template>
        </article>
      </div>
      <p v-else class="reading-settings__subpanel-note">
        还没有上传的字体。
      </p>
      <p class="reading-settings__subpanel-note">
        上传字体只保存在本机;中文等缺失字形会回退系统字体。
      </p>
    </section>
  </div>
</template>

<style scoped>
.reading-settings__content {
  display: grid;
  gap: var(--spacing-3-5);
}

.reading-settings__group {
  padding-block-start: var(--spacing-3);
  border-block-start: var(--border-width-thin) solid var(--border-subtle);
}

.reading-settings__group:first-child {
  padding-block-start: 0;
  border-block-start: 0;
}

.reading-settings__group-title {
  margin: 0 0 0.58rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
}

.reading-settings__saved-presets {
  display: grid;
  gap: 0.55rem;
}

.reading-settings__preset-rename {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.45rem;
}

.reading-settings__preset-input {
  min-block-size: var(--touch-target-min);
  min-inline-size: 0;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-primary);
  font: inherit;
  padding-inline: 0.7rem;
}

.reading-settings__preset-action {
  min-block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  padding-inline: 0.7rem;
}

.reading-settings__preset-action:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.reading-settings__preset-action--muted {
  color: var(--text-secondary);
}

.reading-settings__preset-action--danger {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
}

.reading-settings__saved-preset {
  display: grid;
  gap: 0.55rem;
  padding: 0.62rem;
  border: var(--border-width-surface) solid var(--border-subtle);
  border-radius: var(--radius-card);
  background: var(--surface-subtle);
}

.reading-settings__saved-preset[data-pending-delete="true"] {
  border-color: var(--accent-primary);
  box-shadow: inset 0 0 0 var(--border-width-thin) var(--accent-primary);
}

.reading-settings__saved-preset-summary {
  display: grid;
  gap: 0.16rem;
}

.reading-settings__saved-preset-summary > span {
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.reading-settings__saved-preset-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.reading-settings__subpanel-note {
  margin: 0.65rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
}
</style>
