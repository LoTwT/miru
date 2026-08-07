<script setup lang="ts">
import { computed, shallowRef } from 'vue'

import type { ReadingPreset } from '@/features/settings/readingPresets'
import {
  readingColorSchemeOptions,
  readingFontSizeOptions,
  readingThemeStyleOptions,
} from '@/features/settings/readingSettingsOptions'
import type {
  ReadingFontFamilyId,
  ReadingSettingOption,
} from '@/features/settings/readingSettingsOptions'

const props = defineProps<{
  active: boolean
  activePresetName: string
  fontFamilyOptions: readonly ReadingSettingOption<ReadingFontFamilyId>[]
  presets: readonly ReadingPreset[]
}>()

const emit = defineEmits<{
  savePreset: [name: string]
  applyPreset: [id: string]
  renamePreset: [id: string, name: string]
  deletePreset: [id: string]
  reset: []
}>()
const presetNameInput = defineModel<string>('presetNameInput', { required: true })

const renamingPresetId = shallowRef<string | null>(null)
const renamePresetInput = shallowRef('')
const pendingDeletePresetId = shallowRef<string | null>(null)
const normalizedPresetNameInput = computed(() => normalizePresetNameInput(presetNameInput.value))
const normalizedRenamePresetInput = computed(() => normalizePresetNameInput(renamePresetInput.value))
const canSavePreset = computed(() => Boolean(normalizedPresetNameInput.value) && !hasPresetName(normalizedPresetNameInput.value))
const canRenamePreset = computed(() =>
  Boolean(normalizedRenamePresetInput.value)
  && Boolean(renamingPresetId.value)
  && !hasPresetName(normalizedRenamePresetInput.value, renamingPresetId.value ?? undefined),
)

function saveCurrentPreset(): void {
  if (!canSavePreset.value) {
    return
  }

  emit('savePreset', normalizedPresetNameInput.value)
  presetNameInput.value = ''
  pendingDeletePresetId.value = null
}

function saveCurrentPresetOnEnter(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  saveCurrentPreset()
}

function applyPreset(id: string): void {
  emit('applyPreset', id)
  pendingDeletePresetId.value = null
}

function applyDefaultPreset(): void {
  emit('reset')
  pendingDeletePresetId.value = null
}

function startRenamePreset(preset: ReadingPreset): void {
  renamingPresetId.value = preset.id
  renamePresetInput.value = preset.name
  pendingDeletePresetId.value = null
}

function cancelRenamePreset(): void {
  renamingPresetId.value = null
  renamePresetInput.value = ''
}

function confirmRenamePreset(): void {
  if (!renamingPresetId.value || !canRenamePreset.value) {
    return
  }

  emit('renamePreset', renamingPresetId.value, normalizedRenamePresetInput.value)
  cancelRenamePreset()
}

function confirmRenamePresetOnEnter(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  confirmRenamePreset()
}

function requestDeletePreset(id: string): void {
  if (pendingDeletePresetId.value === id) {
    emit('deletePreset', id)
    pendingDeletePresetId.value = null
    cancelRenamePreset()
    return
  }

  pendingDeletePresetId.value = id
  cancelRenamePreset()
}

function describePreset(preset: ReadingPreset): string {
  const themeStyleLabel = readingThemeStyleOptions.find(option => option.id === preset.settings.themeStyle)?.label ?? '风格'
  const colorSchemeLabel = readingColorSchemeOptions.find(option => option.id === preset.settings.colorScheme)?.label ?? '配色'
  const fontLabel = props.fontFamilyOptions.find(option => option.id === preset.settings.fontFamily)?.label ?? '默认字体'
  const fontSize = readingFontSizeOptions.find(option => option.id === preset.settings.fontSize)?.tokenValue ?? '18px'

  return `${fontLabel} · ${fontSize} · ${themeStyleLabel} / ${colorSchemeLabel}`
}

function hasPresetName(name: string, ignoredPresetId?: string): boolean {
  const normalizedName = normalizePresetNameInput(name).toLowerCase()
  return props.presets.some(preset => preset.id !== ignoredPresetId && preset.name.toLowerCase() === normalizedName)
}

function normalizePresetNameInput(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 32)
}
</script>

