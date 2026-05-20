# miru — UX Design Spec v0.3

> **Status**: reconstructed from #miru channel history (original `/tmp/miru-draft/docs/ux/design-v0.1.md` lost with /tmp). Companion to `docs/product/req-v0.3.md` (PM-owned). Source of truth for combined v0.3: PM-Rin `#miru:a106b62a`.
> **Owner**: @UX (UX-Sunna), cross-team. **Validated by**: @QA (QA-Dialyn) against §11 acceptance criteria.
> **North star** (miru-D-01, lo-user `7ff8e767`): "舒服地阅读 markdown" — reading-first.
> **Tagline**: 「打开 miru，像翻开一本排版精良的小册子。」

---

## 1. Design principles

1. **Document, not tool.** The screen reads as a typeset page, not an app chrome. Every pixel that isn't content earns its place.
2. **Reading-first, not editor-first.** No split pane, no live-edit, no tabs in V0. The reader opens, content appears, they read.
3. **Calm by default.** Generous whitespace, constrained measure, comfortable rhythm. Nothing competes with the words.
4. **Invisible until needed.** Input affordances and chrome recede once content is loaded; they surface on intent (hover/focus/empty).
5. **Architecture ready for customization, UI deferred.** V0 ships one carefully-tuned theme; the token + runtime + persistence architecture is fully built so V1 adds UI without re-architecting (miru-D-03 / D-04, lo-user `7a64a83e`).

Reference points: Marked.app · Mercury Reader · browser Reader Mode · Bear reading view.
Anti-patterns: dillinger.io · StackEdit · HackMD · VS Code preview (all editor-first / tool-first).

---

## 2. Personas (UX lens)

| Persona | Need | V0 priority |
|---|---|---|
| P1 one-off reader | pasted a `.md` snippet/file, wants it clean & comfortable fast | primary |
| P2 author-reader | reads own/others' markdown prose | primary |
| P3 developer reader | README / docs (VS Code preview replacement) | secondary (by-product) |
| P5 non-dev customizer | wants in-app font/theme dials | V1+ (V0 = CSS override only) |

UX optimizes the **first 60 seconds for P1/P2**: open → see a beautifully set sample → understand "this is for reading" → paste/drop their own → instant comfortable render.

---

## 3. Information architecture

Single surface. One column of content, minimal chrome.

```
┌─────────────────────────────────────────────┐
│  [chrome: app mark only]                       │  ← scrolls away
├─────────────────────────────────────────────┤
│                                               │
│        rendered markdown (reading column)     │  ← the product
│        max measure ~65ch, centered            │
│                                               │
└─────────────────────────────────────────────┘
```

- **No** sidebar, no file tree, no tab bar, no split editor (all V1+/deferred).
- Chrome = app identity + a floating input affordance. The top mark scrolls away; the fixed affordance recedes visually during reading and returns on intent.
- Reading column is horizontally centered; content measure is capped (see §6) regardless of viewport width.

---

## 4. Screen states & layout

### 4.1 First paint (empty → self-dogfood)
- On open, **auto-load the sample doc** (miru-D-09). The empty state *is* a live demo of miru's reading experience — the sample doc itself teaches GFM support + reading comfort.
- No loading spinner; first contentful paint shows the sample (AC-U1: < 2s).

### 4.2 Reading state
- Rendered markdown fills the reading column. Chrome quiet. This is the 95% state.

### 4.3 Input affordances
Four entries, equal first-class (aligned to product req §2 V0 scope — reconciled from earlier 3-input draft; open-file added for discoverability/a11y since drag-drop alone excludes keyboard/touch users):
1. **Paste** markdown text (Cmd/Ctrl+V anywhere, or the floating menu paste action). The menu paste action is best-effort: it may try `navigator.clipboard.readText()`, but clipboard permission/secure-context failure is a normal path. On failure, show calm inline guidance to press Cmd/Ctrl+V; global paste remains available.
2. **Drag-drop** a `.md` file onto the surface
3. **Open file** — a file-picker button (keyboard/touch-accessible alternative to drag-drop)
4. **URL fetch** (enter/paste a URL **into the URL field** → fetch + render; browser-local, CORS-only, no proxy). Note: pasting a URL into the document body renders it as text per §5 — fetch is the URL field only.

