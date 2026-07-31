<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'

const props = withDefaults(defineProps<{
  isSuppressed?: boolean
}>(), {
  isSuppressed: false,
})

const scrollY = shallowRef(0)
const viewportHeight = shallowRef(0)
const isReducedMotion = shallowRef(false)
let reducedMotionQuery: MediaQueryList | undefined

const isVisible = computed(() => !props.isSuppressed && scrollY.value > viewportHeight.value)

onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  isReducedMotion.value = reducedMotionQuery.matches

  syncScrollState()
  window.addEventListener('scroll', syncScrollState, { passive: true })
  window.addEventListener('resize', syncScrollState, { passive: true })
  reducedMotionQuery.addEventListener('change', syncReducedMotion)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', syncScrollState)
  window.removeEventListener('resize', syncScrollState)
  reducedMotionQuery?.removeEventListener('change', syncReducedMotion)
})

function syncScrollState(): void {
  scrollY.value = window.scrollY
  viewportHeight.value = window.innerHeight
}

function syncReducedMotion(event: MediaQueryListEvent): void {
  isReducedMotion.value = event.matches
}

function scrollToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: isReducedMotion.value ? 'auto' : 'smooth',
  })
}
</script>

<template>
  <button
    v-if="isVisible"
    class="back-to-top pressable focus-ring touch-target"
    type="button"
    aria-label="回到顶部"
    data-testid="back-to-top"
    @click="scrollToTop"
  >
    <span aria-hidden="true">↑</span>
  </button>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: max(1rem, calc(env(safe-area-inset-right) + 0.9rem));
  bottom: max(1rem, calc(env(safe-area-inset-bottom) + 0.9rem));
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  inline-size: var(--touch-target-min);
  block-size: var(--touch-target-min);
  border: var(--border-width-control) solid var(--border-default);
  border-radius: var(--radius-control);
  background: var(--surface-panel);
  color: var(--text-secondary);
  cursor: pointer;
}

.back-to-top:hover,
.back-to-top:focus-visible {
  border-color: var(--accent-primary);
  color: var(--text-accent);
}

.back-to-top:focus-visible {
  outline-color: var(--focus-ring-color);
  box-shadow: var(--focus-ring-shadow);
}

.back-to-top span {
  font-family: var(--reading-font-mono);
  font-size: 1rem;
  line-height: 1;
}

</style>