<template>
  <div
    v-if="props.active"
    id="reading-settings-presets-panel"
    class="reading-settings__content"
    data-testid="reading-settings-presets-panel"
  >
    <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-presets-title">
      <h3 id="reading-settings-presets-title" class="reading-settings__group-title">
        当前快照
      </h3>
      <div class="reading-settings__preset-save">
        <label class="reading-settings__preset-input-label" for="reading-preset-name">
          存为预设
        </label>
        <div class="reading-settings__preset-input-row">
          <input
            id="reading-preset-name"
            v-model="presetNameInput"
            class="reading-settings__preset-input"
            type="text"
            maxlength="32"
            placeholder="例如 夜间长文"
            data-settings-item
            @keydown.enter="saveCurrentPresetOnEnter"
          >
          <button
            class="reading-settings__preset-action"
            type="button"
            :disabled="!canSavePreset"
            data-settings-item
            @click="saveCurrentPreset"
          >
            保存
          </button>
        </div>
        <p v-if="normalizedPresetNameInput && hasPresetName(normalizedPresetNameInput)" class="reading-settings__subpanel-note">
          已有同名预设，不会覆盖。
        </p>
        <p v-else class="reading-settings__subpanel-note">
          保存当前字体、版面、风格、配色、对比和大纲位置。
        </p>
      </div>
    </section>

    <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-presets-built-in-title">
      <h3 id="reading-settings-presets-built-in-title" class="reading-settings__group-title">
        内置预设
      </h3>
      <button
        class="reading-settings__preset-item"
        type="button"
        data-settings-item
        @click="applyDefaultPreset"
      >
        <span>
          <strong>默认</strong>
          <span>Newsreader · 标准版面 · 跟随系统</span>
        </span>
        <span aria-hidden="true">应用</span>
      </button>
    </section>

    <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-presets-saved-title">
      <h3 id="reading-settings-presets-saved-title" class="reading-settings__group-title">
        已保存
      </h3>
      <div v-if="props.presets.length > 0" class="reading-settings__saved-presets">
        <article
          v-for="preset in props.presets"
          :key="preset.id"
          class="reading-settings__saved-preset"
          :data-pending-delete="pendingDeletePresetId === preset.id"
        >
          <div v-if="renamingPresetId === preset.id" class="reading-settings__preset-rename">
            <input
              v-model="renamePresetInput"
              class="reading-settings__preset-input"
              type="text"
              maxlength="32"
              :aria-label="`重命名预设 ${preset.name}`"
              data-settings-item
              @keydown.enter="confirmRenamePresetOnEnter"
              @keydown.escape.prevent="cancelRenamePreset"
            >
            <button
              class="reading-settings__preset-action"
              type="button"
              :disabled="!canRenamePreset"
              data-settings-item
              @click="confirmRenamePreset"
            >
              保存
            </button>
            <button
              class="reading-settings__preset-action reading-settings__preset-action--muted"
              type="button"
              data-settings-item
              @click="cancelRenamePreset"
            >
              取消
            </button>
          </div>
          <template v-else>
            <div class="reading-settings__saved-preset-summary">
              <strong>{{ preset.name }}</strong>
              <span>{{ describePreset(preset) }}</span>
            </div>
            <div class="reading-settings__saved-preset-actions">
              <button
                class="reading-settings__preset-action"
                type="button"
                data-settings-item
                @click="applyPreset(preset.id)"
              >
                应用
              </button>
              <button
                class="reading-settings__preset-action reading-settings__preset-action--muted"
                type="button"
                data-settings-item
                @click="startRenamePreset(preset)"
              >
                重命名
              </button>
              <button
                class="reading-settings__preset-action reading-settings__preset-action--danger"
                type="button"
                data-settings-item
                @click="requestDeletePreset(preset.id)"
              >
                {{ pendingDeletePresetId === preset.id ? '确认删除' : '删除' }}
              </button>
            </div>
          </template>
        </article>
      </div>
      <p v-else class="reading-settings__subpanel-note">
        还没有保存的预设。
      </p>
      <p class="reading-settings__subpanel-note">
        当前: {{ props.activePresetName }}
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

.reading-settings__preset-item {
  min-block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  inline-size: 100%;
  padding: 0.45rem 0.65rem;
  text-align: start;
}

.reading-settings__preset-item > span:first-child {
  display: grid;
  gap: 0.18rem;
}

.reading-settings__preset-item > span:first-child > span {
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.reading-settings__preset-save,
.reading-settings__saved-presets {
  display: grid;
  gap: 0.55rem;
}

.reading-settings__preset-input-label {
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.reading-settings__preset-input-row,
.reading-settings__preset-rename {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
}

.reading-settings__preset-rename {
  grid-template-columns: minmax(0, 1fr) auto auto;
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

.reading-settings__preset-item:hover,
.reading-settings__preset-item:focus-visible {
  border-color: var(--accent-primary);
}
</style>