Affordance design:
- V0 uses a fixed bottom-right floating action button (FAB), 48×48 minimum, respecting mobile safe areas. The FAB is the primary visible input affordance after first paint.
- Collapsed FAB is quiet and on-brand; it never covers the reading column. On scroll-down reading idle it fades to roughly 0.3 opacity, never fully disappearing. Hover, pointer movement, tap, focus, or scroll-up restores full opacity. Reduced-motion disables fade animation and keeps the control stable.
- Expand behavior: desktop hover or click; mobile tap. Expanded menu contains paste, open file, URL, and clear. Dismiss on outside click, Esc, or toggling the FAB. After dismiss, focus returns to the FAB.
- URL fetch is only through the URL field in the expanded menu. The field shows inline fetching/error states and keeps paste/drop fallback visible.
- Clear returns to the sample document (OQ-UX2 resolved); there is no separate "example" item.
- Top-left `miru` mark is non-sticky: visible on load, scrolls away while reading. After scrolling down, upward scroll reveals a small brand/scroll-to-top affordance; click scrolls to top. Reduced-motion makes scroll-to-top instant.
- Global paste (Cmd/Ctrl+V) and drag-enter drop overlay remain ambient inputs outside the FAB.
- Drag-over: surface shows a subtle bordered drop affordance + one line of copy (中文 chrome): 「拖放 .md 文件到这里」.
- A11y: FAB is a real button with `aria-label` and `aria-expanded`; menu items are keyboard reachable (Tab/arrow keys), Esc closes, focus-visible is clear, and opacity fade never removes controls from the tab order or screen reader tree.

