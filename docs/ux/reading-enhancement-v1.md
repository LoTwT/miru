# miru · Reading Enhancement — Scope / Interaction Spec (task #111 canonical)

> **Owner**: UX-Sunna. Scope/spec for the reading-enhancement round (lo-user picked roadmap item 2). TL implements per the slicing below.
> **Already shipped — reuse, don't rebuild**: **quiet TOC / 大纲导航** (task #34: desktop rail / mobile bottom-sheet, adaptive, only on heading-rich docs) + reading-position persistence + the floating affordance (input menu) + reading tokens + focus-ring + reduced-motion.
> **New this round**: **阅读进度 (reading progress) · 文内搜索 (in-doc search) · 书签 (bookmarks)** — plus integrating them with the existing TOC.
> **Aesthetic constraint**: miru is quiet, reading-first ("像翻开一本排版精良的小册子"). Every addition must be calm + non-intrusive; reuse existing surfaces (TOC panel, floating affordance) rather than adding heavy chrome.

---

## 1. 阅读进度 (reading progress)
**Design**: a **thin reading-progress line at the very top edge** of the viewport (1–2px, `--reading-accent`, fills left→right as you scroll). Minimal, ambient, the established reading-app pattern (no number cluttering the reading surface).
- Optional: a small `% / 第 N 段` readout inside the TOC panel / affordance (not on the reading surface).
- **Position restore** (extend existing): on reopen, restore scroll position AND show the progress filled to there. (Reading position already persists for PDF + markdown; reuse it.)
- PDF: progress = current page / total (already have page indicator); the top line maps to page progress in paged mode, scroll progress in scroll mode (② just shipped).
- a11y: progress line is `aria-hidden` decorative; the real progress is the page/position indicator (announced). Reduced-motion: no fill animation, just static width.

## 2. 文内搜索 (in-doc search)
**Trigger**: intercept **Cmd/Ctrl+F** (don't let the browser's find hijack — or coexist; recommend our own) + a 搜索 entry in the floating affordance. Quiet search bar slides in (top, or in the affordance), reduced-motion = instant.
**Behavior**:
- Type → highlight **all matches** in the doc (subtle accent-tinted highlight, not garish); show **match count + position「3 / 12」**; **prev/next** (↑/↓ or Enter/Shift+Enter) scrolls to + emphasizes the active match; **Esc** closes + clears.
- Case-insensitive default; live (debounced) as you type.
- **Markdown first** (text is directly searchable + highlightable in the rendered DOM).
- **PDF search = follow-up / phase 2** (pdf.js needs a text layer; heavier — scope separately so it doesn't block markdown search). Flag for TL: in PDF mode, either disable search with a clear "PDF 搜索即将支持" or scope a text-layer pass later.
- Perf: debounce + efficient highlight on long docs (no jank); don't re-layout the whole doc per keystroke.
- a11y: search input labeled, match-nav keyboard-operable, active match announced (aria-live "第 3 个,共 12 个"), focus management on open/close.

## 3. 书签 (bookmarks)
**Add**: a quiet bookmark affordance — recommend **per-heading bookmark** (tap a TOC heading's bookmark dot) + a **"书签此处" action** for arbitrary scroll position (in the affordance). Keep it light, not a heavy toolbar.
**List + jump**: bookmarks live in the **TOC panel** (a 书签 section alongside the outline) — reuse the existing quiet TOC surface, don't add a new panel. Each bookmark: label (heading text or a snippet) + jump-to. Remove via swipe/×.
**Persist**: per-document, alongside reading position (same storage). Survive reopen.
- a11y: bookmark add/remove/jump keyboard-operable + aria-labels; list navigable.

---

## 4. Slicing / priority (recommend confirming PM-Akira's A/B split)
- **A (do first — closest to reading experience)**: **阅读进度** (top progress line + position restore) + TOC integration (it exists; just wire progress + the bookmarks section into it). Low risk, high felt value.
- **B**: **文内搜索 (markdown)** + **书签**. Depends on this scope. PDF search deferred to a phase-2 follow-up.
- Engineering health (item 5: chunk split #5.1, focus-ring unify #5.2) runs after, not blocking.

## 5. Acceptance (per feature)
- **进度**: line accurate to scroll/page; position restored on reopen; quiet (doesn't intrude on reading surface); paged + scroll PDF both; a11y + reduced-motion.
- **搜索**: all matches highlighted; count + prev/next nav + active emphasis; Cmd/Ctrl+F open + Esc close; no jank on long docs; markdown works (PDF clearly deferred-or-disabled); a11y (labeled, keyboard, aria-live).
- **书签**: add (heading + arbitrary position) / remove / jump; persist per-doc; listed in TOC panel; a11y.

## 6. a11y / motion (all three)
Keyboard-reachable + `aria` + focus-visible (reuse focus-ring; note item 5.2 will unify it全站); AA contrast for highlight + progress + bookmark UI (light + dark reading themes); reduced-motion → instant (no fill/scroll animation).

## 7. Out of scope (note)
- PDF in-doc search → phase-2 follow-up (text layer).
- Cross-document search / global bookmarks → not this round (per-doc only).
- TOC redesign → not needed (reuse #34).
