import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'

import type {
  AddMarkdownDocumentInput,
  AddPdfDocumentInput,
  LibraryEntry,
  LibrarySortMode,
  MarkdownBody,
  MarkdownReadingPosition,
  OpenMarkdownDocumentResult,
  OpenPdfDocumentResult,
  PdfBody,
  PdfReadingPosition,
  ReadingPosition,
  UpdateLibraryEntryInput,
} from './types'

export const libraryDatabaseName = 'miru:library:v1'
export const libraryDatabaseVersion = 1

const defaultStorageSafetyMarginBytes = 512 * 1024

interface LibraryDatabase extends DBSchema {
  entries: {
    key: string
    value: LibraryEntry
    indexes: {
      type: string
      lastOpenedAt: string
      createdAt: string
      sortTitle: string
      sourceDomain: string
    }
  }
  markdownBodies: {
    key: string
    value: MarkdownBody
  }
  pdfBodies: {
    key: string
    value: PdfBody
  }
  positions: {
    key: string
    value: ReadingPosition
    indexes: {
      type: string
      updatedAt: string
    }
  }
}

interface LibraryStoreOptions {
  dbName?: string
  now?: () => string
  createId?: () => string
  estimateStorage?: () => Promise<StorageEstimate>
  storageSafetyMarginBytes?: number
}

export class LibraryQuotaExceededError extends Error {
  constructor(message = 'Library storage quota exceeded') {
    super(message)
    this.name = 'LibraryQuotaExceededError'
  }
}

