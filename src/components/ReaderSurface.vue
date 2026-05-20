<script setup lang="ts">
import type { ReaderDocument, TrustedHtml } from '@/types/reader'

const props = defineProps<{
  document: ReaderDocument
  html: TrustedHtml
  isRendering: boolean
}>()
</script>

<template>
  <article class="reader-surface" :aria-busy="props.isRendering ? 'true' : 'false'">
    <p class="reader-surface__meta">
      {{ props.document.label }}
    </p>
    <!-- v-html is restricted to TrustedHtml returned by the markdown sanitizer pipeline. -->
    <div class="reader-surface__content" v-html="props.html.value" />
  </article>
</template>

<style scoped>
.reader-surface {
  inline-size: 100%;
  max-inline-size: min(100%, var(--reading-measure));
  margin-inline: auto;
  padding-block: clamp(2rem, 6vw, 5rem);
}

.reader-surface__meta {
  margin: 0 0 2rem;
  color: var(--reading-fg-muted);
  font-family: system-ui, sans-serif;
  font-size: 0.86rem;
}

.reader-surface__content {
  font-family: var(--reading-font-body);
  font-size: var(--reading-font-size);
  line-height: var(--reading-line-height);
}
</style>
