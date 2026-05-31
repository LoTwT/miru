export type LibraryDocumentType = 'markdown' | 'pdf'
export type LibrarySourceKind = 'paste' | 'url' | 'file'

export interface PasteLibrarySource {
  kind: 'paste'
}

export interface UrlLibrarySource {
  kind: 'url'
  inputUrl: string
  requestUrl: string
  domain: string
}

export interface FileLibrarySource {
  kind: 'file'
  fileName: string
  mimeType: string
}

export type LibrarySource = PasteLibrarySource | UrlLibrarySource | FileLibrarySource

export interface LibraryEntry {
  id: string
  type: LibraryDocumentType
  title: string
  sortTitle: string
  source: LibrarySource
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  pinned: boolean
  byteSize: number
  contentHash?: string
  schemaVersion: 1
}

export interface MarkdownBody {
  documentId: string
  markdown: string
}

export interface PdfBody {
  documentId: string
  blob: Blob
  mimeType: 'application/pdf'
  byteSize: number
}

export interface MarkdownReadingPosition {
  documentId: string
  type: 'markdown'
  scrollY: number
  activeHeadingId: string | null
  updatedAt: string
}

export interface PdfReadingPosition {
  documentId: string
  type: 'pdf'
  pageNumber: number
  viewMode: 'paged' | 'scroll'
  scaleMode: 'fit-width' | 'fit-page' | 'custom'
  scale: number | null
  updatedAt: string
}

export type ReadingPosition = MarkdownReadingPosition | PdfReadingPosition

export type LibrarySortMode = 'last-opened' | 'created' | 'title'

export interface AddMarkdownDocumentInput {
  markdown: string
  source: LibrarySource
  label?: string
  title?: string
}

export interface AddPdfDocumentInput {
  blob: Blob
  source: FileLibrarySource
  title?: string
}

export interface OpenMarkdownDocumentResult {
  entry: LibraryEntry
  markdown: string
  position: MarkdownReadingPosition | null
}

export interface OpenPdfDocumentResult {
  entry: LibraryEntry
  blob: Blob
  position: PdfReadingPosition | null
}

export interface UpdateLibraryEntryInput {
  title?: string
  pinned?: boolean
}
