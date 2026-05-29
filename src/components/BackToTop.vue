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
    class="back-to-top"
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
  z-index: 24;
  display: grid;
  place-items: center;
  inline-size: 44px;
  block-size: 44px;
  border: 1px solid color-mix(in srgb, var(--reading-rule) 82%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--reading-bg) 90%, transparent);
  box-shadow: 0 16px 40px rgb(0 0 0 / 14%);
  color: var(--reading-fg-muted);
  cursor: pointer;
  backdrop-filter: blur(14px);
  transition:
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease,
    opacity 150ms ease;
}

.back-to-top:hover,
.back-to-top:focus-visible {
  border-color: color-mix(in srgb, var(--reading-accent) 44%, var(--reading-rule));
  color: var(--reading-accent);
  transform: translateY(-1px);
}

.back-to-top:focus-visible {
  outline: 3px solid var(--reading-focus);
  outline-offset: 3px;
}

.back-to-top span {
  font-family: var(--reading-font-mono);
  font-size: 1rem;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .back-to-top {
    transition: none;
  }

  .back-to-top:hover,
  .back-to-top:focus-visible {
    transform: none;
  }
}
</style>
