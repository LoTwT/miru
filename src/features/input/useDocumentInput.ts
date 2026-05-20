import { readonly, shallowRef } from 'vue'

import type { ReaderDocument, ReaderError } from '@/types/reader'

interface UseDocumentInputOptions {
  onDocument: (document: ReaderDocument) => void
}

export function useDocumentInput(options: UseDocumentInputOptions) {
  const isFetchingUrl = shallowRef(false)
  const error = shallowRef<ReaderError | null>(null)

  async function loadFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setError('剪贴板为空', '复制一段 markdown 后再试。')
        return
      }

      loadFromText(text, 'paste', 'Pasted markdown')
    }
    catch {
      setError('无法读取剪贴板', '可以直接按 Cmd+V / Ctrl+V 粘贴，或拖入 .md 文件。')
    }
  }

  function loadFromText(markdown: string, source: ReaderDocument['source'] = 'paste', label = 'Markdown'): void {
    error.value = null
    options.onDocument({ source, label, markdown })
  }

  async function loadFromFile(file: File): Promise<void> {
    if (!isReadableMarkdownFile(file)) {
      setError('无法读取这个文件', '请确认文件是 .md、.markdown 或纯文本。')
      return
    }

    const text = await file.text()
    loadFromText(text, 'file', file.name)
  }

  async function loadFromUrl(url: string): Promise<void> {
    const trimmed = url.trim()

    if (!/^https?:\/\//i.test(trimmed)) {
      setError('URL 格式不支持', 'V0 只支持 http/https 的原始 markdown URL。')
      return
    }

    isFetchingUrl.value = true
    error.value = null

    try {
      const response = await fetch(trimmed, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const text = await response.text()
      loadFromText(text, 'url', trimmed)
    }
    catch {
      setError('拉取失败', '可能是跨域限制或链接失效。可以复制 raw 内容后粘贴进 miru。')
    }
    finally {
      isFetchingUrl.value = false
    }
  }

  function setError(title: string, detail: string): void {
    error.value = { title, detail }
  }

  return {
    error: readonly(error),
    isFetchingUrl: readonly(isFetchingUrl),
    loadFromClipboard,
    loadFromFile,
    loadFromText,
    loadFromUrl,
  }
}

function isReadableMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || file.type.startsWith('text/')
}
