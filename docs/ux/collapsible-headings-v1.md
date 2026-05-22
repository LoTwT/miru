# miru V1 — Collapsible headings (task #24) · interaction spec

> Status: **FINAL — ready for TL impl PR.** UX · TL feasibility ✅ (route a: H1-only + runtime DOM enhancement + no-persistence; affordance = disclosure button, hit-area = enlarged invisible button in gutter, NOT whole-row, to preserve `header-anchor` permalink) · Product affordance + discoverability **B confirmed ✅**. Division: Product=scope/policy · UX=interaction · TL=impl. Final visual verdict on TL's PR.

## 1. Principle (reading-first)

- Folding is a **temporary skim tool**, not a layout mode. Calm, recedes; the page must still read like a booklet when nothing is folded.
- **Default = fully expanded. Refresh = fully expanded. No persistence.** (Product policy.)

## 2. Scope

- **H1 only** this round. Clicking an H1's disclosure folds that section's content up to the next same-level (H1) heading. Nested H2/H3 ride along inside the folded range; they are not independently foldable in V1.
- Runtime DOM enhancement (route a): after render, wrap each H1's following siblings (until next H1) in a `.reader-section` container for `aria-controls`; inject the disclosure button. No markdown/source change.

## 3. Affordance (decision: B · faint persistent, hover/focus deepens)

- **Disclosure button lives in the left gutter**, beside the H1 — **never on the heading text** (the heading text is the `markdown-it-anchor` `.header-anchor` permalink; toggle and permalink must not collide).
- **Persistent at low opacity (~0.22)** so there is always a "clickable" cue for readers (not in an editor mindset, may never hover-hunt). On hover/focus/collapsed → opacity rises.
  - Rationale over pure-hover (A): mobile has no hover; B uses **one DOM/CSS state set across desktop+mobile** and is more discoverable.

### 3.1 Visual details (final)

- **Glyph = small FILLED triangle, inline SVG** (NOT unicode ▾/▸ — varies by platform, washes out at 0.22). **One triangle rotated by state**: expanded = down `rotate(0)`, collapsed = right `rotate(-90deg)`. Rotation transitions smoothly; reduced-motion = instant.
- **Visible size** ≈ **10px** optical, inside the ≥44pt invisible button.
- **Color**: `--reading-accent` (theme-adaptive; no hardcoded hex).
- **Opacity by state** ("expanded" = rest baseline, NOT a deepen trigger, else every default triangle would be loud):
  | State | Opacity |
  |---|---|
  | Expanded + idle (default) | **0.22** |
  | hover / focus-within | **1.0** |
  | Collapsed (aria-expanded=false) | **~0.9** |
- **Baseline**: triangle vertically centered on the heading **first-line cap-height optical center** (not full line-box); horizontally optical-center ≈ **34–40px** left of heading text start (desktop). `#` permalink stays at text trailing edge.
- **Narrow screens**: reserve `padding-inline-start` on the reader column (or negative margin within existing padding) so the triangle is never clipped.
- **Hit area**: button's *invisible* area enlarged into the gutter, ≥44pt; must NOT swallow the heading-text permalink (click text = anchor; click triangle = toggle).

## 4. Behavior

- Click / Enter / Space toggles the section.
- Collapsed: content hidden via `.reader-section`, glyph → ▸, aria-expanded=false.
- Expanded: content shown, glyph → ▾, aria-expanded=true.
- **No persistence**: in-memory only; reload restores all-expanded.
- **reduced-motion**: instant toggle, no height animation (with motion, a short height/opacity transition is fine — calm, not bouncy).

## 5. Accessibility

- Real `<button>` with `aria-expanded` + `aria-controls` → `.reader-section` id. Accessible name e.g. `折叠/展开「<heading text>」`.
- Keyboard reachable in normal Tab order (just before its heading). **focus-visible ring (DS focus-ring) on the button only**.
- Touch target ≥44pt. Permalink anchor independently focusable/clickable.

## 6. Acceptance (AC-24*)

- AC-24-1: each H1 has a gutter disclosure button; expanded-idle ~0.22, hover/focus → 1.0, collapsed → ~0.9; heading text still works as permalink.
- AC-24-2: toggling folds/unfolds content up to next H1; nested H2/H3 ride along; glyph ▾↔▸ tracks aria-expanded.
- AC-24-3: default + reload = all expanded (no persistence).
- AC-24-4: a11y — keyboard-operable (Enter/Space), aria-expanded/aria-controls correct, focus-visible ring on button, ≥44pt; permalink independently reachable.
- AC-24-5: reduced-motion → instant, no height animation.
- AC-24-6: desktop + mobile share one state set (no hover-only path); mobile tap reveals/toggles.

## 7. Out of scope (V1)

- Per-H2/H3 independent folding; collapse-all/expand-all; persistence; deep-link auto-expand (revisit).
