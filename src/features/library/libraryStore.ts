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
  PdfReadingLocation,
  PdfReadingPosition,
  ReadingPosition,
  StoredPdfBody,
  UpdateLibraryEntryInput,
  UrlLibrarySource,
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
    value: StoredPdfBody
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

interface OpenLibraryDocumentOptions {
  markOpened?: boolean
}

interface LibraryMutationOptions {
  signal?: AbortSignal
}

interface AddLibraryDocumentOptions extends LibraryMutationOptions {
  markOpened?: boolean
}

interface UrlStorageBudgetSnapshot {
  estimate: StorageEstimate
  canonicalEntryId: string | null
  canonicalByteSize: number
}

type UrlMarkdownUpsertResult =
  | { status: 'committed', entry: LibraryEntry }
  | { status: 'retry-storage', canonicalEntry: LibraryEntry | null }

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

  async function addMarkdownDocument(
    input: AddMarkdownDocumentInput,
    mutation: AddLibraryDocumentOptions = {},
  ): Promise<LibraryEntry> {
    const byteSize = byteSizeOfText(input.markdown)
    const contentHash = hashText(input.markdown)
    if (input.source.kind === 'url') {
      const preflightEntries = await findMarkdownEntriesByUrl(input.source)
      const preflightEntry = selectCanonicalUrlEntry(preflightEntries)
      let storageBudget = preflightEntry === null || byteSize > preflightEntry.byteSize
        ? createUrlStorageBudgetSnapshot(await estimateStorage(), preflightEntry)
        : null

      while (true) {
        const result = await commitUrlMarkdownUpsert(
          input,
          input.source,
          byteSize,
          contentHash,
          preflightEntries.length > 0,
          storageBudget,
          mutation,
        )
        if (result.status === 'committed') {
          return result.entry
        }

        storageBudget = createUrlStorageBudgetSnapshot(
          await estimateStorage(),
          result.canonicalEntry,
        )
      }
    }

    await ensureStorageBudget(byteSize)

    const entry = createMarkdownEntry(input, byteSize, contentHash, mutation)

    const db = await getDb()
    throwIfAborted(mutation.signal)
    const tx = db.transaction(['entries', 'markdownBodies'], 'readwrite')
    const unbindAbort = bindAbortSignal(tx, mutation.signal)
    try {
      await Promise.all([
        tx.objectStore('entries').add(entry),
        tx.objectStore('markdownBodies').add({ documentId: entry.id, markdown: input.markdown }),
        tx.done,
      ])
    }
    finally {
      unbindAbort()
    }

    return entry
  }

  async function findMarkdownEntryByUrl(source: UrlLibrarySource): Promise<LibraryEntry | null> {
    return selectCanonicalUrlEntry(await findMarkdownEntriesByUrl(source))
  }

  async function isMarkdownContentChanged(id: string, markdown: string): Promise<boolean> {
    const db = await getDb()
    const body = await db.get('markdownBodies', id)
    return body?.markdown !== markdown
  }

  function createMarkdownEntry(
    input: AddMarkdownDocumentInput,
    byteSize: number,
    contentHash: string,
    mutation: AddLibraryDocumentOptions,
  ): LibraryEntry {
    const id = createId()
    const timestamp = now()
    const title = normalizeTitle(input.title ?? deriveMarkdownTitle(input.markdown, input.label, input.source))
    return {
      id,
      type: 'markdown',
      title,
      sortTitle: normalizeSortTitle(title),
      source: input.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: mutation.markOpened === false ? null : timestamp,
      pinned: false,
      byteSize,
      contentHash,
      schemaVersion: 1,
    }
  }

  async function commitUrlMarkdownUpsert(
    input: AddMarkdownDocumentInput,
    source: UrlLibrarySource,
    byteSize: number,
    contentHash: string,
    preflightHadMatch: boolean,
    storageBudget: UrlStorageBudgetSnapshot | null,
    mutation: AddLibraryDocumentOptions,
  ): Promise<UrlMarkdownUpsertResult> {
    const db = await getDb()
    throwIfAborted(mutation.signal)
    const tx = db.transaction(['entries', 'markdownBodies', 'positions'], 'readwrite')
    const unbindAbort = bindAbortSignal(tx, mutation.signal)
    const entriesStore = tx.objectStore('entries')
    const markdownBodiesStore = tx.objectStore('markdownBodies')
    const positionsStore = tx.objectStore('positions')

    try {
      const matchingEntries = filterMarkdownEntriesByUrl(await entriesStore.getAll(), source)
      const currentEntry = selectCanonicalUrlEntry(matchingEntries)

      if (!currentEntry) {
        if (preflightHadMatch) {
          throw new LibraryEntryNotFoundError('url-match')
        }
        if (!storageBudget || storageBudget.canonicalEntryId !== null) {
          tx.abort()
          await tx.done.catch(() => undefined)
          return { status: 'retry-storage', canonicalEntry: null }
        }

        assertStorageBudget(storageBudget.estimate, byteSize)
        const entry = createMarkdownEntry(input, byteSize, contentHash, mutation)
        await Promise.all([
          entriesStore.add(entry),
          markdownBodiesStore.add({ documentId: entry.id, markdown: input.markdown }),
          tx.done,
        ])
        return { status: 'committed', entry }
      }

      const currentBody = await markdownBodiesStore.get(currentEntry.id)
      if (!currentBody) {
        throw new LibraryEntryNotFoundError(currentEntry.id)
      }

      const additionalBytes = Math.max(0, byteSize - currentEntry.byteSize)
      if (additionalBytes > 0) {
        if (
          !storageBudget
          || storageBudget.canonicalEntryId !== currentEntry.id
          || storageBudget.canonicalByteSize !== currentEntry.byteSize
        ) {
          tx.abort()
          await tx.done.catch(() => undefined)
          return { status: 'retry-storage', canonicalEntry: currentEntry }
        }
        assertStorageBudget(storageBudget.estimate, additionalBytes)
      }

      const contentChanged = currentBody.markdown !== input.markdown
      const title = resolveUpdatedMarkdownTitle(currentEntry, currentBody.markdown, input)
      const timestamp = now()
      const nextEntry: LibraryEntry = {
        ...currentEntry,
        title,
        sortTitle: normalizeSortTitle(title),
        source: input.source,
        updatedAt: timestamp,
        lastOpenedAt: mutation.markOpened === false ? currentEntry.lastOpenedAt : timestamp,
        byteSize,
        contentHash,
      }
      const duplicateEntries = matchingEntries.filter(entry => entry.id !== currentEntry.id)
      const operations: Promise<unknown>[] = [
        entriesStore.put(nextEntry),
        markdownBodiesStore.put({ documentId: currentEntry.id, markdown: input.markdown }),
        ...duplicateEntries.flatMap(entry => [
          entriesStore.delete(entry.id),
          markdownBodiesStore.delete(entry.id),
          positionsStore.delete(entry.id),
        ]),
      ]

      if (contentChanged) {
        operations.push(positionsStore.delete(currentEntry.id))
      }

      await Promise.all([...operations, tx.done])
      return { status: 'committed', entry: nextEntry }
    }
    catch (reason) {
      await tx.done.catch(() => undefined)
      throw reason
    }
    finally {
      unbindAbort()
    }
  }

  async function addPdfDocument(
    input: AddPdfDocumentInput,
    mutation: AddLibraryDocumentOptions = {},
  ): Promise<LibraryEntry> {
    const byteSize = input.blob.size
    await ensureStorageBudget(byteSize)
    const bytes = await input.blob.arrayBuffer()

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
      lastOpenedAt: mutation.markOpened === false ? null : timestamp,
      pinned: false,
      byteSize,
      schemaVersion: 1,
    }

    const db = await getDb()
    throwIfAborted(mutation.signal)
    const tx = db.transaction(['entries', 'pdfBodies'], 'readwrite')
    const unbindAbort = bindAbortSignal(tx, mutation.signal)
    try {
      await Promise.all([
        tx.objectStore('entries').add(entry),
        tx.objectStore('pdfBodies').add({
          documentId: id,
          bytes,
          mimeType: 'application/pdf',
          byteSize,
          schemaVersion: 2,
        }),
        tx.done,
      ])
    }
    finally {
      unbindAbort()
    }

    return entry
  }

  async function openMarkdownDocument(
    id: string,
    options: OpenLibraryDocumentOptions = {},
  ): Promise<OpenMarkdownDocumentResult | null> {
    const db = await getDb()
    const [entry, body, position] = await Promise.all([
      db.get('entries', id),
      db.get('markdownBodies', id),
      db.get('positions', id),
    ])

    if (!entry || entry.type !== 'markdown' || !body) {
      return null
    }

    const openedEntry = options.markOpened === false ? entry : await markOpened(entry.id)
    if (!openedEntry || openedEntry.type !== 'markdown') {
      return null
    }

    return {
      entry: openedEntry,
      markdown: body.markdown,
      position: position?.type === 'markdown' ? position : null,
    }
  }

  async function openPdfDocument(
    id: string,
    options: OpenLibraryDocumentOptions = {},
  ): Promise<OpenPdfDocumentResult | null> {
    const db = await getDb()
    const [entry, body, position] = await Promise.all([
      db.get('entries', id),
      db.get('pdfBodies', id),
      db.get('positions', id),
    ])

    if (!entry || entry.type !== 'pdf' || !body) {
      return null
    }

    const openedEntry = options.markOpened === false ? entry : await markOpened(entry.id)
    if (!openedEntry || openedEntry.type !== 'pdf') {
      return null
    }

    return {
      entry: openedEntry,
      blob: pdfBodyToBlob(body),
      position: position?.type === 'pdf' ? position : null,
    }
  }

  async function updateEntry(id: string, input: UpdateLibraryEntryInput): Promise<LibraryEntry> {
    const db = await getDb()
    const tx = db.transaction('entries', 'readwrite')
    const entry = await tx.store.get(id)

    if (!entry) {
      await tx.done
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

    await Promise.all([
      tx.store.put(nextEntry),
      tx.done,
    ])
    return nextEntry
  }

  async function saveReadingPosition(
    position: Omit<MarkdownReadingPosition, 'updatedAt'> | PdfReadingLocation,
  ): Promise<ReadingPosition | null> {
    const nextPosition = { ...position, updatedAt: now() } as ReadingPosition
    const db = await getDb()
    const tx = db.transaction(['entries', 'positions'], 'readwrite')
    const entry = await tx.objectStore('entries').get(position.documentId)
    if (!entry) {
      await tx.done
      return null
    }

    await Promise.all([
      tx.objectStore('positions').put(nextPosition),
      tx.done,
    ])
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

  async function markOpened(
    id: string,
    mutation: LibraryMutationOptions = {},
  ): Promise<LibraryEntry | null> {
    const db = await getDb()
    throwIfAborted(mutation.signal)
    const tx = db.transaction('entries', 'readwrite')
    const unbindAbort = bindAbortSignal(tx, mutation.signal)
    try {
      const entry = await tx.store.get(id)
      if (!entry) {
        await tx.done
        return null
      }

      const nextEntry: LibraryEntry = {
        ...entry,
        lastOpenedAt: now(),
        updatedAt: now(),
      }
      await Promise.all([
        tx.store.put(nextEntry),
        tx.done,
      ])
      return nextEntry
    }
    catch (reason) {
      await tx.done.catch(() => undefined)
      throw reason
    }
    finally {
      unbindAbort()
    }
  }

  async function findMarkdownEntriesByUrl(source: UrlLibrarySource): Promise<LibraryEntry[]> {
    const db = await getDb()
    return filterMarkdownEntriesByUrl(await db.getAll('entries'), source)
  }

  async function ensureStorageBudget(incomingBytes: number): Promise<void> {
    assertStorageBudget(await estimateStorage(), incomingBytes)
  }

  function assertStorageBudget(estimate: StorageEstimate, incomingBytes: number): void {
    if (estimate.quota !== undefined && estimate.usage !== undefined) {
      const remaining = estimate.quota - estimate.usage
      if (remaining - incomingBytes < storageSafetyMarginBytes) {
        throw new LibraryQuotaExceededError()
      }
    }
  }

  return {
    addMarkdownDocument,
    addPdfDocument,
    clearLibrary,
    close,
    countStoreEntries,
    deleteEntry,
    findMarkdownEntryByUrl,
    getReadingPosition,
    isMarkdownContentChanged,
    listEntries,
    markOpened,
    openMarkdownDocument,
    openPdfDocument,
    saveReadingPosition,
    updateEntry,
  }
}

function pdfBodyToBlob(body: StoredPdfBody): Blob {
  if ('bytes' in body) {
    return new Blob([body.bytes], { type: body.mimeType })
  }

  return body.blob
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

    return compareLastOpenedDesc(left, right)
  })
}

