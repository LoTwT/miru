import { getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue'

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
  onDocument: (document: ReaderDocument, operation: DocumentInputOperation) => void
  onPdf?: (file: File, operation: DocumentInputOperation) => void | Promise<void>
}

export interface DocumentInputOperation {
  readonly isCurrent: () => boolean
}

export const MAX_MARKDOWN_INPUT_BYTES = 5 * 1024 * 1024
export const MAX_PDF_INPUT_BYTES = 100 * 1024 * 1024

class InputSizeLimitError extends Error {
  constructor() {
    super('Input exceeds the configured size limit')
    this.name = 'InputSizeLimitError'
  }
}

export function useDocumentInput(options: UseDocumentInputOptions) {
  const isFetchingUrl = shallowRef(false)
  const error = shallowRef<ReaderError | null>(null)
  let activeUrlController: AbortController | null = null
  let inputSequence = 0

  if (getCurrentScope()) {
    onScopeDispose(() => {
      inputSequence += 1
      cancelActiveUrlFetch()
    })
  }

  async function loadFromClipboard(): Promise<void> {
    const operation = beginInputOperation()

    try {
      const text = await navigator.clipboard.readText()
      if (!operation.isCurrent()) {
        return
      }

      if (!text.trim()) {
        setError('剪贴板为空', '复制一段 markdown 后再试。')
        return
      }

      const bareUrl = getBareUrlPaste(text)
      if (bareUrl) {
        await loadFromUrl(bareUrl)
        return
      }

      if (exceedsTextByteLimit(text, MAX_MARKDOWN_INPUT_BYTES)) {
        setMarkdownSizeError()
        return
      }

      commitDocument(text, 'paste', 'Pasted markdown', operation, { kind: 'paste' })
    }
    catch {
      if (!operation.isCurrent()) {
        return
      }

      setError('无法读取剪贴板', '可以直接按 Cmd+V / Ctrl+V 粘贴，或拖入 .md 文件。')
    }
  }

  function loadFromText(
    markdown: string,
    source: ReaderDocument['source'] = 'paste',
    label = 'Markdown',
    librarySource?: LibrarySource,
  ): void {
    const operation = beginInputOperation()

    if (exceedsTextByteLimit(markdown, MAX_MARKDOWN_INPUT_BYTES)) {
      setMarkdownSizeError()
      return
    }

    commitDocument(markdown, source, label, operation, librarySource)
  }

  function commitDocument(
    markdown: string,
    source: ReaderDocument['source'],
    label: string,
    operation: DocumentInputOperation,
    librarySource?: LibrarySource,
  ): void {
    error.value = null
    options.onDocument({ source, label, markdown, librarySource }, operation)
  }

  async function loadFromFile(file: File): Promise<void> {
    const operation = beginInputOperation()

    if (isPdfFile(file)) {
      if (!options.onPdf) {
        setError('PDF 还不能打开', '这个版本只能读取 .md、.markdown 或纯文本。')
        return
      }

      if (file.size > MAX_PDF_INPUT_BYTES) {
        setError('PDF 太大，无法打开', 'PDF 上限为 100 MB。请压缩或拆分文件后再试。')
        return
      }

      if (!operation.isCurrent()) {
        return
      }

      error.value = null
      await options.onPdf(file, operation)
      return
    }

    if (!isReadableMarkdownFile(file)) {
      setError('无法读取这个文件', '请确认文件是 .md、.markdown、纯文本或 PDF。')
      return
    }

    if (file.size > MAX_MARKDOWN_INPUT_BYTES) {
      setMarkdownSizeError()
      return
    }

    const text = await file.text()
    if (!operation.isCurrent()) {
      return
    }

    if (exceedsTextByteLimit(text, MAX_MARKDOWN_INPUT_BYTES)) {
      setMarkdownSizeError()
      return
    }

    commitDocument(text, 'file', file.name, operation, {
      kind: 'file',
      fileName: file.name,
      mimeType: file.type || 'text/plain',
    })
  }

  async function loadFromUrl(url: string): Promise<void> {
    const operation = beginInputOperation()

    const normalized = normalizeMarkdownUrl(url)

    if (!normalized) {
      setError('URL 格式不支持', '请使用 http/https 的 markdown 或纯文本链接。')
      return
    }

    const controller = new AbortController()
    activeUrlController = controller
    isFetchingUrl.value = true
    error.value = null

    try {
      const response = await fetch(normalized.requestUrl, {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new UrlFetchHttpError(response.status)
      }

      ensureReadableUrlContentType(response.headers.get('content-type'))
      ensureContentLengthWithinLimit(response, MAX_MARKDOWN_INPUT_BYTES)

      const text = await readBoundedResponseText(response, MAX_MARKDOWN_INPUT_BYTES)

      if (controller.signal.aborted || !operation.isCurrent()) {
        return
      }

      commitDocument(text, 'url', normalized.inputUrl, operation, {
        kind: 'url',
        inputUrl: normalized.inputUrl,
        requestUrl: normalized.requestUrl,
        domain: new URL(normalized.requestUrl).hostname,
      })
    }
    catch (reason) {
      if (controller.signal.aborted || !operation.isCurrent()) {
        return
      }

      if (reason instanceof InputSizeLimitError) {
        setError('链接内容太大', 'miru 最多读取 5 MB 的 markdown。请换较小的文件，或下载后拆分再打开。')
      }
      else if (reason instanceof UnsupportedUrlContentTypeError) {
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
      if (activeUrlController === controller) {
        activeUrlController = null
        isFetchingUrl.value = false
      }
    }
  }

  function cancelActiveUrlFetch(): void {
    const controller = activeUrlController
    activeUrlController = null
    isFetchingUrl.value = false
    controller?.abort()
  }

  function beginInputOperation(): DocumentInputOperation {
    inputSequence += 1
    const sequence = inputSequence
    cancelActiveUrlFetch()
    return {
      isCurrent: () => sequence === inputSequence,
    }
  }

  function setMarkdownSizeError(): void {
    setError('内容太大，无法打开', 'Markdown 上限为 5 MB。请缩短内容，或拆成多个文档。')
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

function exceedsTextByteLimit(text: string, maximumBytes: number): boolean {
  if (text.length > maximumBytes) {
    return true
  }

  return new TextEncoder().encode(text).byteLength > maximumBytes
}

function ensureContentLengthWithinLimit(response: Response, maximumBytes: number): void {
  const contentLength = response.headers.get('content-length')
  if (contentLength === null) {
    return
  }

  const parsedLength = Number(contentLength)
  if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw new InputSizeLimitError()
  }
}

async function readBoundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let receivedBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      receivedBytes += value.byteLength
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new InputSizeLimitError()
      }

      chunks.push(decoder.decode(value, { stream: true }))
    }

    chunks.push(decoder.decode())
    return chunks.join('')
  }
  finally {
    reader.releaseLock()
  }
}

function isReadableMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.md')
    || name.endsWith('.markdown')
    || name.endsWith('.txt')
    || name.endsWith('.text')
    || file.type.startsWith('text/')
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf'
    || file.type === 'application/x-pdf'
    || file.name.toLowerCase().endsWith('.pdf')
}
