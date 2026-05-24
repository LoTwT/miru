# Local document library V1 technical spike

Status: implementation spike for local document library V1.

Related UX spec: `local-doc-library-v1.md` v1.2 from #miru:4039661d.

## Scope

Build a local-only document library that keeps multiple documents on the current device, supports Markdown/text and PDF view-only documents, and preserves miru's reading-first surface.

In scope:

- IndexedDB-backed local library, no cloud sync.
- Unified bookshelf for Markdown/text and PDF entries.
- Markdown/text entries open in the existing `ReaderSurface` pipeline.
- PDF entries open in a lazy-loaded pdf.js view-only viewer.
- Flat organization: rename, pin/unpin, sort, delete one, clear library.
- Reading position metadata: Markdown scroll/heading; PDF page/scale.
- True delete: metadata, content/blob, indexes, positions, and library-only caches removed in the same operation.
- Existing single-document behavior remains usable during rollout.

Out of scope for V1:

- Cloud sync or cross-device library.
- Full-library search.
- Folders/tags.
- PDF annotation/editing.
- PDF text extraction, PDF-to-Markdown conversion, or read-aloud.
- Sharing/export from the library.

## Dependency choices

Use two lazy/contained dependencies:

- `idb` for IndexedDB ergonomics. Verified with `pnpm view` on 2026-05-24: `idb@8.0.3`, ISC, ~83 KB unpacked. It prevents native IndexedDB transaction footguns and keeps schema migrations explicit.
- `pdfjs-dist` for PDF rendering. Verified with `pnpm view` on 2026-05-24: `pdfjs-dist@5.7.284`, Apache-2.0, ~35 MB unpacked. It must be lazy-loaded only when opening a PDF so the normal Markdown reader shell does not pay the PDF cost.

Do not add a server-side PDF proxy. pdf.js worker assets must be bundled and served same-origin by Vite/Workers Static Assets.

## Data model

Use a versioned IndexedDB database:

```ts
const DB_NAME = 'miru:library:v1'
const DB_VERSION = 1

type LibraryDocumentType = 'markdown' | 'pdf'
type LibrarySourceKind = 'paste' | 'url' | 'file'

interface LibraryEntry {
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

type LibrarySource =
  | { kind: 'paste' }
  | { kind: 'url', inputUrl: string, requestUrl: string, domain: string }
  | { kind: 'file', fileName: string, mimeType: string }

interface MarkdownBody {
  documentId: string
  markdown: string
}

interface PdfBody {
  documentId: string
  blob: Blob
  mimeType: 'application/pdf'
  byteSize: number
}

type ReadingPosition =
  | {
      documentId: string
      type: 'markdown'
      scrollY: number
      activeHeadingId: string | null
      updatedAt: string
    }
  | {
      documentId: string
      type: 'pdf'
      pageNumber: number
      scaleMode: 'fit-width' | 'fit-page' | 'custom'
      scale: number | null
      updatedAt: string
    }
```

Object stores:

| Store | Key | Indexes | Notes |
|---|---|---|---|
| `entries` | `id` | `type`, `pinned`, `lastOpenedAt`, `createdAt`, `sortTitle`, `source.domain` | Bookshelf reads only this store so PDF blobs are not loaded for list rendering. |
| `markdownBodies` | `documentId` | none | Markdown content as text. |
| `pdfBodies` | `documentId` | none | PDF `Blob`. Keep separate from entries to avoid accidental list hydration. |
| `positions` | `documentId` | `type`, `updatedAt` | Reading restore metadata. |

Why separate stores: listing must stay fast and memory-light, PDF blobs may be large, and true-delete can be verified store-by-store.

## Runtime document model

Keep `ReaderDocument` Markdown-only and add an app-level active document union instead of forcing PDF through the Markdown renderer.

```ts
type ActiveLibraryDocument = ActiveMarkdownDocument | ActivePdfDocument

interface ActiveMarkdownDocument {
  type: 'markdown'
  entry: LibraryEntry
  readerDocument: ReaderDocument
}

interface ActivePdfDocument {
  type: 'pdf'
  entry: LibraryEntry
  blobUrl: string
  initialPosition: Extract<ReadingPosition, { type: 'pdf' }> | null
}
```

