import { expect, test } from '@playwright/test'
import { createSimplePdfBuffer, openFileThroughFloatingMenu } from './support/documentInputs'
import {
  isWideViewport,
  openBookshelfEntry,
  readReadingProgressPercent,
} from './support/reader'

interface PdfLoadRaceProbe {
  events: string[]
  release: () => void
  workerStarts: number
}

type PdfLoadRaceWindow = Window & {
  __miruPdfLoadRaceProbe: PdfLoadRaceProbe
}

test('adds a local PDF and reopens it through the view-only PDF viewer', async ({ page }) => {
  const pdfWorkerResponses: Array<{ contentType: string | undefined, status: number, url: string }> = []
  page.on('response', (response) => {
    if (!response.url().includes('pdf.worker')) {
      return
    }

    pdfWorkerResponses.push({
      contentType: response.headers()['content-type'],
      status: response.status(),
      url: response.url(),
    })
  })

  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'Daily Paper.pdf',
    mimeType: 'application/octet-stream',
    buffer: createSimplePdfBuffer(['Daily Paper alpha headline Daily summary', 'Daily Paper page two']),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Daily Paper' })).toBeVisible()
  await expect(page.getByText('PDF 保持原样显示; 只有使用搜索时才在浏览器内读取文本层, 不上传。')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer-canvas')).toBeVisible()
  await expect(page.getByText('1 / 2')).toBeVisible()
  const initialProgress = await readReadingProgressPercent(page)
  expect(initialProgress).toBeGreaterThanOrEqual(45)

  await page.getByTestId('floating-affordance-button').click()
  await page.getByTestId('floating-affordance-menu').getByRole('button', { name: /搜索 Cmd\/Ctrl\+F/ }).click()
  await expect(page.getByTestId('reader-find-bar')).toBeVisible()
  await page.getByTestId('reader-find-input').fill('Daily')
  await expect(page.getByTestId('reader-find-counter')).toContainText('1 / 3')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 1 页')
  await expect(page.locator('.pdf-viewer__search-match')).toHaveCount(2)
  await expect.poll(async () => {
    return page.evaluate(() => {
      const marker = document.querySelector('.pdf-viewer__search-match')
      const textRun = document.querySelector('.pdf-viewer__text-layer span[data-pdf-text-index]')
      const markerWidth = marker?.getBoundingClientRect().width ?? 0
      const textRunWidth = textRun?.getBoundingClientRect().width ?? 0

      return textRunWidth > 0 ? markerWidth / textRunWidth : 1
    })
  }).toBeLessThan(0.55)
  const initialMarker = await page.locator('.pdf-viewer__search-match--active').elementHandle()
  expect(initialMarker).not.toBeNull()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('reader-find-counter')).toContainText('2 / 3')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 1 页')
  expect(await initialMarker?.evaluate(marker => marker.isConnected)).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('reader-find-counter')).toContainText('3 / 3')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 2 页')
  await expect(page.getByTestId('pdf-viewer').getByText('2 / 2')).toBeVisible()
  await page.keyboard.press('Shift+Enter')
  await expect(page.getByTestId('reader-find-counter')).toContainText('2 / 3')
  await expect(page.getByTestId('pdf-viewer').getByText('1 / 2')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reader-find-bar')).toHaveCount(0)

  await page.getByTestId('floating-affordance-button').click()
  await page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^书签此处/ }).click()
  await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  await page.getByTestId('reader-outline-button').click()
  await expect(page.getByRole('button', { name: /第 1 页 PDF 第 1 页/ })).toBeVisible()
  await page.keyboard.press('Escape')

  if (isWideViewport(page)) {
    await expect(page.getByTestId('pdf-viewer-side-prev')).toBeDisabled()
    await expect(page.getByTestId('pdf-viewer-side-next')).toBeEnabled()
    const sideButtonRects = await page.locator('.pdf-viewer__side-page-button').evaluateAll(buttons =>
      buttons.map(button => button.getBoundingClientRect()).map(rect => ({
        bottom: rect.bottom,
        height: rect.height,
        top: rect.top,
        width: rect.width,
      })),
    )
    const stageRect = await page.getByTestId('pdf-viewer-stage').evaluate((stage) => {
      const rect = stage.getBoundingClientRect()
      return {
        bottom: rect.bottom,
        height: rect.height,
        top: rect.top,
      }
    })
    const canvasRect = await page.getByTestId('pdf-viewer-canvas').evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect()
      return {
        bottom: rect.bottom,
        top: rect.top,
      }
    })
    const visibleCanvasCenter = (Math.max(canvasRect.top, stageRect.top) + Math.min(canvasRect.bottom, stageRect.bottom)) / 2
    expect(sideButtonRects).toHaveLength(2)
    for (const rect of sideButtonRects) {
      expect(rect.width).toBeCloseTo(44, 0)
      expect(rect.height).toBeCloseTo(44, 0)
      expect(rect.top).toBeGreaterThanOrEqual(stageRect.top)
      expect(rect.bottom).toBeLessThanOrEqual(stageRect.bottom)
      expect(Math.abs((rect.top + rect.height / 2) - visibleCanvasCenter)).toBeLessThanOrEqual(2)
    }
    const sideIconRects = await page.locator('.pdf-viewer__side-page-icon').evaluateAll(icons =>
      icons.map((icon) => {
        const iconRect = icon.getBoundingClientRect()
        const buttonRect = icon.closest('button')?.getBoundingClientRect()
        return {
          buttonCenterX: buttonRect ? buttonRect.left + buttonRect.width / 2 : 0,
          buttonCenterY: buttonRect ? buttonRect.top + buttonRect.height / 2 : 0,
          iconCenterX: iconRect.left + iconRect.width / 2,
          iconCenterY: iconRect.top + iconRect.height / 2,
        }
      }),
    )
    for (const rect of sideIconRects) {
      expect(Math.abs(rect.iconCenterX - rect.buttonCenterX)).toBeLessThanOrEqual(1)
      expect(Math.abs(rect.iconCenterY - rect.buttonCenterY)).toBeLessThanOrEqual(1)
    }
    await expect.poll(() => page.getByTestId('pdf-viewer-stage').evaluate(stage => getComputedStyle(stage).overflowX)).toBe('hidden')
    await page.getByTestId('pdf-viewer-side-next').click()
    await expect(page.getByTestId('pdf-viewer-side-prev')).toBeEnabled()
    await expect(page.getByTestId('pdf-viewer-side-next')).toBeDisabled()
  }
  else {
    await expect(page.getByTestId('pdf-viewer-side-prev')).toBeHidden()
    await expect(page.getByTestId('pdf-viewer-side-next')).toBeHidden()
    await page.locator('.pdf-viewer__toolbar button[aria-label="下一页"]').click()
  }
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect.poll(() => readReadingProgressPercent(page)).toBeGreaterThan(initialProgress)
  await page.getByLabel('跳转页码').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('2 / 2')).toBeVisible()
  await page.getByTestId('pdf-viewer').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 2')).toBeVisible()
  await expect(page.getByLabel('跳转页码')).toHaveValue('1')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByLabel('跳转页码')).toHaveValue('2')
  const toolbarButtonRects = await page.locator('.pdf-viewer__toolbar button').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect()).map(rect => ({
      height: rect.height,
      width: rect.width,
    })),
  )
  expect(toolbarButtonRects.length).toBeGreaterThan(0)
  if (isWideViewport(page)) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }))
    const stickyRects = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="app-top-bar"]')?.getBoundingClientRect()
      const toolbar = document.querySelector('.pdf-viewer__toolbar')?.getBoundingClientRect()
      return {
        headerBottom: header?.bottom ?? 0,
        toolbarTop: toolbar?.top ?? 0,
      }
    })
    expect(stickyRects.toolbarTop - stickyRects.headerBottom).toBeGreaterThanOrEqual(8)
  }
  for (const rect of toolbarButtonRects) {
    expect(rect.width).toBeGreaterThanOrEqual(44)
    expect(rect.height).toBeGreaterThanOrEqual(44)
  }
  await expect.poll(() => pdfWorkerResponses.some(response =>
    response.status === 200 && response.contentType?.includes('javascript'),
  )).toBe(true)

  await page.getByRole('button', { name: '← 文库' }).click()

  const entry = page.getByTestId('library-entry').filter({ hasText: 'Daily Paper' })
  await expect(entry).toContainText('PDF')
  await expect(entry).toContainText('文件 · Daily Paper.pdf')

  await openBookshelfEntry(entry, 'Daily Paper')

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer')).toBeFocused()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.locator('.reader-surface')).toHaveCount(0)
})

