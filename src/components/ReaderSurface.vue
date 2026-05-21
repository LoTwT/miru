<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'

import { enhanceCollapsibleHeadings } from '@/features/reader/collapsibleHeadings'
import type { ReaderDocument, TrustedHtml } from '@/types/reader'

const props = defineProps<{
  document: ReaderDocument
  html: TrustedHtml
  isRendering: boolean
}>()

const articleRef = useTemplateRef<HTMLElement>('article')
const contentRef = useTemplateRef<HTMLElement>('content')
let cleanupCollapsibleHeadings: (() => void) | undefined

onMounted(() => {
  void enhanceCurrentContent()
})

watch(() => props.html.value, () => {
  void enhanceCurrentContent()
})

onBeforeUnmount(() => {
  cleanupCollapsibleHeadings?.()
})

defineExpose({
  focus: () => articleRef.value?.focus(),
})

async function enhanceCurrentContent(): Promise<void> {
  cleanupCollapsibleHeadings?.()
  cleanupCollapsibleHeadings = undefined

  await nextTick()

  if (contentRef.value) {
    cleanupCollapsibleHeadings = enhanceCollapsibleHeadings(contentRef.value)
  }
}
</script>

<template>
  <article
    ref="article"
    class="reader-surface"
    :aria-busy="props.isRendering ? 'true' : 'false'"
    tabindex="-1"
  >
    <p class="reader-surface__meta">
      {{ props.document.label }}
    </p>
    <!-- v-html is restricted to TrustedHtml returned by the markdown sanitizer pipeline. -->
    <div ref="content" class="reader-surface__content" v-html="props.html.value" />
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
  --reader-heading-gutter: 3.55rem;
  font-family: var(--reading-font-body);
  font-size: var(--reading-font-size);
  line-height: var(--reading-line-height);
}
</style>