function filterMarkdownEntriesByUrl(entries: LibraryEntry[], source: UrlLibrarySource): LibraryEntry[] {
  return entries.filter(entry =>
    entry.type === 'markdown'
    && entry.source.kind === 'url'
    && (
      entry.source.inputUrl === source.inputUrl
      || entry.source.requestUrl === source.requestUrl
    ),
  )
}

function createUrlStorageBudgetSnapshot(
  estimate: StorageEstimate,
  canonicalEntry: LibraryEntry | null,
): UrlStorageBudgetSnapshot {
  return {
    estimate,
    canonicalEntryId: canonicalEntry?.id ?? null,
    canonicalByteSize: canonicalEntry?.byteSize ?? 0,
  }
}

function compareDateDesc(left: string, right: string): number {
  return right.localeCompare(left)
}

function selectCanonicalUrlEntry(entries: LibraryEntry[]): LibraryEntry | null {
  if (entries.length === 0) {
    return null
  }

  return [...entries].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1
    }

    return compareLastOpenedDesc(left, right)
  })[0] ?? null
}

function compareLastOpenedDesc(left: LibraryEntry, right: LibraryEntry): number {
  if (left.lastOpenedAt === null && right.lastOpenedAt !== null) {
    return 1
  }

  if (left.lastOpenedAt !== null && right.lastOpenedAt === null) {
    return -1
  }

  return compareDateDesc(left.lastOpenedAt ?? left.updatedAt, right.lastOpenedAt ?? right.updatedAt)
}

