# miru V1 — Reading customization UI · interaction spec (FINAL)

> Status: **FINAL — implemented.** Product design sign-off ✅ (`0de3086b`) · TL feasibility ✅ (`8077c090`) · QA sepia-AA PASS ✅ (`267ee431`, condition: muted `#6f6149` — applied) · warm-paper sepia refresh accepted by UX brand review (`f0c6e075`) and Product scope (`10247d7b`). Built on V0 `--reading-*` token contract + runtime mutation API + persistence (read-in-V0). Division: Product=scope/persistence-policy/priority · UX=interaction (this doc) · TL=impl.

## 1. Principle (reading-first)
- Reading surface stays the hero; the panel is **chrome that recedes**. Live preview applies to the **real content** (not a preview box). Calm, on-brand, `--reading-*` tokens.
- **Defaults = V0 current values → pure opt-in; an untouched reader sees zero change.**

## 2. Affordance
- **Independent `aA` control** (same layer as the FAB but independent state — does NOT reuse the load-FAB menu). Recedes on scroll like the FAB. Safari-Reader / Apple-Books "aA" mental model.
- Opens the customization panel. **Desktop**: floating panel anchored near `aA` (right), does not occlude the reading column. **Narrow screens (≲640px)**: panel becomes a **bottom-sheet** (rises from bottom, full-width, drag handle; reading text stays visible above for live preview; no overflow).

## 3. Controls (all DISCRETE — no free sliders; TL constraint)
| Dial | Steps | Default | Writes |
|---|---|---|---|
| 字号 Font size | **5**: 16 / 18 / 20 / 22 / 24 px | 18 (V0) | `--reading-font-size` |
| 行宽 Measure | **3**: 55 / 65 / 75 ch | 65 (V0) | `--reading-measure` |
| 行距 Line-height | **3**: 1.5 / 1.7 / 1.9 | 1.7 (V0) | `--reading-line-height` |
| 正文字体 Body font | **2**: serif / sans | serif (V0) | `--reading-font-body` |
| 主题 Theme | **4**: 跟随系统 / 浅 / 深 / sepia | 跟随系统 (= V0 current; V0 already follows OS) | theme preset |
| 重置 Reset | action | — | clears all overrides |

- **字号 labels**: ascending "A" size glyphs (small→large A), language-neutral (fits miru's 中英 readers); px maps internally.
- **字号 applies to reading typography as a system**: body text writes `--reading-font-size`; heading scale tokens derive from that same value so H1/H2/H3/H4 move with the selected reading size while preserving hierarchy.
- **Body font stacks**: serif (default) = `"Newsreader", Georgia, "Songti SC", "Noto Serif CJK SC", serif`; sans = neutral system humanist `-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif` (NOT DS Space Grotesk — that's display/grotesk, heavy for long-form; DS consistency stays in chrome/headings).

## 4. Live preview
- No apply button. Selecting a discrete step applies immediately to the real reading view (token write → cascade). Discrete = no drag-throttle needed.
- Panel positioned so the reading column stays visible while adjusting (desktop right-anchored; mobile sheet leaves text above).

## 5. Defaults · persistence · reset
- **Empty persisted state = current** (跟随系统 + V0 values). Only an explicit choice writes an override/preset.
- Persist via `useReadingSettings` composable + writePersist (localStorage-only; TL state layer). Restored on load (V0 already reads persisted).
- **Reset「恢复默认」**= clear localStorage overrides → back to CSS/media + V0 token defaults (no base-token inline writes). Distinct from the **跟随系统** theme option (a theme choice, may write preset=system).

## 6. Accessibility (non-modal reader popover — NOT full focus-trap)
- Panel = reader popover/drawer: on open, focus moves into the panel; **Esc / outside-click / toggle `aA` closes and returns focus to `aA`**; Tab walks the panel controls naturally; **the page is NOT locked** — the reader can still reach the content / FAB (reading-first). (TL refinement, accepted.)
- Controls = real form controls: radio/segmented groups (`aria-checked`, visible label + `aria-valuetext` where useful e.g. "字号 大"); reset = button.
- focus-visible rings (DS `focus-ring`); touch targets ≥44pt.
- **reduced-motion**: panel open/close no slide (instant/fade); live-preview token changes apply without animated reflow.

## 7. Themes + sepia
- 4 themes. **Explicit light / dark / sepia via `:root[data-reading-theme=light|dark|sepia]` token override** (NOT JS-writing base). **跟随系统** = no `data-reading-theme` attr set → falls back to existing `prefers-color-scheme` media-query path (default, = V0). sepia = a `data-reading-theme=sepia` preset; switching away clears the attr/override (no residue). (Impl mechanism per PR #12.)
- **Warm-paper sepia palette (miru-local preset override; UX brand-reviewed, QA to verify on implementation PR)**:
  - `--reading-bg #efe1bd`
  - `--reading-fg #463b29`
  - `--reading-fg-muted #64553e`
  - `--reading-link #66569d`
  - `--reading-link-hover #55468d`
  - `--reading-accent #83502d`
  - `--reading-rule #c4a466`
  - `--reading-code-fg #463b29`
  - `--reading-code-bg #e2cb99`
- **Sepia AA matrix (UX pre-check)**: fg on bg **8.43:1**; muted on bg **5.56:1**; link on bg **4.78:1**; hover on bg **6.11:1**; accent on bg **5.13:1**; bg on accent **5.13:1**; code-fg on code-bg **6.90:1**; muted on code-bg **4.55:1**. All text pairs are ≥4.5 AA. `code-bg #e2cb99` was accepted as a subtle but visible surface step; a darker code block should be paired with a future sepia-specific Shiki theme rather than only darkening the background.

## 8. Acceptance (AC-C* + e2e)
- AC-C1: `aA` reachable keyboard+touch; panel opens, Esc/outside/toggle closes + focus returns to `aA`; page not locked.
- AC-C2: each discrete dial changes the real reading view immediately (no apply); measure mobile-safe (`max-inline-size: min(100%, var(--reading-measure))`, no overflow at 75ch on mobile).
- AC-C3: reset restores V0 defaults (clears localStorage); settings persist + restore on reload.
- AC-C4: a11y — controls keyboard/SR operable, labeled w/ values; reduced-motion respected; focus-visible present.
- AC-C5: panel never permanently occludes the reading measure (desktop) / leaves text visible above (mobile sheet).
- AC-C6: sepia preset AA-verified (QA); switching themes leaves no residual override.
- e2e: discrete apply-live, reset, persist/restore, theme switch incl. sepia clear, mobile bottom-sheet no-overflow.

## 9. Non-text / future notes (QA `267ee431`)
- `code-bg #e2cb99` vs `bg #efe1bd` = **1.22:1** — intentional subtle code surface (consistent with light/dark); not text-AA-gated. Keep unless a future sepia-specific Shiki theme is introduced.
- `--reading-rule #c4a466` gives dividers/table frames visible structure without making the page heavy. If a future control border requires hard WCAG non-text 3:1, evaluate that component separately.
- sepia `--reading-accent #83502d` is AA both directions on the warm-paper bg (5.13:1) if it is ever used as filled text/background; V1 controls still use their own chrome colors.

## 10. Status
- **All gates green. Spec FINAL.** → TL-Vivian opens implementation PR; Product reviews scope on PR; UX visual + QA verify on PR.
