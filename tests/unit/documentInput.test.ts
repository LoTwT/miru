import type { EffectScope } from 'vue'
import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_MARKDOWN_INPUT_BYTES,
  MAX_PDF_INPUT_BYTES,
  type DocumentInputOperation,
  useDocumentInput,
} from '@/features/input/useDocumentInput'
import type { ReaderDocument } from '@/types/reader'

const activeScopes: EffectScope[] = []
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  for (const scope of activeScopes.splice(0)) {
    scope.stop()
  }

  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  }
  else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }

  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('document input size limits', () => {
  it('rejects an oversized paste before publishing a document', () => {
    const onDocument = vi.fn()
    const input = createDocumentInput(onDocument)

    input.loadFromText('a'.repeat(MAX_MARKDOWN_INPUT_BYTES + 1))

    expect(onDocument).not.toHaveBeenCalled()
    expect(input.error.value).toEqual({
      title: '内容太大，无法打开',
      detail: 'Markdown 上限为 5 MB。请缩短内容，或拆成多个文档。',
    })
  })

  it('measures paste limits in UTF-8 bytes rather than JavaScript characters', () => {
    const onDocument = vi.fn()
    const input = createDocumentInput(onDocument)
    const markdown = '😀'.repeat(Math.floor(MAX_MARKDOWN_INPUT_BYTES / 4) + 1)

    expect(markdown.length).toBeLessThan(MAX_MARKDOWN_INPUT_BYTES)
    input.loadFromText(markdown)

    expect(onDocument).not.toHaveBeenCalled()
    expect(input.error.value?.title).toBe('内容太大，无法打开')
  })

  it('applies the markdown limit to clipboard input', async () => {
    const onDocument = vi.fn()
    const input = createDocumentInput(onDocument)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('a'.repeat(MAX_MARKDOWN_INPUT_BYTES + 1)),
      },
    })

    await input.loadFromClipboard()

    expect(onDocument).not.toHaveBeenCalled()
    expect(input.error.value?.title).toBe('内容太大，无法打开')
  })

  it('rejects oversized local markdown and PDF files before reading them', async () => {
    const onDocument = vi.fn()
    const onPdf = vi.fn()
    const input = createDocumentInput(onDocument, onPdf)
    const readText = vi.fn()
    const markdownFile = {
      name: 'large.md',
      type: 'text/markdown',
      size: MAX_MARKDOWN_INPUT_BYTES + 1,
      text: readText,
    } as unknown as File
    const pdfFile = {
      name: 'large.pdf',
      type: 'application/pdf',
      size: MAX_PDF_INPUT_BYTES + 1,
    } as File

    await input.loadFromFile(markdownFile)

    expect(readText).not.toHaveBeenCalled()
    expect(onDocument).not.toHaveBeenCalled()
    expect(input.error.value?.title).toBe('内容太大，无法打开')

    await input.loadFromFile(pdfFile)

    expect(onPdf).not.toHaveBeenCalled()
    expect(input.error.value).toEqual({
      title: 'PDF 太大，无法打开',
      detail: 'PDF 上限为 100 MB。请压缩或拆分文件后再试。',
    })
  })
})

