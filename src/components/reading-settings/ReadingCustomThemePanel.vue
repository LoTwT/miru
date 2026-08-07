<script setup lang="ts">
import { computed } from 'vue'

import {
  getCustomThemeChecks,
  hasReadableCustomTheme,
} from '@/features/settings/readingSettingsOptions'
import type { ReadingCustomThemeState } from '@/features/settings/readingSettingsOptions'

const props = defineProps<{
  active: boolean
  customTheme: Readonly<ReadingCustomThemeState>
}>()

const emit = defineEmits<{
  updateCustomTheme: [value: Partial<ReadingCustomThemeState>]
  autoFixCustomTheme: []
}>()

const customThemeChecks = computed(() => getCustomThemeChecks(props.customTheme))
const isCustomThemeReadable = computed(() => hasReadableCustomTheme(props.customTheme))
const hasCustomThemeBodyContrastIssue = computed(() => customThemeChecks.value.some(check => check.id === 'fg' && !check.passes))
const hasCustomThemeAccentContrastIssue = computed(() => customThemeChecks.value.some(check => check.id === 'accent' && !check.passes))
const customThemeWarningSeverity = computed(() => hasCustomThemeBodyContrastIssue.value ? 'critical' : 'notice')
const customThemeWarningText = computed(() => {
  if (hasCustomThemeBodyContrastIssue.value && hasCustomThemeAccentContrastIssue.value) {
    return '正文与强调色对比不足，正文几乎无法阅读。'
  }

  return hasCustomThemeBodyContrastIssue.value
    ? '正文对比不足，当前配色几乎无法阅读。'
    : '强调色对比不足，链接和重点可能不清晰。'
})

function updateCustomThemeColor(key: keyof ReadingCustomThemeState, event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  emit('updateCustomTheme', { [key]: input.value })
}
</script>

<template>
  <div
    v-if="props.active"
    id="reading-settings-custom-theme-panel"
    class="reading-settings__content"
    data-testid="reading-settings-custom-theme-panel"
  >
    <section class="reading-settings__group reading-settings__group--subpanel" aria-labelledby="reading-settings-custom-theme-title">
      <h3 id="reading-settings-custom-theme-title" class="reading-settings__group-title">
        核心色
      </h3>

      <div class="reading-settings__color-list">
        <label class="reading-settings__color-row">
          <span>
            <strong>背景</strong>
            <span>{{ props.customTheme.bg }}</span>
          </span>
          <input
            class="reading-settings__color-input"
            type="color"
            :value="props.customTheme.bg"
            aria-label="自定义配色 背景"
            data-settings-item
            @input="updateCustomThemeColor('bg', $event)"
          >
        </label>
        <label class="reading-settings__color-row">
          <span>
            <strong>正文</strong>
            <span>{{ props.customTheme.fg }}</span>
          </span>
          <input
            class="reading-settings__color-input"
            type="color"
            :value="props.customTheme.fg"
            aria-label="自定义配色 正文"
            data-settings-item
            @input="updateCustomThemeColor('fg', $event)"
          >
        </label>
        <label class="reading-settings__color-row">
          <span>
            <strong>强调</strong>
            <span>{{ props.customTheme.accent }}</span>
          </span>
          <input
            class="reading-settings__color-input"
            type="color"
            :value="props.customTheme.accent"
            aria-label="自定义配色 强调"
            data-settings-item
            @input="updateCustomThemeColor('accent', $event)"
          >
        </label>
      </div>

      <div class="reading-settings__contrast-list" aria-label="自定义配色 AA 校验">
        <div
          v-for="check in customThemeChecks"
          :key="check.id"
          class="reading-settings__contrast-row"
          :data-pass="check.passes"
        >
          <span>{{ check.label }}</span>
          <strong>{{ check.ratio.toFixed(2) }}:1</strong>
          <span>{{ check.passes ? '✓' : '✗' }}</span>
        </div>
      </div>

      <p
        v-if="!isCustomThemeReadable"
        class="reading-settings__warning"
        :data-severity="customThemeWarningSeverity"
        role="status"
      >
        {{ customThemeWarningText }}
      </p>

      <button
        class="reading-settings__preset-item"
        type="button"
        data-settings-item
        @click="emit('autoFixCustomTheme')"
      >
        <span>
          <strong>自动修正到 AA</strong>
          <span>只调整正文和强调色</span>
        </span>
        <span aria-hidden="true">应用</span>
      </button>
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

.reading-settings__color-list,
.reading-settings__contrast-list {
  display: grid;
  gap: 0.5rem;
}

.reading-settings__color-row,
.reading-settings__contrast-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  min-block-size: var(--touch-target-min);
  padding: 0.45rem 0.6rem;
  border: var(--border-width-surface) solid var(--border-subtle);
  border-radius: var(--radius-card);
  background: var(--surface-subtle);
}

.reading-settings__color-row > span {
  display: grid;
  gap: 0.16rem;
}

.reading-settings__color-row > span > span {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.76rem;
}

.reading-settings__color-input {
  inline-size: var(--touch-target-min);
  block-size: var(--touch-target-min);
  padding: 2px;
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-elevated);
  cursor: pointer;
}

.reading-settings__contrast-list {
  margin-block-start: 0.75rem;
}

.reading-settings__contrast-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-block-size: 36px;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.reading-settings__contrast-row[data-pass="true"] {
  color: var(--text-primary);
}

.reading-settings__contrast-row[data-pass="false"] {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  font-weight: 700;
}

.reading-settings__warning {
  margin: 0.75rem 0;
  border: var(--border-width-surface) solid var(--status-warning-border);
  border-radius: var(--radius-card);
  background: var(--status-warning-bg);
  color: var(--status-warning-fg);
  padding: 0.65rem 0.75rem;
  font-size: 0.82rem;
  font-weight: 700;
}

.reading-settings__warning[data-severity="critical"] {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger-fg);
  box-shadow: inset 0 0 0 var(--border-width-thin) var(--status-danger-border);
  font-size: 0.86rem;
}

.reading-settings__preset-item:hover,
.reading-settings__preset-item:focus-visible {
  border-color: var(--accent-primary);
}
</style>