export class LibraryEntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Library entry not found: ${id}`)
    this.name = 'LibraryEntryNotFoundError'
  }
}

export function createLibraryStore(options: LibraryStoreOptions = {}) {
  const dbName = options.dbName ?? libraryDatabaseName
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? createDocumentId
  const estimateStorage = options.estimateStorage ?? estimateBrowserStorage
  const storageSafetyMarginBytes = options.storageSafetyMarginBytes ?? defaultStorageSafetyMarginBytes
  let dbPromise: Promise<IDBPDatabase<LibraryDatabase>> | null = null

  function getDb(): Promise<IDBPDatabase<LibraryDatabase>> {
    dbPromise ??= openDB<LibraryDatabase>(dbName, libraryDatabaseVersion, {
      upgrade(db) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' })
        entries.createIndex('type', 'type')
        entries.createIndex('lastOpenedAt', 'lastOpenedAt')
        entries.createIndex('createdAt', 'createdAt')
        entries.createIndex('sortTitle', 'sortTitle')
        entries.createIndex('sourceDomain', 'source.domain')

        db.createObjectStore('markdownBodies', { keyPath: 'documentId' })
        db.createObjectStore('pdfBodies', { keyPath: 'documentId' })

        const positions = db.createObjectStore('positions', { keyPath: 'documentId' })
        positions.createIndex('type', 'type')
        positions.createIndex('updatedAt', 'updatedAt')
      },
    })

    return dbPromise
  }

  async function listEntries(sortMode: LibrarySortMode = 'last-opened'): Promise<LibraryEntry[]> {
    const db = await getDb()
    const entries = await db.getAll('entries')
    return sortLibraryEntries(entries, sortMode)
  }

  async function addMarkdownDocument(input: AddMarkdownDocumentInput): Promise<LibraryEntry> {
    const byteSize = byteSizeOfText(input.markdown)
    await ensureStorageBudget(byteSize)

    const id = createId()
    const timestamp = now()
    const title = normalizeTitle(input.title ?? deriveMarkdownTitle(input.markdown, input.label))
    const entry: LibraryEntry = {
      id,
      type: 'markdown',
      title,
      sortTitle: normalizeSortTitle(title),
      source: input.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
      pinned: false,
      byteSize,
      schemaVersion: 1,
    }

    const db = await getDb()
    const tx = db.transaction(['entries', 'markdownBodies'], 'readwrite')
    await Promise.all([
      tx.objectStore('entries').add(entry),
      tx.objectStore('markdownBodies').add({ documentId: id, markdown: input.markdown }),
      tx.done,
    ])

    return entry
  }

  async function addPdfDocument(input: AddPdfDocumentInput): Promise<LibraryEntry> {
    const byteSize = input.blob.size
    await ensureStorageBudget(byteSize)

    const id = createId()
    const timestamp = now()
    const title = normalizeTitle(input.title ?? stripFileExtension(input.source.fileName) ?? 'PDF 文档')
    const entry: LibraryEntry = {
      id,
      type: 'pdf',
      title,
      sortTitle: normalizeSortTitle(title),
      source: input.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
      pinned: false,
      byteSize,
      schemaVersion: 1,
    }

    const db = await getDb()
    const tx = db.transaction(['entries', 'pdfBodies'], 'readwrite')
    await Promise.all([
      tx.objectStore('entries').add(entry),
      tx.objectStore('pdfBodies').add({
        documentId: id,
        blob: input.blob,
        mimeType: 'application/pdf',
        byteSize,
      }),
      tx.done,
    ])

    return entry
  }

  async function openMarkdownDocument(id: string): Promise<OpenMarkdownDocumentResult | null> {
    const db = await getDb()
    const [entry, body, position] = await Promise.all([
      db.get('entries', id),
      db.get('markdownBodies', id),
      db.get('positions', id),
    ])

    if (!entry || entry.type !== 'markdown' || !body) {
      return null
    }

    const nextEntry = await markOpened(entry)
    return {
      entry: nextEntry,
      markdown: body.markdown,
      position: position?.type === 'markdown' ? position : null,
    }
  }

  async function openPdfDocument(id: string): Promise<OpenPdfDocumentResult | null> {
    const db = await getDb()
    const [entry, body, position] = await Promise.all([
      db.get('entries', id),
      db.get('pdfBodies', id),
      db.get('positions', id),
    ])

    if (!entry || entry.type !== 'pdf' || !body) {
      return null
    }

    const nextEntry = await markOpened(entry)
    return {
      entry: nextEntry,
      blob: body.blob,
      position: position?.type === 'pdf' ? position : null,
    }
  }

  async function updateEntry(id: string, input: UpdateLibraryEntryInput): Promise<LibraryEntry> {
    const db = await getDb()
    const entry = await db.get('entries', id)

    if (!entry) {
      throw new LibraryEntryNotFoundError(id)
    }

    const title = input.title === undefined ? entry.title : normalizeTitle(input.title)
    const nextEntry: LibraryEntry = {
      ...entry,
      title,
      sortTitle: normalizeSortTitle(title),
      pinned: input.pinned ?? entry.pinned,
      updatedAt: now(),
    }

    await db.put('entries', nextEntry)
    return nextEntry
  }

  async function saveReadingPosition(position: Omit<MarkdownReadingPosition, 'updatedAt'> | Omit<PdfReadingPosition, 'updatedAt'>): Promise<ReadingPosition> {
    const nextPosition = { ...position, updatedAt: now() } as ReadingPosition
    const db = await getDb()
    await db.put('positions', nextPosition)
    return nextPosition
  }

  async function getReadingPosition(id: string): Promise<ReadingPosition | null> {
    const db = await getDb()
    return await db.get('positions', id) ?? null
  }

  async function deleteEntry(id: string): Promise<void> {
    const db = await getDb()
    const entry = await db.get('entries', id)

    if (!entry) {
      return
    }

    const bodyStoreName = entry.type === 'markdown' ? 'markdownBodies' : 'pdfBodies'
    const tx = db.transaction(['entries', bodyStoreName, 'positions'], 'readwrite')

    await Promise.all([
      tx.objectStore('entries').delete(id),
      tx.objectStore(bodyStoreName).delete(id),
      tx.objectStore('positions').delete(id),
      tx.done,
    ])
  }

  async function clearLibrary(): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(['entries', 'markdownBodies', 'pdfBodies', 'positions'], 'readwrite')

    await Promise.all([
      tx.objectStore('entries').clear(),
      tx.objectStore('markdownBodies').clear(),
      tx.objectStore('pdfBodies').clear(),
      tx.objectStore('positions').clear(),
      tx.done,
    ])
  }

  async function countStoreEntries(): Promise<Record<'entries' | 'markdownBodies' | 'pdfBodies' | 'positions', number>> {
    const db = await getDb()
    const [entries, markdownBodies, pdfBodies, positions] = await Promise.all([
      db.count('entries'),
      db.count('markdownBodies'),
      db.count('pdfBodies'),
      db.count('positions'),
    ])

    return { entries, markdownBodies, pdfBodies, positions }
  }

  async function close(): Promise<void> {
    const db = await dbPromise
    db?.close()
    dbPromise = null
  }

  async function markOpened(entry: LibraryEntry): Promise<LibraryEntry> {
    const nextEntry: LibraryEntry = {
      ...entry,
      lastOpenedAt: now(),
      updatedAt: now(),
    }
    const db = await getDb()
    await db.put('entries', nextEntry)
    return nextEntry
  }

  async function ensureStorageBudget(incomingBytes: number): Promise<void> {
    const estimate = await estimateStorage()

    if (estimate.quota === undefined || estimate.usage === undefined) {
      return
    }

    const remaining = estimate.quota - estimate.usage
    if (remaining - incomingBytes < storageSafetyMarginBytes) {
      throw new LibraryQuotaExceededError()
    }
  }

  return {
    addMarkdownDocument,
    addPdfDocument,
    clearLibrary,
    close,
    countStoreEntries,
    deleteEntry,
    getReadingPosition,
    listEntries,
    openMarkdownDocument,
    openPdfDocument,
    saveReadingPosition,
    updateEntry,
  }
}

export async function deleteLibraryDatabase(dbName = libraryDatabaseName): Promise<void> {
  await deleteDB(dbName)
}

export function sortLibraryEntries(entries: LibraryEntry[], sortMode: LibrarySortMode): LibraryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1
    }

    if (sortMode === 'title') {
      return left.sortTitle.localeCompare(right.sortTitle, 'zh-Hans-CN')
    }

    if (sortMode === 'created') {
      return compareDateDesc(left.createdAt, right.createdAt)
    }

    return compareDateDesc(left.lastOpenedAt ?? left.updatedAt, right.lastOpenedAt ?? right.updatedAt)
  })
}

function compareDateDesc(left: string, right: string): number {
  return right.localeCompare(left)
}

function deriveMarkdownTitle(markdown: string, label?: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]
  if (heading?.trim()) {
    return heading.trim()
  }

  if (label?.trim()) {
    return stripFileExtension(label.trim()) ?? label.trim()
  }

  const firstLine = markdown.split(/\r?\n/).find(line => line.trim())
  return firstLine?.trim() ?? '无标题文档'
}

function normalizeTitle(title: string): string {
  return title.trim() || '无标题文档'
}

function normalizeSortTitle(title: string): string {
  return title.trim().toLocaleLowerCase('zh-Hans-CN')
}

function stripFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.replace(/\.[^.]+$/, '')
}

function byteSizeOfText(text: string): number {
  return new Blob([text]).size
}

function createDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function estimateBrowserStorage(): Promise<StorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {}
  }

  return await navigator.storage.estimate()
}