Markdown path:

`LibraryStore.openMarkdown(id)` returns markdown text + metadata, then existing `ReaderSurface` receives `ReaderDocument`. Sanitization/rendering remains unchanged.

PDF path:

`LibraryStore.openPdf(id)` creates a short-lived object URL from the stored blob and renders `PdfViewer`. Revoke the object URL when switching documents or unmounting the viewer.

## Import flows

### Markdown/text

Existing `useDocumentInput` remains the fetch/read orchestrator, but successful loads should call a new library action:

```ts
addMarkdownToLibrary({ markdown, source, label })
```

The action creates `entries` + `markdownBodies` in one transaction, derives title, then opens the new entry. Title derivation order:

1. First Markdown H1.
2. File name or URL label.
3. First non-empty line.
4. `无标题文档`.

URL imports preserve both `inputUrl` and `requestUrl` so smart URL normalization stays transparent and auditable.

### PDF

Update file/drop acceptance:

- `.pdf` or `application/pdf` -> `addPdfToLibrary(file)`.
- Markdown/text rules remain as today.

PDF title derivation order for V1:

1. File name without extension.
2. PDF metadata title if pdf.js can read it cheaply after open.
3. `PDF 文档`.

Do not parse the whole PDF during import. Store the blob first, then lazy-validate/render on open. This keeps drag/drop responsive for large PDFs and routes parse errors to the viewer state.

## Bookshelf and reader composition

Add a top-level app mode:

```ts
type AppMode = 'library' | 'reader'
```

Component map:

- `LibraryShell.vue`: app-mode composition, import menu bridge, active document switching.
- `LibraryView.vue`: list semantics, sorting, pinning, empty/loading/error states.
- `LibraryItem.vue`: one row/card, primary open action, metadata chips, overflow actions.
- `DeleteDocumentDialog.vue`: destructive confirmation with focus trap and focus return.
- `ClearLibraryDialog.vue`: stronger confirmation for true-delete-all.
- `PdfViewer.vue`: lazy pdf.js loader, page/zoom controls, optional PDF outline/bookmarks, states.
- Existing `ReaderSurface.vue`: unchanged Markdown renderer.

Data flow:

```text
Input sources (paste/url/file/drop)
  -> useDocumentInput / file router
  -> useLibraryStore.addMarkdown/addPdf
  -> LibraryView entry list
  -> openEntry(id)
       markdown -> ReaderSurface + outline/settings/FAB
       pdf      -> PdfViewer + PDF controls
```

The existing reading settings and outline belong only to Markdown documents. PDF viewer gets its own small view-only controls and should not expose Markdown-only `aA` controls except shared theme chrome if UX wants it.

## Reading position

Markdown:

- Save on throttled scroll, before switching entries, and before page hide.
- Store `scrollY` and `activeHeadingId` if available.
- Restore after Markdown render completes and runtime heading enhancements finish.
- If the target heading no longer exists, fall back to `scrollY`.

PDF:

- Save `pageNumber`, `scaleMode`, and custom `scale` on page/zoom change.
- Restore after pdf.js document loads.
- Clamp `pageNumber` to `[1, numPages]`.

No visible progress percentage in the bookshelf for V1.

## Deletion and clear-library guarantees

Single delete must run one readwrite transaction over `entries`, body store, and `positions`:

```text
delete entry(id)
delete markdownBodies(id) OR pdfBodies(id)
delete positions(id)
if active document id === id -> switch to library or nearest safe entry
aria-live: 已删除「{title}」
```

Clear library:

- Use a stronger confirmation UI from UX.
- Close active PDF object URLs before clearing.
- Clear all four stores in one logical operation. `indexedDB.deleteDatabase(DB_NAME)` is acceptable only if the app fully closes/reopens the `idb` connection and immediately recreates an empty DB; otherwise clear stores in a version-stable transaction.
- Do not clear unrelated `localStorage` reading settings; document library deletion must not erase user typography/theme preferences.

QA verification should assert all stores are empty and no object URL is retained by the active viewer.

## Quota and large PDF handling

Before storing known-size content, call `navigator.storage.estimate()` when available and compare `usage + file.size` to `quota` with a small safety margin. This is advisory only; still catch write errors.

