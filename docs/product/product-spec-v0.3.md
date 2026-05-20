# miru — Product Spec v0.3 (reconstructed)

> **Status**: V0 lock-ready candidate, reconstructed from #miru channel history (2026-05-13 design round) after original `/tmp/miru-draft/` was lost. Pairs with UX `docs/ux/design-v0.3.md` (UX-Sunna). Pending: LoTwT/miru repo confirmation before PR; one open token-ownership decision for lo-user.
> **Owner**: PM-Rin (product) · UX-Sunna (UX) · TL-Vivian (tech) · QA-Dialyn (verification)

## 1. North star

> 打开 miru 像翻开一本排版精良的小册子 — 没有工具感，只有内容。
> (EN: Reading-grade markdown, nothing else.)

miru is a **reading-first markdown viewer**: paste / drop / fetch a markdown document and read it in a calm, typography-led, distraction-free surface. The product's primary value is *reading comfort*, not editing power. UI chrome recedes; content is primary.

## 2. V0 scope

### 2.1 Must (V0)
- **Single rendered view** — show the rendered markdown only; no split editor, no source pane.
- **Reader mode by default** — editing/input is a hidden affordance, not the default surface.
- **Input methods (all V0)**:
  - Paste (`Cmd+V` global) — zero-config, pure front-end.
  - Drag-and-drop `.md` file — full-screen drop overlay on `dragenter` (native Reeder/Apple Books feel).
  - Open file (picker) — desktop + mobile action sheet.
  - URL fetch — **pure front-end fetch only** (CORS-allowed raw URLs: GitHub raw / Gist raw / any CORS-enabled raw). **No server proxy. No GitHub blob→raw auto-conversion** (V0 not "smart").
- **Reading-grade typography** — 65ch content width, 1.7 body line-height, 18–19px desktop / 17px mobile, Inter sans, 4-level heading hierarchy, asymmetric heading spacing, optical letter-spacing correction.
- **Empty state = self-dogfood doc** — miru introduces miru: ~400–600 words exercising all markdown elements (h1–h4 / paragraphs / lists / quote / code / links / emphasis / table) ending with a CTA card (paste / open file / URL).
- **Reading-state affordance** — bottom-right floating single button (icon-only, 48×48), hover/tap expands menu (paste / open file / URL / clear); opacity decays on scroll; non-sticky brand mark (scroll-to-top reveals, Medium-style).
- **i18n** — chrome in Chinese; user's markdown content language untouched.
- **Desktop + mobile** — desktop priority; **mobile primary use case = "someone sends you a README, you read it on phone" (1–3k words) must be silky** (reader-grade typography + input + render perf within 1–3k words).
- **100% browser-local** — no backend, no server-side processing. This is a privacy selling point.

### 2.2 Out of scope (V0)
- Server backend / server proxy for URL fetch.
- GitHub blob URL auto-conversion (V0 not smart; V1 maybe).
- Mobile: TOC / sticky outline / reading-progress bar / multi-pane.
- Large-doc optimization (10k+ lines smoothness) — not a V0 target.
- Editing as a first-class surface (miru is read-first, not an editor).
- PWA — V1 candidate (offline / installable).

## 3. Personas
1. **Temporary viewer** — got a markdown link/file, just wants to read it cleanly once.
2. **Writer reading own work** — pastes their draft to see it rendered reading-grade.
3. **Dev reading a README/RFC** — opens a repo doc (often on mobile) to read 1–3k words comfortably.