describe('bounded URL loading', () => {
  it('rejects a declared oversized response before accepting its body', async () => {
    const onDocument = vi.fn()
    const input = createDocumentInput(onDocument)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('small body', {
      headers: {
        'content-length': String(MAX_MARKDOWN_INPUT_BYTES + 1),
        'content-type': 'text/plain',
      },
    })))

    await input.loadFromUrl('https://example.com/large.md')

    expect(onDocument).not.toHaveBeenCalled()
    expect(input.error.value?.title).toBe('链接内容太大')
    expect(input.isFetchingUrl.value).toBe(false)
  })

  it('enforces the byte limit while streaming when content-length is absent', async () => {
    const onDocument = vi.fn()
    const input = createDocumentInput(onDocument)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_MARKDOWN_INPUT_BYTES))
        controller.enqueue(new Uint8Array([1]))
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      headers: { 'content-type': 'text/markdown' },
    })))

    await input.loadFromUrl('https://example.com/streamed.md')

    expect(onDocument).not.toHaveBeenCalled()
    expect(input.error.value?.title).toBe('链接内容太大')
    expect(input.isFetchingUrl.value).toBe(false)
  })

  it('decodes UTF-8 correctly when a character crosses stream chunks', async () => {
    const documents: ReaderDocument[] = []
    const input = createDocumentInput(document => documents.push(document))
    const encoded = new TextEncoder().encode('# 你好')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 3))
        controller.enqueue(encoded.slice(3))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    })))

    await input.loadFromUrl('https://example.com/readme.md')

    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      markdown: '# 你好',
      source: 'url',
      label: 'https://example.com/readme.md',
    })
    expect(input.error.value).toBeNull()
  })

  it('aborts an earlier URL request and lets only the latest request win', async () => {
    const documents: ReaderDocument[] = []
    const input = createDocumentInput(document => documents.push(document))
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)

      if (signals.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          }, { once: true })
        })
      }

      return Promise.resolve(new Response('# second', {
        headers: { 'content-type': 'text/markdown' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstRequest = input.loadFromUrl('https://example.com/first.md')
    const secondRequest = input.loadFromUrl('https://example.com/second.md')
    await Promise.all([firstRequest, secondRequest])

    expect(signals[0]?.aborted).toBe(true)
    expect(documents.map(document => document.label)).toEqual(['https://example.com/second.md'])
    expect(input.error.value).toBeNull()
    expect(input.isFetchingUrl.value).toBe(false)
  })

  it('does not let an older clipboard read cancel a newer URL request', async () => {
    const documents: ReaderDocument[] = []
    const input = createDocumentInput(document => documents.push(document))
    const clipboardText = createDeferred<string>()
    const urlResponse = createDeferred<Response>()
    let urlSignal: AbortSignal | undefined
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(() => clipboardText.promise) },
    })
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      urlSignal = init?.signal as AbortSignal
      return urlResponse.promise
    }))

    const clipboardRequest = input.loadFromClipboard()
    const urlRequest = input.loadFromUrl('https://example.com/latest.md')
    clipboardText.resolve('# stale clipboard')
    await clipboardRequest

    expect(urlSignal?.aborted).toBe(false)
    expect(documents).toEqual([])

    urlResponse.resolve(new Response('# latest URL', {
      headers: { 'content-type': 'text/markdown' },
    }))
    await urlRequest

    expect(documents.map(document => document.label)).toEqual(['https://example.com/latest.md'])
  })

  it('does not let an older file read cancel a newer URL request', async () => {
    const documents: ReaderDocument[] = []
    const input = createDocumentInput(document => documents.push(document))
    const fileText = createDeferred<string>()
    const urlResponse = createDeferred<Response>()
    let urlSignal: AbortSignal | undefined
    const file = {
      name: 'stale.md',
      type: 'text/markdown',
      size: 32,
      text: vi.fn(() => fileText.promise),
    } as unknown as File
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      urlSignal = init?.signal as AbortSignal
      return urlResponse.promise
    }))

    const fileRequest = input.loadFromFile(file)
    const urlRequest = input.loadFromUrl('https://example.com/latest.md')
    fileText.resolve('# stale file')
    await fileRequest

    expect(urlSignal?.aborted).toBe(false)
    expect(documents).toEqual([])

    urlResponse.resolve(new Response('# latest URL', {
      headers: { 'content-type': 'text/markdown' },
    }))
    await urlRequest

    expect(documents.map(document => document.label)).toEqual(['https://example.com/latest.md'])
  })
})

describe('document input operation ordering', () => {
  it('invalidates a published document operation as soon as a newer input starts', () => {
    const operations: DocumentInputOperation[] = []
    const input = createDocumentInput((_document, operation) => operations.push(operation))

    input.loadFromText('# Earlier')
    expect(operations[0]?.isCurrent()).toBe(true)

    input.loadFromText('# Latest')

    expect(operations[0]?.isCurrent()).toBe(false)
    expect(operations[1]?.isCurrent()).toBe(true)
  })

  it('uses the same operation ordering across PDF and Markdown inputs', async () => {
    const pdfCompletion = createDeferred<void>()
    const documentOperations: DocumentInputOperation[] = []
    let pdfOperation: DocumentInputOperation | undefined
    const input = createDocumentInput(
      (_document, operation) => documentOperations.push(operation),
      (_file, operation) => {
        pdfOperation = operation
        return pdfCompletion.promise
      },
    )
    const pdfLoad = input.loadFromFile({
      name: 'Earlier.pdf',
      size: 1,
      type: 'application/pdf',
    } as File)

    expect(pdfOperation?.isCurrent()).toBe(true)

    input.loadFromText('# Latest')

    expect(pdfOperation?.isCurrent()).toBe(false)
    expect(documentOperations[0]?.isCurrent()).toBe(true)

    pdfCompletion.resolve()
    await pdfLoad
  })
})

function createDocumentInput(
  onDocument: (document: ReaderDocument, operation: DocumentInputOperation) => void,
  onPdf?: (file: File, operation: DocumentInputOperation) => void | Promise<void>,
) {
  const scope = effectScope()
  activeScopes.push(scope)
  const input = scope.run(() => useDocumentInput({ onDocument, onPdf }))

  if (!input) {
    throw new Error('Failed to create document input scope')
  }

  return input
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}
