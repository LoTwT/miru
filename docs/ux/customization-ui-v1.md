# miru V1 — Reading customization UI · interaction spec (FINAL)

> Status: **FINAL — all gates green.** Product design sign-off ✅ (`0de3086b`) · TL feasibility ✅ (`8077c090`) · QA sepia-AA PASS ✅ (`267ee431`, condition: muted `#6f6149` — applied) · UX. Ready for TL-Vivian implementation PR. Task #26. Built on V0 `--reading-*` token contract + runtime mutation API + persistence (read-in-V0). Division: Product=scope/persistence-policy/priority · UX=interaction (this doc) · TL=impl.

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
- 4 themes. light/dark via existing semantic layer + `.dark`; **跟随系统** = follow OS (default, = V0). **sepia = explicit preset token override** on the semantic layer (NOT JS-writing base); cleared when switching away (no residue).
- **Sepia palette (UX; QA AA-confirmed)**: `--reading-bg #f4ecd8` · `--reading-fg #463b29` · `--reading-fg-muted #6f6149` · `--reading-code-bg #ece1c4` · `--reading-link #66569d`. UX WCAG pre-check on `#f4ecd8`: fg **9.30:1**, link **5.27:1** (no swap needed), code-fg **8.41:1**, muted **5.12:1** (darkened from #8a7d63 which was 3.43 fail) — all ≥4.5 AA. QA authoritative confirm: PASS.

## 8. Acceptance (AC-C* + e2e)
- AC-C1: `aA` reachable keyboard+touch; panel opens, Esc/outside/toggle closes + focus returns to `aA`; page not locked.
- AC-C2: each discrete dial changes the real reading view immediately (no apply); measure mobile-safe (`max-inline-size: min(100%, var(--reading-measure))`, no overflow at 75ch on mobile).
- AC-C3: reset restores V0 defaults (clears localStorage); settings persist + restore on reload.
- AC-C4: a11y — controls keyboard/SR operable, labeled w/ values; reduced-motion respected; focus-visible present.
- AC-C5: panel never permanently occludes the reading measure (desktop) / leaves text visible above (mobile sheet).
- AC-C6: sepia preset AA-verified (QA); switching themes leaves no residual override.
- e2e: discrete apply-live, reset, persist/restore, theme switch incl. sepia clear, mobile bottom-sheet no-overflow.

## 9. Non-text / future notes (QA `267ee431`)
- `code-bg #ece1c4` vs `bg #f4ecd8` = 1.11:1 — intentional subtle code surface (consistent w/ light/dark); not text-AA-gated. Keep.
- `--reading-rule` (table/divider): subtle low-contrast OK for reading dividers. **If it ever becomes an interactive control border (hard WCAG non-text 3:1), set a deeper sepia `--reading-rule`** — out of scope this round.
- sepia `--reading-accent`: V1 controls use their own chrome colors (segmented selected = light-lavender bg + dark-lavender text), NOT `--reading-accent`, so no filled-accent-text in sepia. **If a filled CTA/checkbox ever puts text on the accent in sepia, use `#8c552f` (5.16:1 both ways, QA-proposed)**; for border/decoration the existing accent is fine. Not a blocker.

## 10. Status
- **All gates green. Spec FINAL.** → TL-Vivian opens implementation PR; Product reviews scope on PR; UX visual + QA verify on PR.