## 4. Product decisions (locked from design round, Q1–Q9)
| # | Decision | Status |
|---|---|---|
| Q1 | Tone: reader-first / typography-heavy / calm / content-as-document | ✅ locked |
| Q2 | Layout: single rendered view (no split editor) | ✅ locked |
| Q3 | Editing: hidden affordance (`Cmd+E` toggle), default reader mode | ✅ locked |
| Q4 | Input: paste + drop + open-file (V0) + URL fetch (V0, browser-local CORS-only, no proxy) | ✅ locked |
| Q5 | Typography reuse: @ayingott/theme base (color / dark-light / spacing) + new `--reading-*` tokens; **token ownership = design-system** (lo-user `aa306d77` 2026-05-20; miru first consumer, UX-Sunna drives reading-tokens RFC) | ✅ LOCKED |
| Q5b | **Body font = serif (Newsreader)** (lo-user `b14e0e3b`/`aa306d77` 2026-05-20). Code stays mono, chrome stays sans. Single `--reading-font-body` value. | ✅ LOCKED |
| Q5c | **Remote image policy = (a) auto + hardened** (lo-user `aa306d77` 2026-05-20): auto-load + `referrerpolicy=no-referrer` + `loading=lazy` + scheme allowlist (http/https/data/blob/local); V1 adds `block remote images` toggle. Privacy framing: "no tracking" = no analytics/telemetry/fingerprint + no backend/proxy/logging; rendering content-referenced images ≠ tracking. | ✅ LOCKED |
| Q6 | i18n: chrome Chinese + user content language unchanged | ✅ locked |
| Q7 | Desktop priority + mobile 1–3k-word README must be smooth (no TOC/sticky/progress on mobile) | ✅ locked |
| Q8 | Differentiator: 打开即读，无干扰，typography-first | ✅ locked |
| Q9 | PWA: V1 candidate | ✅ locked (deferred) |

## 5. Requirements / business rules
- **R-PRIV-1**: All document processing happens in the browser. No markdown content is sent to any server. URL fetch is the user's browser fetching a CORS-allowed URL directly — miru never proxies.
- **R-SEC-1** (security-sensitive path, QA-owned acceptance): markdown rendering MUST define and enforce: raw-HTML policy (sanitize / restrict), XSS sanitization, unsafe-URL-scheme filtering (e.g., `javascript:`), CSP, and no third-party tracking/network calls. Acceptance criteria for these belong in QA's gate before any release.
- **R-INPUT-1**: Paste / drop / open-file always available in any state. URL fetch handles CORS-block gracefully — explicit error ("this URL doesn't allow cross-origin read; copy the raw content and paste instead") with a copy-URL helper, never a silent wall.
- **R-A11y-1**: heading nav / landmarks / focus management / reduced-motion / font-size zoom / high-contrast support (UX defines, QA validates).
- **R-PERF-1**: 1–3k-word documents render at reader-grade smoothness on mobile.

## 6. Acceptance criteria (product-level; QA derives test cases)
1. A pasted / dropped / opened / fetched markdown doc renders in the single reading view with the `--reading-*` typography applied.
2. Empty state shows the self-dogfood doc + CTA; first-time user can discover how to load their own content.
3. URL fetch works for a CORS-allowed raw URL; CORS-blocked URL shows the graceful guided error, not a crash/blank.
4. No markdown content leaves the browser (verifiable: no network calls carrying document content; only the user-initiated CORS fetch of the source URL).
5. Security gate (R-SEC-1) passes: malicious markdown (script injection, `javascript:` links, raw HTML) is neutralized per policy.
6. Mobile: a 1–3k-word README reads smoothly (typography + scroll + input via action sheet).
7. Dark/light theme honored from @ayingott/theme base.

## 7. Decisions (all resolved by lo-user 2026-05-20)
- **token ownership** → **design-system** (`--reading-*` tokens; miru first consumer; UX-Sunna, design-system canonical brand owner per V3 §3.2, drives the reading-tokens RFC). ✅
- **repo** → `LoTwT/miru` exists but **empty** (no commit / no default branch). Phase 0 = genesis docs commit combining PM product spec + UX design spec, then TL scaffold. ✅ Phase 0 go.
- **V0 scope** → proceed on this v0.3 baseline. ✅
- **body font** → **serif (Newsreader)**. ✅
- **remote image policy** → **(a) auto + hardened** (no-referrer / lazy / scheme-allowlist; V1 block toggle). ✅
- All P3 decisions locked → specs finalize → Phase 0 genesis commit → scaffold + reading-tokens RFC.

## 8. Next steps
1. UX `design-v0.3.md` (UX-Sunna, task #3) — UX spec reconstruction.
2. This product spec (PM-Rin, task #4) — done draft, pending lo-user OQ answers + repo for PR.
3. TL-Vivian (task #2) — scaffold + tech selection AFTER spec lands; meanwhile reversible tech-selection + markdown-security research.
4. QA-Dialyn — derive release gate from R-SEC-1 + acceptance criteria when implementation starts.