test('keeps the latest PDF active when an earlier viewer load finishes later', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The load generation is independent of responsive layout')

  const slowPdf = createSimplePdfBuffer(['Slow A page one', 'Slow A page two', 'Slow A page three'])
  const fastPdf = createSimplePdfBuffer(['Fast B page one', 'Fast B page two'])

  await page.addInitScript(({ slowPdfSize }) => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer
    const NativeWorker = window.Worker
    const events: string[] = []
    let matchingReadCount = 0
    let releaseBlockedRead: (() => void) | undefined
    let workerStarts = 0
    const blockedRead = new Promise<void>((resolve) => {
      releaseBlockedRead = resolve
    })

    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: new Proxy(NativeWorker, {
        construct(target, argumentsList, newTarget) {
          workerStarts += 1
          return Reflect.construct(target, argumentsList, newTarget)
        },
      }),
      writable: true,
    })

    Object.defineProperty(window, '__miruPdfLoadRaceProbe', {
      configurable: true,
      value: {
        events,
        release: () => releaseBlockedRead?.(),
        get workerStarts() {
          return workerStarts
        },
      } satisfies PdfLoadRaceProbe,
    })

    Blob.prototype.arrayBuffer = async function () {
      const matchingRead = this.size === slowPdfSize ? ++matchingReadCount : 0
      events.push(`start:${this.size}:${matchingRead}`)
      const result = await originalArrayBuffer.call(this)

      if (matchingRead === 2) {
        events.push('blocked:slow-viewer')
        await blockedRead
        events.push('released:slow-viewer')
      }

      events.push(`finish:${this.size}:${matchingRead}`)
      return result
    }
  }, { slowPdfSize: slowPdf.byteLength })

  await page.goto('/')
  await openFileThroughFloatingMenu(page, {
    name: 'Slow A.pdf',
    mimeType: 'application/pdf',
    buffer: slowPdf,
  })
  await page.waitForFunction(() =>
    (window as PdfLoadRaceWindow).__miruPdfLoadRaceProbe.events.includes('blocked:slow-viewer'),
  )
  await expect(page.getByRole('heading', { name: 'Slow A' })).toBeVisible()

  await openFileThroughFloatingMenu(page, {
    name: 'Fast B.pdf',
    mimeType: 'application/pdf',
    buffer: fastPdf,
  })

  const viewer = page.getByTestId('pdf-viewer')
  await expect(page.getByRole('heading', { name: 'Fast B' })).toBeVisible()
  await expect(viewer.getByText('1 / 2')).toBeVisible()
  const currentWorkerStarts = await page.evaluate(() =>
    (window as PdfLoadRaceWindow).__miruPdfLoadRaceProbe.workerStarts,
  )
  expect(currentWorkerStarts).toBeGreaterThan(0)

  await page.evaluate(() => (window as PdfLoadRaceWindow).__miruPdfLoadRaceProbe.release())
  await page.waitForFunction(({ slowPdfSize }) =>
    (window as PdfLoadRaceWindow).__miruPdfLoadRaceProbe.events.includes(`finish:${slowPdfSize}:2`),
  { slowPdfSize: slowPdf.byteLength })
  await page.evaluate(() => new Promise<void>(resolve => window.setTimeout(resolve, 0)))

  await expect(page.getByRole('heading', { name: 'Fast B' })).toBeVisible()
  await expect(viewer.getByText('1 / 2')).toBeVisible()
  await expect(viewer.getByText('1 / 3')).toHaveCount(0)
  expect(await page.evaluate(() =>
    (window as PdfLoadRaceWindow).__miruPdfLoadRaceProbe.workerStarts,
  )).toBe(currentWorkerStarts)
})