### 4.4 Empty / loading / error states
| State | Trigger | Treatment |
|---|---|---|
| Empty (initial) | first open | auto sample doc (never a blank screen) |
| Empty (user cleared) | user clears content | return to sample (OQ-UX2 resolved) |
| Loading (URL fetch) | URL submitted | inline calm progress on the affordance, not a full-screen spinner; target < perceptible delay |
| Error — bad file | non-md / oversized | inline, non-blocking, 中文: 「无法读取这个文件，请确认是 .md 或纯文本。」 |
| Error — URL fetch fail | network / CORS / 404 | inline, actionable, 中文: 「拉取失败 — 可能是跨域限制或链接失效。可以改用粘贴或拖放。」 + offers paste fallback |
| Error — fetch blocked (CORS) | CORS | explicitly name CORS in friendly terms + fallback path (don't dead-end) |

Principle: errors are **inline, calm, and always offer a fallback path** (paste/drop). Never a red modal, never a dead end.

---

## 5. Input flows

```
Paste text         → parse → render (< 100ms, AC-U2)   [V0: always rendered as markdown]
Drop .md file      → read → parse → render (AC-U3)
Open file (picker) → read → parse → render
URL field → fetch  → (success) render / (fail) inline error + fallback
```

- **V0 paste behavior**: pasted content is **always rendered as markdown text**. URL fetch is reached only through the explicit URL field, not by auto-detecting a pasted bare URL.
- **Deferred to V1+** (decision 2026-05-20, PM+UX): *bare-URL-paste auto-fetch* — detecting that pasted body content is a bare URL and routing it to fetch. Deferred because (a) the explicit URL field already covers fetch intent, and (b) auto-detecting "bare URL = fetch vs. a document that happens to start with a link = render" carries a false-positive mis-routing risk (a real document fetched as a URL). V0 keeps the predictable, safe behavior: paste → render. (See §13 deferred list.)
- All processing is 100% browser-local (req §3.5 privacy: no server, no third-party tracking).

---

## 6. Typography & reading layout (core UX)

This is the heart of miru. The defaults below are the V0 built-in theme.

| Property | V0 default | Token |
|---|---|---|
| Body measure (line length) | **65ch** max (AC-U5) | `--reading-measure` |
| Line height (body) | **1.7** | `--reading-line-height` |
| Body font size | 18px base, fluid clamp to viewport | `--reading-font-size` |
| Body font family | **Newsreader (serif)** — see §6.1 decision | `--reading-font-body` |
| Heading font family | Newsreader (serif) display optical size | `--reading-font-heading` |
| Mono / code font | a reading-grade mono (e.g., a Fontsource mono) | `--reading-font-mono` |
| Paragraph spacing | rhythm tuned to line-height (≈ 1 line) | `--reading-paragraph-gap` |
| Heading scale | modular, restrained (not oversized) | `--reading-scale-*` |
| Color (light) | warm near-black on warm near-white (not pure #000/#fff) | `--reading-fg` / `--reading-bg` |
| Color (dark) | auto via `prefers-color-scheme`; soft off-white on deep neutral | same tokens, dark values |

### 6.1 Default body font — **LOCKED: Newsreader (serif)** (lo-user `aa306d77`-round, 2026-05-20)
miru-D-08 resolved (OQ-miru-4): **Newsreader (serif)** for body prose.

Rationale:
- North star is "翻开一本排版精良的小册子" (opening a beautifully typeset booklet). A booklet/long-form reading metaphor points to serif for body text.
- Serif supports sustained long-form reading and reinforces the "document, not tool" positioning (sans reads more "app/UI").
- Newsreader is a Fontsource-available, optical-size variable serif designed for screen reading — fits the Fontsource lazy-load infra (miru-D-10) and the reading-grade requirement.
- Code blocks stay monospace regardless; chrome/UI labels may use a system sans for crispness — body prose is serif.

Token architecture keeps this a single `--reading-font-body` value, so any future revisit is a one-value change with zero structural impact.

### 6.2 Reading rhythm
- Measure cap (65ch) holds on all viewports; on wide screens the column centers with calm margins (do not let prose run full-width — AC-U5).
- Mobile = README-grade (req §3.5): the same reading column, scaled; comfortable but not mobile-first-optimized.
- 中英混排 must not break layout (AC-U6): tune CJK line-height + punctuation so mixed Chinese/English prose stays even.

---

## 7. Code blocks & GFM

- **Shiki** syntax highlighting (miru-D-10 lock). V0 default code theme: a light theme paired to the reading light theme (candidate `github-light`); dark variant paired to dark mode. UX finalizes the single default pairing in Phase 2.
- Inline code: tinted surface, mono font, no heavy box.
- GFM rendering: tables / task lists / strikethrough / autolink (req §3.1). Tables must stay readable within measure (horizontal scroll on overflow, not layout break).
- Code block readability: comfortable padding, line-height slightly tighter than prose, soft surface tint (token `--reading-code-bg`), copy affordance optional (V1).

### 7.1 Images (UX-vs-privacy tradeoff — needs lo-user decision)
Images are content, not decoration, in a reading-first app. Handling intersects R-PRIV (no third-party tracking):
- **Local images** (`data:` / `blob:` / same-bundle): always render.
- **Remote images** (`http(s)` arbitrary host): rendering them = a third-party request that reveals reader IP/referrer. Three options:
  | Option | reading UX | privacy |
  |---|---|---|
  | (a) auto-load + privacy note ("content image ≠ tracking") | ✅ complete reading | reader IP exposed to image host (not analytics tracking) |
  | (b) placeholder + per-image click/hover opt-in | ⚠️ interrupts flow, user-controlled | ✅ no auto third-party request |
  | (c) placeholder/link only | ❌ image-heavy docs unreadable | ✅ strictest |
- **LOCKED: (a) hardened auto** (OQ-miru-5 resolved, lo-user `aa306d77`, 2026-05-20). "No third-party tracking" is defined precisely as *no analytics / telemetry / fingerprinting / miru proxy / miru logging*; content images render normally with a privacy note; a V1 "block remote images" toggle is reserved for strict users.
- **Default mode `auto` hardening** (TL-Vivian + QA locked): `referrerpolicy="no-referrer"` (image host learns neither which doc nor which page — only IP, unavoidable for any remote fetch) + `loading="lazy"` + `decoding="async"` + strict scheme allowlist (http/https/data/blob/local only) + no analytics/telemetry/proxy/logging.
- Architecture stays decision-agnostic: one image renderer supports `auto`/`prompt`/`block`; V1 `block remote images` toggle flips the default. Image rendering passes through DOMPurify/sanitizer + URL-scheme allowlist regardless of mode.
- **QA release gate** (QA-Dialyn): verify auto-load + no-referrer + lazy/async + scheme allowlist + no analytics/telemetry/fingerprinting + no miru proxy/logging + V1 block-toggle architectural exit.

---

## 8. Customization architecture (V0 contract, V1 forward-compat)

V0 ships **no in-app customization UI** (miru-D-03, lo-user `7a64a83e`): no settings button/drawer, no Cmd+,, no preset switcher, no dials. But V0 **must** build the full architecture so V1 adds UI without re-architecting (miru-D-04).

### 8.1 `--reading-*` token contract (AC-A1)
All visual quantities are exposed as CSS custom properties under the `--reading-*` namespace. **Ownership LOCKED: design-system** (OQ-miru-1 resolved, lo-user 2026-05-20; miru-D-07). Reading-tokens land in **LoTwT/design-system V0.1** via RFC; miru is the first consumer. Cross-repo coordination: @UX (me — cross-team + design-system canonical brand owner per V3 §3.2, **I drive the reading-tokens RFC**) ↔ @TL-Anby (design-system impl) ↔ @TL-Vivian (miru consumption).

Token families (minimum): `--reading-measure`, `--reading-line-height`, `--reading-font-size`, `--reading-font-body`, `--reading-font-heading`, `--reading-font-mono`, `--reading-fg`, `--reading-bg`, `--reading-paragraph-gap`, `--reading-scale-*`, `--reading-code-bg`, `--reading-link`, `--reading-accent`.

### 8.2 V0 power-user path
Developers customize via **CSS override / config / URL params** (documented, AC-A7). This is the only V0 customization surface — no GUI.

### 8.3 V1 forward-compat hooks (architecture, no UI in V0)
| Hook | V0 ships | V1 adds |
|---|---|---|
| Runtime mutation API (AC-A2) | a documented API to write `--reading-*` at runtime (no UI calls it yet) | settings drawer calls it |
| Persistence schema (AC-A3) | localStorage schema designed + **read** path implemented (write deferred) | write path |
| Theme abstraction (AC-A4) | theme = a token-value collection; registry supports N themes (V0 has 1) | preset registry / multi-theme |
| Font lazy-load infra (AC-A5) | Fontsource dynamic-import pattern in place (V0 ships 1 font) | multi-font registry + switcher |
| UI surface reservation (AC-A6) | code comment marks the V1 settings-drawer mount point | mount the UI |

→ **V0 acceptance includes architecture readiness, not just V0 behavior** (req §3.4). QA validates these as testable criteria (§11).

---

## 9. Theme & color

- One built-in Default theme (V0). Light + dark variants of the same theme, auto-switching on `prefers-color-scheme` with **no flash** (AC-U4).
- Avoid pure black/white: warm near-black on warm near-white (light), soft off-white on deep neutral (dark) — easier on the eyes for sustained reading.
- All colors are tokens; dark values are token overrides under the dark scope (mirrors design-system `.dark` class convention — coordinate with design-system token contract).
- Contrast meets WCAG AA (AC-X2): body 4.5:1, large text 3:1, in both modes.

---

## 10. Accessibility (AC-X)

- **AC-X1 keyboard**: full keyboard nav, no mouse traps; paste/drop/URL all reachable without pointer.
- **AC-X2 contrast**: WCAG AA in light + dark.
- **AC-X3 screen reader**: semantic HTML; correct heading hierarchy (rendered markdown headings map to real `<h1..h6>` in order); landmarks for chrome vs content.
- **AC-X4 reduced-motion**: respect `prefers-reduced-motion` — drag overlay, theme switch, any transition degrade to instant.
- Reading column readable at 200% zoom without horizontal scroll of prose (measure-capped already helps).

---

## 11. UX acceptance criteria (QA-validatable)

UX-owned interaction/visual criteria that @QA validates. (Mirrors req §5; this is the UX-detail view.)

**Reading experience**
- AC-U1 first paint < 2s, sample doc visible, no spinner
- AC-U2 paste → render < 100ms
- AC-U3 drop `.md` → render (same perf)
- AC-U4 OS dark/light switch → auto-follow, no flash
- AC-U5 measure capped ≤ 65ch (default); prose never runs full-width on wide screens
- AC-U6 Shiki highlight works; 中英混排 doesn't break layout
- AC-U7 (UX-add) every input entry is discoverable within 5s by a first-time user without instruction: 48×48 FAB, four-item menu (paste/open-file/URL/clear), scroll opacity decay, scroll-to-top brand mark, mobile tap, keyboard access, and ambient paste/drop all work.
- AC-U8 (UX-add) every error state is inline, calm, names the cause, and offers a paste/drop fallback (no dead-ends, no red modals)

**Architecture readiness** (AC-A1..A7 per req §5 / §8)
- token contract / runtime API / persistence-read / theme abstraction / font lazy-load / UI mount comment / power-user docs

**a11y** (AC-X1..X4 above)

---

## 12. Motion & micro-interaction

- Restrained. Theme switch: optional soft cross-fade (≤ 200ms), killed under reduced-motion.
- Drag-enter overlay: calm fade-in, not a pop.
- No decorative animation that competes with reading. Motion serves feedback only.

---

## 13. Open questions / deferred

**Resolved (lo-user 2026-05-20):** font = Newsreader serif (OQ-miru-4) · token ownership = design-system (OQ-miru-1) · remote images = (a) hardened auto (OQ-miru-5) · V0 scope = v0.3 baseline (OQ-miru-3) · Phase 0 genesis commit = go (OQ-miru-5... P3-5).

**Resolved during implementation (2026-05-20):**
- OQ-UX1 default Shiki code theme pairing = `github-light` / `github-dark`.
- OQ-UX2 user-cleared empty state = return to sample.
- V0 input affordance = product §2.1 floating immersive affordance (lo-user chose B): bottom-right FAB + menu + scroll opacity + brand scroll-to-top. Top-chrome action toolbar is retired; top chrome keeps only the non-sticky brand mark. **Implemented** in PR #6 (`28c0388`, merged 2026-05-20) and live on `miru.ayingott.me`; §4.3 describes the shipped behavior.

**Deferred → V1+ (req §4):** in-app customization UI / preset switcher / 5-dial customization / line-height & spacing dials / accent picker / user-uploaded fonts / custom syntax colors / URL-fragment share / edit mode / multi-tab / collaboration / cloud sync / AI assist / PWA-offline / KaTeX / mermaid / **bare-URL-paste auto-fetch** (see §5 — V0 paste always renders as markdown; URL fetch via explicit URL field only).

---

## 14. Cross-references
- Combined v0.3 source: PM-Rin `#miru:a106b62a`
- Product req companion: `docs/product/req-v0.3.md` (PM-owned)
- Reading-tokens RFC: LoTwT/design-system V0.1 candidate (miru-D-07)
- Decisions: miru-D-01..D-10 (see req §10)
