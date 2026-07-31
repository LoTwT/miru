# miru V0 Scaffold Notes

> Status: initial implementation scaffold for task #2.

## Stack

- Vue 3 + TypeScript + Vite
- pnpm
- `markdown-it@15` with `html: false` and bundled type declarations
- Shiki for code highlighting
- DOMPurify as final sanitization layer
- `@ayingott/theme@0.2.0` + Tailwind CSS v4's Vite plugin for compiled foundation, semantic, reading, and Brutal tokens
- Fontsource Newsreader plus the public `@ayingott/theme` Bricolage Grotesque and Space Mono assets loaded lazily; Newsreader is owned by Miru so theme-package font changes do not alter the locked default typography
- Vitest + Playwright

## Security Baseline

- Raw source HTML is disabled in `markdown-it`.
- Rendered output passes through DOMPurify before Vue receives a `TrustedHtml` value.
- Link schemes are allowlisted: `http:`, `https:`, `mailto:`, relative links, and anchors.
- Image schemes are allowlisted: `http:`, `https:`, `data:`, `blob:`, relative links, and anchors.
- Remote image default is locked to hardened auto:
  - `referrerpolicy="no-referrer"`
  - `loading="lazy"`
  - `decoding="async"`
  - strict scheme allowlist
- Persisted `prompt` / `block` remote-image modes are renderer-real, not UI-only placeholders:
  - apply only to remote `http(s)` image sources
  - keep `data:`, `blob:`, and relative/local image sources renderable
  - covered by unit tests so the V1 privacy toggle has a real architecture exit
- URL fetch is browser CORS-only, credentialless, and no-referrer. There is no server proxy.
- `public/_headers` provides the Cloudflare Workers Static Assets CSP/referrer baseline.

## Customization Architecture Baseline

- `src/lib/theme/tokens.ts` defines Miru's reading override API and the versioned localStorage read path. V2 state uses `:v2` keys and writes a lossless V1-compatible projection first. Both snapshots share a compatibility revision, so a rollback-era V1 edit/reset or an interrupted second write is reconciled instead of being hidden by stale V2 data. If an old writer strips the forward-compatible fields while changing typography or another V1-known field, Miru applies that edit while preserving unchanged V2-only theme axes; an explicit legacy theme change still wins. A semantically damaged V2 snapshot falls back to its healthy V1 projection.
- `src/lib/theme/readingThemeContract.ts` is the single source for theme migration, storage reconciliation, persisted-token validation, palette derivation, root classes, contrast, and browser `theme-color`. Vite/Rolldown bundles `readingThemeBootstrap.ts` as the real first-paint entry, inlines that output, and hashes the exact bytes for CSP; dev and watch mode track both bootstrap sources, rebundle on change, and force a full reload so first paint cannot drift from runtime.
- Theme style and color scheme are independent: Default uses the package's Paper/Ink semantic mappings, Brutal is Miru's initial style, and the separate scheme can follow the OS or pin light/dark for either style.
- Runtime token APIs are override-only in V0; the app reconstructs allowlisted, validated persisted settings on top of CSS defaults rather than replaying arbitrary CSS values.
- `src/lib/theme/fonts.ts` implements lazy loading from Miru's curated font-face entries backed by public `@ayingott/theme/fonts/*` assets.
- `src/styles/main.css` imports the package's default and `brutal.css` entries. App chrome consumes public surface, text, border, accent, status, radius, shadow, spacing, z-index, focus, and motion roles; Miru-specific `--reading-*` values remain override-only.
- `src/App.vue` mounts `ReadingSettingsControl` as the settings command surface.
- The settings UI supports typography, independent theme style and color scheme controls, contrast, custom colors, presets, local fonts, and outline placement.

## Component Map

- `App.vue`: app shell, document state orchestration, global paste/drop events, theme/font bootstrap.
- `FloatingInputMenu.vue`: bottom-right FAB, paste/open-file/URL/clear menu, scroll opacity decay, scroll-to-top brand affordance. Props down, events up.
- `ReaderSurface.vue`: sanitized reading HTML display. Receives `TrustedHtml`; does not render raw markdown.
- `useDocumentInput.ts`: input side effects and error state.
- `useRenderedMarkdown.ts`: async markdown rendering state; lazy-loads the markdown renderer so Shiki is kept out of the initial shell.

## Verification Notes

- Playwright config forces `NO_PROXY` for `127.0.0.1,localhost` so local preview checks do not hit the developer machine proxy.
- Production build currently emits a lazy `renderer` chunk of about 912 kB (186 kB gzip) because Shiki carries the explicit language/theme set. The initial shell stays about 72 kB (29 kB gzip). Monitor this before release if more languages are added.

## Review Notes

- The genesis commit was the only direct-to-main exception. This scaffold should go through a PR.
- UX review needs real screenshots: desktop/mobile × light/dark.
- QA release gate should derive malicious markdown fixtures from `R-SEC-1`.
