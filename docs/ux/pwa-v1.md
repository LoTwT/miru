# PWA install/offline interaction v1

Status: implemented in the PWA install/offline PR.

## Goals

- Let miru be installable through the browser's native install flow.
- Keep the reading surface quiet: no in-app install banner, no persistent offline badge, and no forced reload prompt.
- Make the app shell and sample document available offline.
- Preserve the privacy promise: user documents and remote URL contents are never cached by the service worker.

## Manifest

- `name`: `miru — 安静地阅读 Markdown`
- `short_name`: `miru`
- `display`: `standalone`
- `start_url`: `/`
- `scope`: `/`
- Static light `theme_color` / `background_color`: `#fbf8f1`
- Icons:
  - `/icons/icon-192.png`, `purpose: any`
  - `/icons/icon-512.png`, `purpose: any`
  - `/icons/icon-maskable-512.png`, `purpose: maskable`

The current icons are placeholder `m.` assets aligned with the wordmark. They can be replaced when the final favicon/icon system is decided.

## Install UX

Use the browser's native install entry point only. Do not add a custom "install miru" banner or toast in the reading surface.

## Offline UX

- Offline root navigation should load the app shell and sample document.
- Local paste, drag/drop, and file picker input continue to work offline.
- URL fetch remains a network action. Offline URL fetch should show the existing inline URL error, keep the current document, and mention offline as a possible cause.
- No persistent offline badge is shown.

## Service worker boundaries

The service worker precaches only same-origin application assets:

- app shell HTML
- JS/CSS chunks
- fonts
- Shiki renderer chunk
- manifest and icons
- first-party OG image/static assets

It must not runtime-cache:

- pasted markdown
- opened local files
- dropped files
- remote URL fetch responses
- third-party requests

Updates are silent and take effect on a later page load. The app must not force reload while a user is reading.

## Acceptance checks

- Manifest fields and icon assets are reachable.
- Installed/standalone metadata uses the expected names, scope, and icon purposes.
- App shell loads offline after first online visit.
- Local paste and file input still render offline.
- Offline URL fetch shows inline failure and preserves the current document.
- CacheStorage contains only same-origin app assets and no user/remote content.
- No analytics, beacon, telemetry, or third-party runtime caching is introduced.
