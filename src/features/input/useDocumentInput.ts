import { readonly, shallowRef } from 'vue'

import {
  ensureReadableUrlContentType,
  getBareUrlPaste,
  normalizeMarkdownUrl,
  UnsupportedUrlContentTypeError,
  UrlFetchHttpError,
} from '@/features/input/urlInput'
import type { LibrarySource } from '@/features/library/types'
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

      const bareUrl = getBareUrlPaste(text)
      if (bareUrl) {
        await loadFromUrl(bareUrl)
        return
      }

      loadFromText(text, 'paste', 'Pasted markdown', { kind: 'paste' })
    }
    catch {
      setError('无法读取剪贴板', '可以直接按 Cmd+V / Ctrl+V 粘贴，或拖入 .md 文件。')
    }
  }

  function loadFromText(
    markdown: string,
    source: ReaderDocument['source'] = 'paste',
    label = 'Markdown',
    librarySource?: LibrarySource,
  ): void {
    error.value = null
    options.onDocument({ source, label, markdown, librarySource })
  }

  async function loadFromFile(file: File): Promise<void> {
    if (!isReadableMarkdownFile(file)) {
      setError('无法读取这个文件', '请确认文件是 .md、.markdown 或纯文本。')
      return
    }

    const text = await file.text()
    loadFromText(text, 'file', file.name, {
      kind: 'file',
      fileName: file.name,
      mimeType: file.type || 'text/plain',
    })
  }

  async function loadFromUrl(url: string): Promise<void> {
    const normalized = normalizeMarkdownUrl(url)

    if (!normalized) {
      setError('URL 格式不支持', '请使用 http/https 的 markdown 或纯文本链接。')
      return
    }

    isFetchingUrl.value = true
    error.value = null

    try {
      const response = await fetch(normalized.requestUrl, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })

      if (!response.ok) {
        throw new UrlFetchHttpError(response.status)
      }

      ensureReadableUrlContentType(response.headers.get('content-type'))

      const text = await response.text()
      loadFromText(text, 'url', normalized.inputUrl, {
        kind: 'url',
        inputUrl: normalized.inputUrl,
        requestUrl: normalized.requestUrl,
        domain: new URL(normalized.requestUrl).hostname,
      })
    }
    catch (reason) {
      if (reason instanceof UnsupportedUrlContentTypeError) {
        setError('无法作为 markdown 拉取', '这个链接像网页或文件。试试它的 raw / 源文件链接，或直接粘贴 markdown。')
      }
      else if (reason instanceof UrlFetchHttpError) {
        if (reason.status === 404) {
          setError('链接打不开', '404 或不存在——核对一下地址。')
        }
        else {
          setError('链接打不开', `HTTP ${reason.status}——核对一下地址，或直接把内容粘贴进 miru。`)
        }
      }
      else if (navigator.onLine === false) {
        setError('现在像是离线', '联网后再试，或先粘贴 / 打开本地文件。')
      }
      else {
        setError('无法跨域读取', '该站点未开放跨域。换 raw 链接，或直接把内容粘贴进 miru。')
      }
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
