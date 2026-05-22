# Quiet outline navigation v1.x

Status: implemented in the quiet outline navigation PR. Desktop outline position config added in the follow-up PR.

## Intent

Outline navigation helps long, heading-rich documents answer two reading questions:

- Where am I in the document?
- How do I jump to another section quickly?

It complements collapsible H1 sections. The outline handles orientation and jump navigation; the left-gutter disclosure triangle handles content folding.

## Adaptive threshold

The outline is only enabled when the rendered document has at least 4 headings across H1-H3. Shorter documents show no outline chrome.

## Desktop

- Show a quiet gutter rail that does not change or squeeze the reading measure.
- Default position is **right**. A reading-settings control may switch the desktop rail to **left**.
- The position control appears only when the desktop rail is relevant: wide viewport plus a heading-rich document. Mobile keeps the bottom-sheet outline and does not show a left/right control.
- Left position mirrors the rail outside the reading measure and adds roughly 0.75-1rem more breathing room than the right side so it does not crowd the H1 disclosure triangle in the left gutter.
- The rail lists H1-H3 headings.
- H2/H3 are indented.
- The active section uses full contrast plus a terracotta tick.
- Inactive labels stay muted; hover/focus restores full contrast.
- Scroll-spy updates the active item while reading.
- Clicking an item jumps to that heading and moves focus to the heading.

## Mobile

- Do not show a persistent sidebar.
- If the adaptive threshold is met, show a small outline trigger in the reading tools stack near `aA`.
- Opening the trigger shows a bottom sheet using the same interaction pattern as the reading settings sheet.
- Clicking an outline item jumps to the heading and closes the sheet.

## Collapsible heading integration

Outline items reuse heading `id` anchors from the existing markdown renderer.

If the target heading is inside a collapsed H1 section, navigation first expands that parent H1 section, then scrolls/focuses the target heading. This avoids jumping to hidden content.

## Accessibility

- Use `<nav aria-label="文档大纲">`.
- Outline items are anchors with `href="#id"`.
- The active item uses `aria-current="location"`.
- The left/right position control is a segmented radio group inside the existing `aA` reading settings popover.
- The mobile sheet is a non-modal reader popover/drawer.
- Escape closes the mobile sheet and returns focus to the trigger.
- Reduced-motion users get instant scroll behavior.

## Acceptance checks

- No outline appears for documents with fewer than 4 H1-H3 headings.
- Heading-rich documents show the desktop rail on wide screens and the mobile trigger/sheet on narrow screens.
- Wide heading-rich documents expose `大纲位置` in reading settings; choosing left/right persists locally and reset returns to right.
- Narrow screens do not expose the left/right position control.
- Clicking a TOC item updates location hash, scrolls/focuses the heading, and preserves heading permalinks.
- Clicking a TOC item inside a collapsed H1 expands the parent before scrolling.
- The rail/sheet never changes `--reading-measure` or stores user data.