test('normalizes PDF page input on submit and blur', async ({ page }) => {
  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'Page Input.pdf',
    mimeType: 'application/pdf',
    buffer: createSimplePdfBuffer(['Page one', 'Page two', 'Page three']),
  })

  const pageInput = page.getByLabel('跳转页码')
  const viewer = page.getByTestId('pdf-viewer')
  await expect(pageInput).toHaveValue('1')
  await expect(viewer.getByText('1 / 3')).toBeVisible()

  await pageInput.fill('2')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('2')
  await expect(viewer.getByText('2 / 3')).toBeVisible()

  await pageInput.fill('')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('2')
  await expect(viewer.getByText('2 / 3')).toBeVisible()

  await pageInput.fill('99')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('3')
  await expect(viewer.getByText('3 / 3')).toBeVisible()

  await pageInput.fill('')
  await viewer.focus()
  await expect(pageInput).toHaveValue('3')
  await expect(viewer.getByText('3 / 3')).toBeVisible()

  await pageInput.fill('0')
  await viewer.focus()
  await expect(pageInput).toHaveValue('1')
  await expect(viewer.getByText('1 / 3')).toBeVisible()
})

test('preserves PDF toolbar layout across its responsive breakpoint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Responsive breakpoint only needs one browser pass')

  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'Tablet Toolbar.pdf',
    mimeType: 'application/pdf',
    buffer: createSimplePdfBuffer(['Tablet toolbar layout']),
  })

  const toolbar = page.locator('.pdf-viewer__toolbar')
  await expect(toolbar).toBeVisible()
  await expect.poll(() => toolbar.evaluate(element => getComputedStyle(element).position)).toBe('sticky')

  await page.setViewportSize({ width: 700, height: 900 })
  const compactLayout = await toolbar.evaluate((element) => {
    const controlGroupTops = Array.from(element.querySelectorAll('.pdf-viewer__control-group'))
      .map(group => Math.round(group.getBoundingClientRect().top))

    return {
      controlGroupTops,
      position: getComputedStyle(element).position,
    }
  })

  expect(compactLayout.position).toBe('static')
  expect(new Set(compactLayout.controlGroupTops).size).toBe(3)
})

