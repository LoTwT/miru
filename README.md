# miru

A browser-local, reading-first markdown viewer.

> **North star**: 舒服地阅读 markdown — comfortable markdown reading. miru is a reader, not an editor or a tool.
> **Tagline**: 打开 miru，像翻开一本排版精良的小册子。(Opening miru feels like opening a beautifully typeset booklet.)

## What it is

miru renders markdown into a calm, typeset reading surface. Paste text, drop a `.md` file, open a file, or fetch a URL — and read. No split editor, no tabs, no chrome competing with the words. Everything runs in your browser; nothing is sent to a server.

## Current scope

- **Input** (4 entries): paste text · drag-drop `.md` · open-file picker · URL fetch (browser-local, CORS-only, no proxy)
- **Single rendered view** — reading-first, no split edit/preview
- **First paint** auto-loads a sample doc (self-dogfood: the empty state *is* a live demo)
- **CommonMark + GFM** (tables / task lists / strikethrough / autolink)
- **Code blocks**: Shiki syntax highlighting
- **Typography**: Newsreader by default, adjustable size/measure/rhythm, optional curated or local fonts
- **Themes**: Brutal by default, switchable to the package's Default family; style and light/dark/system scheme are independent, with Sepia and custom reading palettes
- **Reading tools**: local library, outline navigation, progress restore, bookmarks, in-document search, and local PDF viewing
- **Install/offline**: installable PWA shell; user documents remain local and are not added to the shared precache
- **a11y**: keyboard nav · WCAG AA contrast · screen-reader friendly · reduced-motion
- **Privacy**: 100% browser-local — no analytics, telemetry, fingerprinting, proxy, or logging. Remote document images load with the referrer stripped; strict image modes are supported by the renderer and persisted settings.
- **Customization**: in-app typography, theme, contrast, custom colors, named presets, local fonts, and outline placement; preferences/presets use localStorage and uploaded font files stay in local IndexedDB

Still out of scope: edit mode, multi-tab editing, collaboration/cloud sync, KaTeX, and Mermaid. See the specs for the historical scope and later interaction decisions.

## Specs

- Product requirements: [`docs/product/product-spec-v0.3.md`](docs/product/product-spec-v0.3.md)
- UX design: [`docs/ux/design-v0.3.md`](docs/ux/design-v0.3.md)
- Cloudflare deploy runbook: [`docs/ops/cloudflare-pages-deploy.md`](docs/ops/cloudflare-pages-deploy.md)

## Tech

TypeScript · Vue · Vite · markdown-it · Shiki · DOMPurify · `@ayingott/theme@0.2.0` · Fontsource (Newsreader) · Vitest + Playwright · static PWA deploy. App chrome and reading defaults consume the theme package's public semantic tokens, with Miru-specific `--reading-*` values used only for explicit reading overrides.

## Status

The reader, customization UI, local library, PDF path, and PWA shell are implemented. See the deploy runbook for production verification and release evidence.
