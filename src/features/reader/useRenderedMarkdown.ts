import { readonly, shallowRef, watch } from 'vue'

import type { RemoteImageMode, TrustedHtml } from '@/types/reader'

interface UseRenderedMarkdownOptions {
  markdown: () => string
  remoteImageMode: () => RemoteImageMode
}

export function useRenderedMarkdown(options: UseRenderedMarkdownOptions) {
  const html = shallowRef<TrustedHtml>({ value: '' } as TrustedHtml)
  const isRendering = shallowRef(false)
  const error = shallowRef<string | null>(null)
  let renderRequestId = 0

  watch(
    () => [options.markdown(), options.remoteImageMode()] as const,
    async ([markdown, remoteImageMode]) => {
      const requestId = ++renderRequestId

      isRendering.value = true
      error.value = null

      try {
        const { renderMarkdown } = await import('@/lib/markdown/renderer')

        const nextHtml = await renderMarkdown(markdown, {
          remoteImageMode,
          syntaxHighlighting: false,
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