function resolveUpdatedMarkdownTitle(existingEntry: LibraryEntry, previousMarkdown: string, input: AddMarkdownDocumentInput): string {
  if (input.title !== undefined) {
    return normalizeTitle(input.title)
  }

  const nextTitle = normalizeTitle(deriveMarkdownTitle(input.markdown, input.label, input.source))
  const previousTitle = normalizeTitle(deriveMarkdownTitle(
    previousMarkdown,
    existingEntry.source.kind === 'url' ? existingEntry.source.inputUrl : undefined,
    existingEntry.source,
  ))

  return existingEntry.title === previousTitle ? nextTitle : existingEntry.title
}

function deriveMarkdownTitle(markdown: string, label?: string, source?: AddMarkdownDocumentInput['source']): string {
  if (source?.kind === 'url') {
    return deriveUrlMarkdownTitle(markdown, source)
  }

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

function deriveUrlMarkdownTitle(markdown: string, source: Extract<AddMarkdownDocumentInput['source'], { kind: 'url' }>): string {
  return getFrontmatterTitle(markdown)
    ?? getFirstMarkdownH1(markdown)
    ?? getHtmlTitle(markdown)
    ?? getUrlBasenameTitle(source.inputUrl)
    ?? getUrlBasenameTitle(source.requestUrl)
    ?? source.domain
}

function getFrontmatterTitle(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const title = frontmatter?.[1]?.match(/^title:\s*(.+?)\s*$/m)?.[1]
  return title ? normalizeExtractedTitle(title) : null
}

function getFirstMarkdownH1(markdown: string): string | null {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]
  return heading ? normalizeExtractedTitle(heading) : null
}

