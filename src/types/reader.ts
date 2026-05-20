export type DocumentSourceKind = 'sample' | 'paste' | 'file' | 'url'

export interface ReaderDocument {
  source: DocumentSourceKind
  label: string
  markdown: string
}

export interface ReaderError {
  title: string
  detail: string
}

export interface TrustedHtml {
  readonly __trustedHtml: unique symbol
  readonly value: string
}

export type RemoteImageMode = 'auto' | 'prompt' | 'block'
