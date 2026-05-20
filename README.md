# miru

A browser-local, reading-first markdown viewer.

> **North star**: 舒服地阅读 markdown — comfortable markdown reading. miru is a reader, not an editor or a tool.
> **Tagline**: 打开 miru，像翻开一本排版精良的小册子。(Opening miru feels like opening a beautifully typeset booklet.)

## What it is

miru renders markdown into a calm, typeset reading surface. Paste text, drop a `.md` file, open a file, or fetch a URL — and read. No split editor, no tabs, no chrome competing with the words. Everything runs in your browser; nothing is sent to a server.

## V0 scope (summary)

- **Input** (4 entries): paste text · drag-drop `.md` · open-file picker · URL fetch (browser-local, CORS-only, no proxy)
- **Single rendered view** — reading-first, no split edit/preview
- **First paint** auto-loads a sample doc (self-dogfood: the empty state *is* a live demo)
- **CommonMark + GFM** (tables / task lists / strikethrough / autolink)
- **Code blocks**: Shiki syntax highlighting
- **Typography**: serif body (Newsreader), ~65ch measure, 1.7 line-height, auto dark/light
- **a11y**: keyboard nav · WCAG AA contrast · screen-reader friendly · reduced-motion
- **Privacy**: 100% browser-local — no analytics, telemetry, fingerprinting, proxy, or logging. Remote images in your documents auto-load with `referrer` stripped (content, not tracking); a "block remote images" toggle is reserved for V1.
- **Customization**: V0 ships one tuned theme + the full token/runtime/persistence architecture so V1 adds in-app customization UI without re-architecting. V0 power-user path = CSS override / config / URL params.

Deferred to V1+: in-app customization UI, presets, edit mode, multi-tab, collaboration, PWA/offline, KaTeX/mermaid. See specs for the full list.

## Specs

- Product requirements: [`docs/product/product-spec-v0.3.md`](docs/product/product-spec-v0.3.md)
- UX design: [`docs/ux/design-v0.3.md`](docs/ux/design-v0.3.md)
- Cloudflare Pages deploy runbook: [`docs/ops/cloudflare-pages-deploy.md`](docs/ops/cloudflare-pages-deploy.md)

## Tech (V0)

TypeScript · Vite · markdown-it · Shiki · DOMPurify · Fontsource (Newsreader) · Vitest + Playwright · static SPA deploy. Reading tokens (`--reading-*`) are sourced from LoTwT/design-system (V0.1).

## Status

V0 scaffold and typography pass are on `main`. Remaining V0 work: reading-state affordance decision, release-readiness evidence, R-PERF-1 mobile reading validation, and Cloudflare Pages deployment wiring.