function getHtmlTitle(markdown: string): string | null {
  const title = markdown.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
  return title ? normalizeExtractedTitle(title) : null
}

function getUrlBasenameTitle(url: string): string | null {
  try {
    const parsed = new URL(url)
    const basename = parsed.pathname.split('/').filter(Boolean).at(-1)
    if (!basename) {
      return parsed.hostname || null
    }

    return stripFileExtension(decodeUrlSegment(basename)) ?? parsed.hostname
  }
  catch {
    return null
  }
}

function normalizeExtractedTitle(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()

  return normalized || null
}

function decodeUrlSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  }
  catch {
    return segment
  }
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

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

function bindAbortSignal(
  transaction: { abort: () => void },
  signal?: AbortSignal,
): () => void {
  if (!signal) {
    return () => undefined
  }

  const abortTransaction = () => {
    try {
      transaction.abort()
    }
    catch {
      // The transaction already completed before cancellation reached it.
    }
  }

  signal.addEventListener('abort', abortTransaction, { once: true })
  if (signal.aborted) {
    abortTransaction()
  }

  return () => signal.removeEventListener('abort', abortTransaction)
}

function byteSizeOfText(text: string): number {
  return new Blob([text]).size
}

function hashText(value: string): string {
  let hash = 0x811C9DC5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
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
