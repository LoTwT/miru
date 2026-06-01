# Optional Reading Fonts v1

miru remains local-first: optional built-in fonts are self-hosted, loaded only after the reader chooses them, and excluded from the service-worker precache. No Google Fonts or third-party font CDN is used at runtime.

## Included Fonts

| Font | Purpose | Source | License | Shipped files |
| --- | --- | --- | --- | --- |
| Literata | Alternate long-reading serif with a bookish editorial voice | Fontsource package `@fontsource-variable/literata@5.2.8` | SIL Open Font License 1.1 | Latin variable normal WOFF2 (52,496 bytes) and italic WOFF2 (53,728 bytes) |
| Atkinson Hyperlegible | Accessibility-oriented reading option | Fontsource package `@fontsource/atkinson-hyperlegible@5.2.8` | SIL Open Font License 1.1 | Latin 400 WOFF2 (17,208 bytes) and 700 WOFF2 (17,524 bytes) |

The redistributed font assets carry their copyright notices and the full
SIL Open Font License text in `public/fonts/optional/LICENSES.txt`.

## Loading Contract

- Default Newsreader / Space Mono loading remains unchanged.
- Optional fonts live under `public/fonts/optional/`.
- Selecting an optional font calls the local font registry and loads only that font's files with the `FontFace` API.
- Optional font files are intentionally excluded from Workbox precache, so they are not downloaded on first visit or offline install unless selected.
- Latin-only optional fonts keep the existing CJK fallback chain (`Songti SC`, `PingFang SC`, `Noto * CJK SC`) so Chinese documents remain readable.

## Deferred

Chinese built-in fonts such as LXGW WenKai are deferred until there is an explicit size/subset decision. Full CJK font files are large, while static subsets risk missing arbitrary Chinese document glyphs.
