import { onBeforeUnmount, readonly, shallowRef, watch } from 'vue'

import type { RemoteImageMode, TrustedHtml } from '@/types/reader'

interface UseRenderedMarkdownOptions {
  markdown: () => string
  remoteImageMode: () => RemoteImageMode
}

export function useRenderedMarkdown(options: UseRenderedMarkdownOptions) {
  const html = shallowRef<TrustedHtml>({ value: '' } as TrustedHtml)
  const isRendering = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const colorScheme = shallowRef(getColorScheme())
  const mediaQuery = typeof window === 'undefined'
    ? null
    : window.matchMedia('(prefers-color-scheme: dark)')
  let renderRequestId = 0

  function onColorSchemeChange(event: MediaQueryListEvent): void {
    colorScheme.value = event.matches ? 'dark' : 'light'
  }

  mediaQuery?.addEventListener('change', onColorSchemeChange)

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', onColorSchemeChange)
  })

  watch(
    () => [options.markdown(), options.remoteImageMode(), colorScheme.value] as const,
    async ([markdown, remoteImageMode]) => {
      const requestId = ++renderRequestId

      isRendering.value = true
      error.value = null

      try {
        const { renderMarkdown } = await import('@/lib/markdown/renderer')

        const nextHtml = await renderMarkdown(markdown, {
          colorScheme: colorScheme.value,
          remoteImageMode,
        })

        if (requestId === renderRequestId) {
          html.value = nextHtml
        }
      }
      catch {
        if (requestId === renderRequestId) {
          error.value = '渲染 markdown 时出错。'
        }
      }
      finally {
        if (requestId === renderRequestId) {
          isRendering.value = false
        }
      }
    },
    { immediate: true },
  )

  return {
    html: readonly(html),
    isRendering: readonly(isRendering),
    error: readonly(error),
  }
}

function getColorScheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
