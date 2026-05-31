# miru PDF Continuous-Scroll View Mode

> Owner: UX-Sunna.
> Status: interaction spec for task #109, the "scrolling PDF view" follow-up to task #108.
> Sequence: this spec -> TL implementation PR -> QA independent review.

This spec builds on the merged task #108 state in `PdfViewer.vue`, commit `27d1340`:

- Bounded visible scroll viewport: `.pdf-viewer__stage` uses `block-size: min(68vh, 52rem)`, `overflow: auto`, and `overscroll-behavior: contain`.
- Top toolbar: previous page, page jump, next page, zoom mode, and zoom buttons.
- Desktop side buttons in paged mode.
- Arrow-left / Arrow-right keyboard paging with text-input focus guards.

Goal: add continuous scroll as an explicit PDF view mode. Paginated mode remains the default. The viewer stays quiet and reading-first, and the privacy posture must not change: miru must not extract PDF text or upload PDF content.

## 1. View Mode Toggle

- Add a two-segment toggle in the top toolbar: `翻页` / `滚动`.
- `翻页` is the default mode.
- Place the toggle as its own control group, either left of zoom or right of the page controls.
- Reuse the existing `aria-pressed` segmented-button pattern used by `适宽` / `整页`.
- Persist view mode with the PDF reading position, alongside scale mode and page number.
- Extend `PdfReadingPosition` with `viewMode: 'paged' | 'scroll'`.
- Switching mode preserves the current page:
  - paged page N -> scroll mode scrolled to page N.
  - scroll mode current page N -> paged page N.
- The toggle must be keyboard focusable and have clear labels.

## 2. Continuous Rendering

- Pages stack vertically inside the same bounded stage viewport from task #108.
- Keep the paginated page look: white page on warm stage background with subtle shadow.
- Add a quiet gap and separator between pages.
- Do not add heavy page chrome.

Virtualization is required for long PDFs:

- Render only visible pages plus a small buffer, approximately two pages before and after the visible range.
- Off-screen pages use correctly sized placeholder boxes so total scroll height and scrollbar position stay stable.
- Swap canvases in and out through an `IntersectionObserver`.
- Reuse the existing render-cancel and render-sequence safety patterns.
- A page currently rendering shows a light `渲染中...` placeholder inside its correctly sized box.
- Rendering must not cause layout jumps or white flashes.
- Only buffered pages may hold canvases; placeholders must remain cheap.

Zoom applies uniformly to all pages:

- `适宽`, `整页`, and custom scale apply to the full stacked document.
- Changing zoom reflows the stack and keeps the current page in view.
- Use the current page as the scroll anchor when scale changes.

## 3. Current Page Sync

- Current page is the page most in view.
- Recommended heuristics:
  - page with the largest visible area, or
  - page whose top has crossed the viewport upper third.
- Debounce current-page updates while scrolling.
- Update the toolbar page indicator `N / total`.
- Persist the current page in the reading position.
- The page jump input scrolls to the requested page top.
- Page jump is smooth by default and instant under `prefers-reduced-motion`.
- The page indicator stays live in both paged and scroll modes.

## 4. Side Buttons In Scroll Mode

In paged mode, side buttons go to the previous or next page through a render swap.

In scroll mode, keep the side buttons and repurpose them to scroll to the previous or next page top:

- Same visual treatment and position as task #108.
- Vertically centered in the visible stage viewport.
- Remain in the gutter and must not cover the canvas.
- Baseline opacity, hover reveal, 44 x 54 px hit target.
- Hidden at `<=900px`, same as task #108.
- First and last page states are disabled.
- Semantics stay consistent across modes: go to the adjacent page.

Fallback:

- If scroll-to-page-top stepping feels rough or janky, hide side buttons in scroll mode.
- In that fallback, natural scrolling and the top page jump remain the navigation paths.

PM decision for task #109: start with side buttons preserved in scroll mode. Hide them only if implementation feel requires the fallback.

## 5. Keyboard And Accessibility

- In scroll mode, ArrowLeft / ArrowRight scroll to previous / next page top.
- Keep the existing focus guard:
  - do not hijack arrow keys while focus is inside page-jump input, text inputs, selects, textareas, or contenteditable elements.
- Announce current page changes through the existing `aria-live` page indicator.
- The view-mode toggle and all controls must be keyboard reachable.
- Focus-visible treatment should match the existing PDF controls.
- Under `prefers-reduced-motion`, page-jump and side-button page movement are instant rather than smooth.

## 6. Mobile

- Continuous scroll is expected to work naturally on touch devices.
- Keep side buttons hidden at `<=900px`.
- Keep the view-mode toggle available in the mobile toolbar.
- Keep `overscroll-behavior: contain` on the bounded stage.
- Verify touch scrolling does not create a double-scroll trap between the stage and the outer page.

## 7. Acceptance Gates

UX acceptance:

- Paged mode remains the default.
- Switching modes preserves the current page.
- Scroll mode feels natural inside the bounded stage.
- Current-page tracking is accurate enough for reading, within roughly one page of the visually dominant page.
- Side buttons in scroll mode feel like precise adjacent-page navigation; if they do not, hide them in scroll mode and keep the top page jump as the precision control.
- Mobile scroll remains comfortable and side buttons stay hidden.

Technical acceptance:

- Long PDFs use bounded memory through virtualization.
- Only visible pages plus the buffer are rendered as canvases.
- Placeholder dimensions are correct and keep scroll height stable.
- Render tasks are cancelable and do not race stale pages into view.
- Scale changes keep the current page anchored.
- Reopening a PDF restores view mode and position.

QA acceptance:

- Mode persistence works across reopen.
- Mode switching maps paged page N to scroll page N and back.
- Page jump input scrolls to the expected page.
- Current page sync updates the toolbar and saved position.
- ArrowLeft / ArrowRight work in both modes and respect the focus guard.
- `<=900px` hides side buttons and does not cover content.
- Long-PDF performance is bounded and does not render every page canvas.
- No privacy regression: miru still does not extract PDF text, upload PDF content, or introduce non-site network hosts.
- Accessibility parity with paged mode is preserved.

## 8. Out Of Scope

- No change to PDF import.
- No change to the library model beyond `PdfReadingPosition.viewMode`.
- No PDF text extraction.
- No PDF upload.
- No OCR.
- No annotation or outline features.
- No change to reading-token or non-PDF reader surfaces.
