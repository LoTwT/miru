import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'

import {
  buildUploadedFontStack,
  createLocalFontFamilyId,
} from './readingSettingsOptions'
import type { ReadingLocalFontFamilyId } from './readingSettingsOptions'

export const localFontsDatabaseName = 'miru:local-fonts:v1'
export const localFontsDatabaseVersion = 1
export const localFontSoftWarningBytes = 8 * 1024 * 1024
export const localFontHardLimitBytes = 25 * 1024 * 1024

const supportedFontExtensions = ['.woff2', '.ttf', '.otf'] as const
const supportedFontMimeTypes = new Set([
  '',
  'application/font-sfnt',
  'application/font-woff2',
  'application/octet-stream',
  'application/vnd.ms-opentype',
  'application/x-font-opentype',
  'application/x-font-otf',
  'application/x-font-ttf',
  'application/x-font-woff2',
  'font/otf',
  'font/sfnt',
  'font/ttf',
  'font/woff2',
])
const maxLocalFontNameLength = 32

export interface LocalFontRecord {
  id: string
  name: string
  fileName: string
  mimeType: string
  byteSize: number
  createdAt: string
  updatedAt: string
  blob: Blob
  schemaVersion: 1
}

export interface LocalFontOption {
  id: string
  familyId: ReadingLocalFontFamilyId
  name: string
  fileName: string
  mimeType: string
  byteSize: number
  createdAt: string
  updatedAt: string
  fontFaceFamily: string
  fontStack: string
}

interface LocalFontsDatabase extends DBSchema {
  fonts: {
    key: string
    value: LocalFontRecord
    indexes: {
      name: string
      createdAt: string
    }
  }
}

interface LocalFontStoreOptions {
  dbName?: string
  createId?: () => string
  now?: () => string
}

export type LocalFontValidationResult =
  | { ok: true, warning?: string }
  | { ok: false, error: string }

export class LocalFontValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalFontValidationError'
  }
}

export function createLocalFontStore(options: LocalFontStoreOptions = {}) {
  const dbName = options.dbName ?? localFontsDatabaseName
  const createId = options.createId ?? createLocalFontId
  const now = options.now ?? (() => new Date().toISOString())
  let dbPromise: Promise<IDBPDatabase<LocalFontsDatabase>> | null = null

  function getDb(): Promise<IDBPDatabase<LocalFontsDatabase>> {
    dbPromise ??= openDB<LocalFontsDatabase>(dbName, localFontsDatabaseVersion, {
      upgrade(db) {
        const fonts = db.createObjectStore('fonts', { keyPath: 'id' })
        fonts.createIndex('name', 'name')
        fonts.createIndex('createdAt', 'createdAt')
      },
    })

    return dbPromise
  }

  async function listFonts(): Promise<LocalFontRecord[]> {
    const db = await getDb()
    const fonts = await db.getAll('fonts')
    return fonts.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async function addFont(input: {
    file: Blob
    fileName: string
    mimeType: string
    name: string
  }): Promise<LocalFontRecord> {
    const timestamp = now()
    const record: LocalFontRecord = {
      id: createId(),
      name: normalizeLocalFontName(input.name),
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.file.size,
      createdAt: timestamp,
      updatedAt: timestamp,
      blob: input.file,
      schemaVersion: 1,
    }
    const db = await getDb()
    await db.add('fonts', record)
    return record
  }

  async function renameFont(id: string, name: string): Promise<LocalFontRecord | null> {
    const db = await getDb()
    const record = await db.get('fonts', id)

    if (!record) {
      return null
    }

    const nextRecord: LocalFontRecord = {
      ...record,
      name: normalizeLocalFontName(name),
      updatedAt: now(),
    }
    await db.put('fonts', nextRecord)
    return nextRecord
  }

  async function deleteFont(id: string): Promise<void> {
    const db = await getDb()
    await db.delete('fonts', id)
  }

  async function countFonts(): Promise<number> {
    const db = await getDb()
    return await db.count('fonts')
  }

  async function close(): Promise<void> {
    const db = await dbPromise
    db?.close()
    dbPromise = null
  }

  return {
    addFont,
    close,
    countFonts,
    deleteFont,
    listFonts,
    renameFont,
  }
}

export async function deleteLocalFontsDatabase(dbName = localFontsDatabaseName): Promise<void> {
  await deleteDB(dbName)
}

export function validateLocalFontFile(file: File): LocalFontValidationResult {
  const extension = getFileExtension(file.name)

  if (!supportedFontExtensions.includes(extension as (typeof supportedFontExtensions)[number])) {
    return { ok: false, error: '只支持 .woff2 / .ttf / .otf 字体文件。' }
  }

  if (!supportedFontMimeTypes.has(file.type)) {
    return { ok: false, error: '这个文件看起来不像字体文件。' }
  }

  if (file.size > localFontHardLimitBytes) {
    return { ok: false, error: '字体超过 25MB,请换一个更小的文件。' }
  }

  if (file.size > localFontSoftWarningBytes) {
    return { ok: true, warning: '字体较大,加载和本地存储可能变慢。' }
  }

  return { ok: true }
}

export function createLocalFontOption(record: LocalFontRecord): LocalFontOption {
  const fontFaceFamily = createLocalFontFaceFamily(record.id)

  return {
    id: record.id,
    familyId: createLocalFontFamilyId(record.id),
    name: record.name,
    fileName: record.fileName,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    fontFaceFamily,
    fontStack: buildUploadedFontStack(fontFaceFamily),
  }
}

export async function createLocalFontFace(record: LocalFontRecord): Promise<FontFace> {
  const option = createLocalFontOption(record)
  const fontFace = new FontFace(option.fontFaceFamily, await record.blob.arrayBuffer())
  await fontFace.load()
  return fontFace
}

export function normalizeLocalFontName(name: string): string {
  return stripFontExtension(name)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLocalFontNameLength)
}

export function createLocalFontId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `font-${crypto.randomUUID()}`
  }

  return `font-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createLocalFontFaceFamily(id: string): string {
  return `MiruLocalFont-${id.replace(/[^\da-z-]/gi, '-')}`
}

function stripFontExtension(name: string): string {
  const extension = getFileExtension(name)
  return extension ? name.slice(0, -extension.length) : name
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase()
}
