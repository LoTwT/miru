# miru V0 Scaffold Notes

> Status: initial implementation scaffold for task #2.

## Stack

- Vue 3 + TypeScript + Vite
- pnpm
- `markdown-it` with `html: false`
- Shiki for code highlighting
- DOMPurify as final sanitization layer
- `@ayingott/theme@0.1.0` for design-system reading tokens/theme package
- `@ayingott/theme@0.1.0` font assets (Newsreader + Space Mono) loaded lazily
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
- Future `prompt` / `block` remote-image modes are renderer-real, not UI-only placeholders:
  - apply only to remote `http(s)` image sources
  - keep `data:`, `blob:`, and relative/local image sources renderable
  - covered by unit tests so the V1 privacy toggle has a real architecture exit
- URL fetch is browser CORS-only, credentialless, and no-referrer. There is no server proxy.
- `public/_headers` provides the Cloudflare Pages CSP/referrer baseline.

## Customization Architecture Baseline

- `src/lib/theme/tokens.ts` defines the V0 theme registry, runtime CSS variable mutation API, and localStorage read-path schema.
- Default light/dark reading tokens live in CSS media queries to keep OS switching native and flash-free.
- Runtime token APIs are override-only in V0; persisted overrides replay on top of CSS defaults rather than rewriting the base theme.
- `src/lib/theme/fonts.ts` implements lazy font loading from `@ayingott/theme/fonts.css`.
- `src/App.vue` includes the V1 settings drawer mount comment.
- V0 has no settings UI; the API surface is present for V1.

## Component Map

- `App.vue`: app shell, document state orchestration, global paste/drop events, theme/font bootstrap.
- `InputToolbar.vue`: paste/open-file/URL/sample input affordances. Props down, events up.
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
