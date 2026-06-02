# Optional Reading Fonts v1

miru remains local-first: optional built-in fonts are self-hosted, loaded only after the reader chooses them, and excluded from the service-worker precache. No Google Fonts or third-party font CDN is used at runtime.

## Included Fonts

| Font | Purpose | Source | License | Shipped files |
| --- | --- | --- | --- | --- |
| Literata | Alternate long-reading serif with a bookish editorial voice | Fontsource package `@fontsource-variable/literata@5.2.8` | SIL Open Font License 1.1 | Latin variable normal WOFF2 (52,496 bytes) and italic WOFF2 (53,728 bytes) |
| Atkinson Hyperlegible | Accessibility-oriented reading option | Fontsource package `@fontsource/atkinson-hyperlegible@5.2.8` | SIL Open Font License 1.1 | Latin 400 WOFF2 (17,208 bytes) and 700 WOFF2 (17,524 bytes) |
| LXGW WenKai | Optional Chinese reading face with a warm WenKai voice | Fontsource package `@fontsource/lxgw-wenkai@5.2.5` | SIL Open Font License 1.1 | 300 normal WOFF2 (8,811,960 bytes) |

Tiny preview subsets are also shipped for selector fidelity:

- `literata-preview-normal.woff2` - 2,680 bytes
- `atkinson-hyperlegible-preview-normal.woff2` - 3,092 bytes
- `lxgw-wenkai-preview-normal.woff2` - 2,544 bytes

The redistributed font assets carry their copyright notices and the full
SIL Open Font License text in `public/fonts/optional/LICENSES.txt`.

## Loading Contract

- Default Newsreader / Space Mono loading remains unchanged.
- Optional fonts live under `public/fonts/optional/`.
- Selecting an optional font calls the local font registry and loads only that font's files with the `FontFace` API.
- Optional font files are intentionally excluded from Workbox precache, so they are not downloaded on first visit or offline install unless selected.
- Latin-only optional fonts keep the existing CJK fallback chain (`Songti SC`, `PingFang SC`, `Noto * CJK SC`) so Chinese documents remain readable.
- The selector may eagerly load same-origin tiny preview subsets so labels show the real face before selection. This is intentional and is separate from the full optional font files.
- LXGW WenKai has no upstream unicode-range split in the selected Fontsource package, so it uses the explicit large-font fallback: a size badge plus first-use confirmation. The full 8.8 MB WOFF2 is requested only after confirmation.

## Deferred / Follow-up

True unicode-range CJK splitting remains deferred until a trustworthy source package exposes stable subsets. The current LXGW WenKai path keeps the large file opt-in, self-hosted, and outside PWA precache.