On quota failure:

- Keep existing library unchanged.
- Show `存储空间不足` with next step: delete documents and retry.
- Do not partially create metadata without content.

For PDF rendering:

- Lazy render current page; optionally keep previous/next page in memory only.
- Do not render all pages at once.
- Cancel pending render tasks when page changes or viewer unmounts.
- Keep the pdf.js worker same-origin; no external CDN.

## Privacy and network boundary

- Library content stays in IndexedDB only.
- No server upload, no telemetry, no analytics, no external PDF service.
- URL import still fetches only the user-provided/normalized URL in the browser with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.
- PDF view-only should never contact third-party hosts for rendering.
- Deleting a document removes local content and metadata. Browser-level storage recovery is outside app control, so UI copy should say “删除后无法在 miru 中恢复”, not make forensic guarantees.

## Existing single-document migration

Current production miru does not persist document content, only reading settings. Therefore there is no durable pre-V1 document body to migrate from `localStorage`.

Rollout still needs a no-loss bridge:

- Keep the sample document as a non-library starter until the user imports something.
- First successful non-sample paste/file/url load after V1 should store the document in the library and open that stored entry.
- If a future/beta build introduces a legacy persisted document key before this V1 lands, provide a one-time migration function that reads that key, inserts a Markdown entry, then removes only that legacy document key after successful transaction commit.

This satisfies the user-visible guarantee: V1 does not drop the document being loaded through the old single-document paths.

## Implementation split

Recommended PR sequence:

1. **Library storage foundation**
   - Add `idb` and `fake-indexeddb` for unit coverage.
   - Implement `src/features/library/libraryStore.ts` with schema, add/open/list/update/delete/clear methods.
   - Add source metadata utilities and title derivation.
   - Unit tests: add Markdown, add PDF blob, list without blob hydration, update title/pin, save/restore positions, delete one, clear all, quota error handling via mocked failed transaction path.

2. **Bookshelf UI + Markdown library path**
   - Add `library`/`reader` app mode and bookshelf components.
   - Wire existing paste/url/file Markdown success into `addMarkdownToLibrary`.
   - Preserve current reader behavior for Markdown entries.
   - E2E: empty shelf, add paste, open, reload persists, rename, pin/sort, delete, clear all, offline open.

3. **PDF view-only support**
   - Add `pdfjs-dist` lazy viewer.
   - Route PDF file/drop to `addPdfToLibrary`.
   - Implement page/zoom controls, restore page, parse/error/quota states.
   - E2E: drag/import small PDF fixture, open viewer, next/previous page, zoom, reload restores page, delete removes blob. Unit-test PDF store separately from pdf.js rendering.

Splitting PDF into PR 3 keeps the Markdown library releasable if pdf.js rendering finds edge cases, while still preserving the Product/UX V1 scope.

## Acceptance criteria for TL/QA

- `entries` list renders without reading Markdown bodies or PDF blobs.
- Markdown documents continue through the existing sanitized renderer; no new `v-html` or sanitizer bypass.
- PDF documents render only through pdf.js, view-only, with same-origin worker assets.
- IndexedDB stores content locally and remains usable offline.
- Delete-one removes entry + body/blob + position; clear-library removes all document stores and leaves reading settings intact.
- Quota failure leaves no partial entry.
- URL imports keep the existing smart URL/CORS/privacy behavior.
- No new fetch/XHR/sendBeacon/analytics/telemetry except user-triggered URL import and same-origin app assets/pdf worker.
- Reduced-motion and focus-visible behavior remain intact for new dialogs and mode switches.

## Risks

- `pdfjs-dist` is large. Mitigation: dynamic import viewer only for PDF route and verify Markdown bundle size does not materially change.
- Browser storage quota is browser/device-dependent. Mitigation: advisory estimate + transactional rollback + clear error path.
- PDF rendering has many edge cases. Mitigation: V1 is view-only, current-page lazy rendering, parse failure state, and no text extraction.
- IndexedDB migrations are hard to undo. Mitigation: keep DB version 1 schema simple, add migration tests before shipping, and avoid storing derived caches that cannot be regenerated.