test('supports continuous scroll mode for local PDFs with bounded rendered pages', async ({ page }) => {
  const pageCount = 120
  const maxMountedPageCount = 12
  const maxRenderedPageCount = 12
  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'Long Paper.pdf',
    mimeType: 'application/pdf',
    buffer: createSimplePdfBuffer(Array.from({ length: pageCount }, (_, index) => {
      const text = index === 0
        ? 'Long Paper first-page-marker'
        : index === 116
          ? 'Long Paper distant-page-marker'
          : `Long Paper page ${index + 1}`

      if (index === 0) {
        return { text }
      }
      return index === 116
        ? { height: 612, text, width: 792 }
        : { text }
    })),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByText(`1 / ${pageCount}`)).toBeVisible()

  await page.getByRole('button', { name: '滚动' }).click()
  await expect(page.getByRole('button', { name: '滚动' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('pdf-viewer-scroll-stack')).toBeVisible()
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-page').count()).toBeGreaterThan(0)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-page').count()).toBeLessThanOrEqual(maxMountedPageCount)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeGreaterThan(0)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeLessThanOrEqual(maxRenderedPageCount)

  const stage = page.getByTestId('pdf-viewer-stage')
  await expect.poll(() => stage.evaluate(element => element.scrollHeight / element.clientHeight)).toBeGreaterThan(50)
  await page.keyboard.press('Control+F')
  await page.getByTestId('reader-find-input').fill('first-page-marker')
  await expect(page.getByTestId('reader-find-counter')).toContainText('1 / 1')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 1 页')
  await expect(page.getByTestId('reader-find-counter')).toContainText('已读取')
  await expect.poll(async () => page.locator('.pdf-viewer__search-match--active').count()).toBeGreaterThan(0)
  await expect.poll(async () => page.getByTestId('pdf-viewer-scroll-text-layer').locator('span[data-pdf-text-index]').count()).toBeGreaterThan(0)

  await page.getByTestId('reader-find-input').fill('distant-page-marker')
  await expect(page.getByTestId('reader-find-counter')).toContainText('1 / 1')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 117 页')
  await expect(page.getByText(`117 / ${pageCount}`)).toBeVisible()
  await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('[data-page-number="117"]')).toHaveAttribute('aria-posinset', '117')
  await expect(page.locator('[data-page-number="117"]')).toHaveAttribute('aria-setsize', String(pageCount))
  const distantPageSize = await page.locator('[data-page-number="117"]').evaluate((element) => {
    const canvas = element.querySelector('canvas')
    const pageRect = element.getBoundingClientRect()
    const stageRect = element.closest('[data-testid="pdf-viewer-stage"]')?.getBoundingClientRect()
    return {
      canvasHeight: canvas?.getBoundingClientRect().height ?? 0,
      canvasWidth: canvas?.getBoundingClientRect().width ?? 0,
      pageLeft: pageRect.left,
      pageRight: pageRect.right,
      stageLeft: stageRect?.left ?? 0,
      stageRight: stageRect?.right ?? 0,
    }
  })
  expect(distantPageSize.canvasWidth).toBeGreaterThan(distantPageSize.canvasHeight)
  expect(distantPageSize.pageLeft).toBeGreaterThanOrEqual(distantPageSize.stageLeft - 1)
  expect(distantPageSize.pageRight).toBeLessThanOrEqual(distantPageSize.stageRight + 1)
  const expectedZoomPercent = Math.round(Number((distantPageSize.canvasWidth / 792 + 0.15).toFixed(2)) * 100)
  await page.getByRole('button', { name: '放大' }).click()
  await expect(page.locator('.pdf-viewer__zoom-label')).toHaveText(`${expectedZoomPercent}%`)
  await expect(page.locator('[data-page-number="117"]')).toBeVisible()
  await expect.poll(async () => page.locator('.pdf-viewer__search-match--active').count()).toBeGreaterThan(0)
  await page.getByRole('button', { name: '适宽', exact: true }).click()
  await expect(page.getByRole('button', { name: '适宽', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-page-number="117"]')).toBeVisible()
  await expect.poll(async () => page.locator('.pdf-viewer__search-match--active').count()).toBeGreaterThan(0)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-page').count()).toBeLessThanOrEqual(maxMountedPageCount)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeLessThanOrEqual(maxRenderedPageCount)
  await expect.poll(async () => page.locator('.pdf-viewer__search-match--active').count()).toBeGreaterThan(0)
  expect(await readReadingProgressPercent(page)).toBeGreaterThan(80)
  await page.keyboard.press('Escape')

  await page.getByLabel('跳转页码').fill('116')
  await page.keyboard.press('Enter')
  await expect(page.getByText(`116 / ${pageCount}`)).toBeVisible()
  await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeLessThanOrEqual(maxRenderedPageCount)

  await stage.evaluate((element) => {
    element.scrollTo({ top: 0, behavior: 'auto' })
    element.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(() => stage.evaluate(element => Math.round(element.scrollTop))).toBeLessThanOrEqual(8)
  await expect(page.getByText(`1 / ${pageCount}`)).toBeVisible()
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('aria-posinset', '1')
  expect(await readReadingProgressPercent(page)).toBeLessThan(10)
  const firstCanvasSizeAfterReturn = await page
    .locator('[data-page-number="1"]')
    .locator('canvas')
    .evaluate(canvas => ({
      blockSize: (canvas as HTMLCanvasElement).style.blockSize,
      height: (canvas as HTMLCanvasElement).height,
      inlineSize: (canvas as HTMLCanvasElement).style.inlineSize,
      width: (canvas as HTMLCanvasElement).width,
    }))
  expect(firstCanvasSizeAfterReturn.width).toBeGreaterThan(300)
  expect(firstCanvasSizeAfterReturn.height).toBeGreaterThan(300)
  expect(firstCanvasSizeAfterReturn.inlineSize).not.toBe('')
  expect(firstCanvasSizeAfterReturn.blockSize).not.toBe('')

  let expectedPage = `116 / ${pageCount}`
  await page.getByLabel('跳转页码').fill('116')
  await page.keyboard.press('Enter')
  await expect(page.getByText(expectedPage)).toBeVisible()
  if (isWideViewport(page)) {
    await page.getByTestId('pdf-viewer-side-next').click()
    expectedPage = `117 / ${pageCount}`
    await expect(page.getByText(expectedPage)).toBeVisible()
  }

  await page.getByRole('button', { name: '← 文库' }).click()
  const entry = page.getByTestId('library-entry').filter({ hasText: 'Long Paper' })
  await openBookshelfEntry(entry, 'Long Paper')

  await expect(page.getByTestId('pdf-viewer-scroll-stack')).toBeVisible()
  await expect(page.getByRole('button', { name: '滚动' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(expectedPage)).toBeVisible()

  await page.getByRole('button', { name: '翻页' }).click()
  await expect(page.getByTestId('pdf-viewer-canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: '翻页' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(expectedPage)).toBeVisible()
})

test('reports local PDFs without searchable text instead of showing a silent zero result', async ({ page }) => {
  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'Scanned.pdf',
    mimeType: 'application/pdf',
    buffer: createSimplePdfBuffer(''),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await page.keyboard.press('Control+F')
  await page.getByTestId('reader-find-input').fill('alpha')

  await expect(page.getByTestId('reader-find-counter')).toContainText('无可搜索文本')
  await expect(page.locator('.app-shell__live-status')).toContainText('此 PDF 没有可搜索的文本')
})

test('shows a recoverable error for malformed local PDFs', async ({ page }) => {
  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a real pdf'),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByText('这个 PDF 打不开。文件可能已损坏, 或浏览器无法解析它。')).toBeVisible()
  await expect(page.getByRole('button', { name: '再试一次' })).toBeVisible()
})
