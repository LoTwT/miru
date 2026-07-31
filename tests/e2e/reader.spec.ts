import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const fetchedMarkdown = '# Remote doc\n\nLoaded from URL.'

test('renders the sample document and supports paste input', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
  await expect(page.locator('.reader-surface__content h1')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '输入方式', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '排版与阅读', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '行内元素', level: 3 })).toBeVisible()
  await expect(page.getByText('顶部 ⋯ 菜单').first()).toBeVisible()
  await expect(page.getByTestId('floating-affordance-button')).toBeVisible()

  const listPresentation = await page.locator('.reader-surface__content ul:not(.contains-task-list)').first().evaluate((list) => {
    const style = getComputedStyle(list)
    return {
      listStyleType: style.listStyleType,
      paddingInlineStart: Number.parseFloat(style.paddingInlineStart),
    }
  })
  expect(listPresentation.listStyleType).toBe('disc')
  expect(listPresentation.paddingInlineStart).toBeGreaterThan(0)

  await page.evaluate(() => {
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
    event.clipboardData?.setData('text/plain', [
      '# Pasted doc',
      '',
      'Hello **miru**.',
      '',
      '#### Fourth level',
      '',
      '##### Fifth level',
      '',
      '###### Sixth level',
    ].join('\n'))
    document.querySelector('main')?.dispatchEvent(event)
  })

  await expect(page.getByRole('heading', { name: 'Pasted doc' })).toBeVisible()
  await expect(page.getByText('Hello miru.')).toBeVisible()

  const deepHeadingSizes = await page.locator('.reader-surface__content :is(h4, h5, h6)').evaluateAll(headings =>
    headings.map(heading => Number.parseFloat(getComputedStyle(heading).fontSize)),
  )
  expect(deepHeadingSizes[0]).toBeGreaterThan(deepHeadingSizes[1] ?? 0)
  expect(deepHeadingSizes[1]).toBeGreaterThan(deepHeadingSizes[2] ?? 0)
})

test('renders the reader footer with privacy copy and safe links', async ({ page }) => {
  await page.goto('/')

  const footer = page.getByTestId('reader-footer')
  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toContainText('miru')
  await expect(footer).toContainText('文档留在本机，隐私默认')
  await expect(footer).toContainText('© 2026')
  await expect(footer.getByRole('link', { name: 'GitHub' })).toHaveAttribute('rel', 'noreferrer')
  await expect(footer.getByRole('link', { name: 'CommonMark' })).toHaveAttribute('rel', 'noreferrer')
  await expect.poll(() =>
    footer.getByRole('link', { name: 'GitHub' }).evaluate((link) => link.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44)
})

test('shows the back-to-top button only for long scrolled reader content', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('back-to-top')).toHaveCount(0)

  await pasteText(page, [
    '# Long footer test',
    '',
    Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Long footer test' })).toBeVisible()
  await page.evaluate(() => {
    window.scrollTo({
      top: window.innerHeight + 96,
      behavior: 'auto',
    })
  })
  await expect.poll(() => page.evaluate(() => window.scrollY > window.innerHeight)).toBe(true)

  const backToTop = page.getByTestId('back-to-top')
  await expect(backToTop).toBeVisible()

  await page.getByTestId('floating-affordance-button').click()
  await expect(backToTop).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(backToTop).toBeVisible()

  await backToTop.click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(24)
  await expect(page.getByTestId('back-to-top')).toHaveCount(0)
})

test('updates the quiet reading progress line for long markdown documents', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Progress doc',
    '',
    ...Array.from({ length: 8 }, (_, index) => [
      `## Section ${index + 1}`,
      '',
      Array.from({ length: 10 }, (_, paragraphIndex) => `Paragraph ${index + 1}.${paragraphIndex + 1} keeps the reader moving quietly.`).join('\n\n'),
    ].join('\n')),
  ].join('\n\n'))
  await expect(page.getByRole('heading', { name: 'Progress doc' })).toBeVisible()
  await expect(page.getByTestId('reading-progress-line')).toBeVisible()
  await expect(page.getByTestId('reading-progress-line')).toHaveAttribute('role', 'progressbar')
  await expect.poll(() => readReadingProgressPercent(page)).toBeLessThan(10)

  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })
  })
  await expect.poll(() => readReadingProgressPercent(page)).toBeGreaterThan(80)

  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline')).not.toContainText('阅读进度')
  }
})

test('shows a consistent focus ring across reader chrome controls', async ({ page }) => {
  await page.goto('/')

  const focusTokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement)
    return {
      color: styles.getPropertyValue('--reading-focus').trim(),
      shadow: styles.getPropertyValue('--reading-focus-shadow').trim(),
    }
  })
  expect(focusTokens.color).not.toBe('')
  expect(focusTokens.shadow).not.toBe('')

  await expectVisibleFocusRing(page.getByTestId('library-open-button'))
  await expectVisibleFocusRing(page.getByTestId('reading-settings-button'))
  await expectVisibleFocusRing(page.getByTestId('floating-affordance-button'))

  await page.getByTestId('reading-settings-button').click()
  await expectVisibleFocusRing(page.getByRole('button', { name: '关闭', exact: true }))
  await page.keyboard.press('Escape')

  await page.getByTestId('floating-affordance-button').click()
  await expectVisibleFocusRing(page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^搜索/ }))
})

test('searches markdown content and keeps document bookmarks in the outline surface', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Searchable note',
    '',
    'Alpha opens the first paragraph.',
    '',
    '## Chapter One',
    '',
    'Beta keeps this middle paragraph moving.',
    '',
    '## Chapter Two',
    '',
    'alpha appears again before ALPHA closes the note.',
    '',
    '## Chapter Three',
    '',
    'Gamma keeps the outline available.',
  ].join('\n\n'))
  await expect(page.getByRole('heading', { name: 'Searchable note' })).toBeVisible()

  await page.keyboard.press('Control+F')
  await expect(page.getByTestId('reader-find-bar')).toBeVisible()
  await page.getByTestId('reader-find-input').fill('alpha')
  await expect(page.locator('.reader-search-match')).toHaveCount(3)
  await expect(page.getByTestId('reader-find-counter')).toContainText('1 / 3')

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('reader-find-counter')).toContainText('2 / 3')
  await page.keyboard.press('Shift+Enter')
  await expect(page.getByTestId('reader-find-counter')).toContainText('1 / 3')

  await page.getByTestId('reader-find-input').fill('missing')
  await expect(page.getByTestId('reader-find-counter')).toContainText('无匹配')
  await expect(page.locator('.reader-search-match')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reader-find-bar')).toHaveCount(0)

  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
  }
  await page.getByRole('button', { name: /添加「Chapter Two/ }).click()
  await expect(page.getByTestId('reader-outline')).toContainText('书签')
  await expect(page.getByTestId('reader-outline')).toContainText('Chapter Two')

  await page.getByTestId('floating-affordance-button').click()
  await page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^书签此处/ }).click()
  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
  }
  await expect(page.getByTestId('reader-outline')).toContainText('Searchable note')

  await page.reload()
  await page.getByTestId('library-open-button').click()
  await openBookshelfEntry(page.getByTestId('library-entry').filter({ hasText: 'Searchable note' }), 'Searchable note')
  await expect(page.getByRole('heading', { name: 'Searchable note' })).toBeVisible()
  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
  }
  await expect(page.getByRole('button', { name: /移除「Chapter Two/ })).toBeVisible()
  await page.getByRole('button', { name: /移除「Chapter Two/ }).click()
  await expect(page.getByRole('button', { name: /添加「Chapter Two/ })).toBeVisible()
})

test('adds pasted markdown to the local library and reopens it from the bookshelf', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, '# Library doc\n\nSaved locally.')
  await expect(page.getByRole('heading', { name: 'Library doc' })).toBeVisible()
  const readerHeaderHeight = await readTopBarHeight(page)

  await page.getByTestId('library-open-button').click()
  await expect(page.getByTestId('library-view')).toBeVisible()
  await expect.poll(() => readTopBarHeight(page)).toBe(readerHeaderHeight)
  await expect(page.getByTestId('reading-settings-button')).toBeVisible()
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByText('字号').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('字号').first()).toHaveCount(0)

  const entry = page.getByTestId('library-entry').filter({ hasText: 'Library doc' })
  await expect(entry).toContainText('粘贴')
  await expect(entry).toContainText('MD')

  await page.getByTestId('library-sample-entry').getByRole('button', { name: 'miru 示例文档' }).click()
  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
  await page.getByTestId('library-open-button').click()
  await expect.poll(() => readTopBarHeight(page)).toBe(readerHeaderHeight)

  await openBookshelfEntry(entry, 'Library doc')

  await expect(page.getByRole('heading', { name: 'Library doc' })).toBeVisible()
  await expect(page.getByText('Saved locally.')).toBeVisible()
  await expect(page.locator('.reader-surface')).toBeFocused()
})

test('renames, pins, and deletes local library markdown entries from the bookshelf', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, '# First note\n\nOne.')
  await pasteText(page, '# Second note\n\nTwo.')
  await page.getByTestId('library-open-button').click()

  const secondEntry = page.getByTestId('library-entry').filter({ hasText: 'Second note' })
  await chooseBookshelfAction(secondEntry, 'Second note', '置顶')
  await expect(page.getByRole('heading', { name: '置顶' })).toBeVisible()
  await expect(page.locator('#library-pinned-title + .library-view__list').getByText('Second note')).toBeVisible()

  await chooseBookshelfAction(secondEntry, 'Second note', '重命名')
  await page.getByLabel('重命名 Second note').fill('Pinned note')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByTestId('library-entry').filter({ hasText: 'Pinned note' })).toBeVisible()

  await chooseBookshelfAction(page.getByTestId('library-entry').filter({ hasText: 'Pinned note' }), 'Pinned note', '删除')
  const dialog = page.getByRole('dialog', { name: /删除「Pinned note」/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '删除' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()

  await dialog.getByRole('button', { name: '删除' }).click()

  await expect(page.getByTestId('library-entry').filter({ hasText: 'Pinned note' })).toHaveCount(0)
  await expect(page.getByTestId('library-entry').filter({ hasText: 'First note' })).toBeVisible()
  await expect(page.getByTestId('library-view')).toBeFocused()
})

test.describe('mobile local library bookshelf', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps secondary entry actions in an overflow menu', async ({ page }) => {
    await page.goto('/')

    await pasteText(page, '# Mobile shelf\n\nOne quiet row.')
    await page.getByTestId('library-open-button').click()

    const entry = page.getByTestId('library-entry').filter({ hasText: 'Mobile shelf' })
    await expect(entry.getByRole('button', { name: '打开' })).toHaveCount(0)
    await expect(entry.getByRole('button', { name: '置顶' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '返回阅读' })).toHaveCount(1)

    await entry.getByRole('button', { name: 'Mobile shelf 更多操作' }).click()
    await expect(entry.getByRole('menu')).toBeVisible()

    await page.touchscreen.tap(24, 24)
    await expect(entry.getByRole('menu')).not.toBeVisible()

    await entry.getByRole('button', { name: 'Mobile shelf 更多操作' }).click()
    await expect(entry.getByRole('menu')).toBeVisible()
    await entry.getByRole('menuitem', { name: '置顶' }).click()

    await expect(page.getByRole('heading', { name: '置顶' })).toBeVisible()
    await page.getByRole('button', { name: 'Mobile shelf', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Mobile shelf' })).toBeVisible()
    await expect(page.getByText('One quiet row.')).toBeVisible()
  })
})

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
    buffer: createSimplePdfBuffer(['Daily Paper alpha headline', 'Daily Paper page two']),
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
  await expect(page.getByTestId('reader-find-counter')).toContainText('1 / 2')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 1 页')
  await expect(page.locator('.pdf-viewer__search-match')).toHaveCount(1)
  await expect.poll(async () => {
    return page.evaluate(() => {
      const marker = document.querySelector('.pdf-viewer__search-match')
      const textRun = document.querySelector('.pdf-viewer__text-layer span[data-pdf-text-index]')
      const markerWidth = marker?.getBoundingClientRect().width ?? 0
      const textRunWidth = textRun?.getBoundingClientRect().width ?? 0

      return textRunWidth > 0 ? markerWidth / textRunWidth : 1
    })
  }).toBeLessThan(0.55)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('reader-find-counter')).toContainText('2 / 2')
  await expect(page.getByTestId('reader-find-counter')).toContainText('第 2 页')
  await expect(page.getByTestId('pdf-viewer').getByText('2 / 2')).toBeVisible()
  await page.keyboard.press('Shift+Enter')
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

test('restores local library markdown scroll position when reopening a document', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Long local doc',
    '',
    Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Long local doc' })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800)
  await page.waitForTimeout(600)

  await page.getByTestId('floating-affordance-button').click()
  await page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^文库/ }).click()
  await openBookshelfEntry(page.getByTestId('library-entry').filter({ hasText: 'Long local doc' }), 'Long local doc')

  await expect(page.getByRole('heading', { name: 'Long local doc' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800)
})

test('prints a clean full document without app chrome', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First paragraph with an [external reference](https://example.com/resource).',
    '',
    '```ts',
    'const message = "print";',
    'console.log(message);',
    '```',
    '',
    '## Nested topic',
    '',
    'Collapsed body.',
    '',
    '# Second section',
    '',
    '| A | B |',
    '|---|---|',
    '| One | Two |',
    '',
    '# Third section',
    '',
    '> Quote to keep together.',
    '',
    '# Fourth section',
    '',
    'Final body.',
  ].join('\n'))

  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  await firstToggle.click()
  await expect(page.getByText('Collapsed body.')).not.toBeVisible()
  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline')).toBeVisible()
  }
  else {
    await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  }

  await page.emulateMedia({ media: 'print' })

  await expect(page.getByText('Collapsed body.')).toBeVisible()
  await expect(page.getByTestId('floating-affordance')).not.toBeVisible()
  await expect(page.getByTestId('reading-settings')).not.toBeVisible()
  await expect(page.getByTestId('reader-outline')).not.toBeVisible()
  await expect(page.locator('.app-shell__header')).not.toBeVisible()
  await expect(page.locator('.reader-footer__links')).not.toBeVisible()
  await expect(page.getByText('文档留在本机，隐私默认')).toBeVisible()

  await expect.poll(() =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--reading-bg').trim()),
  ).toMatch(/^#fff(?:fff)?$/)
  await expect.poll(() =>
    page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
  ).toBe('light')

  const linkAfter = await page
    .locator('.reader-surface__content a[href="https://example.com/resource"]')
    .evaluate(element => getComputedStyle(element, '::after').content)
  expect(linkAfter).toContain('https://example.com/resource')

  await expect.poll(() =>
    page.locator('.reader-surface__content pre').evaluate(element => getComputedStyle(element).whiteSpace),
  ).toBe('pre-wrap')
  await expect.poll(() =>
    page.locator('.reader-surface__content table').evaluate(element => getComputedStyle(element).breakInside),
  ).toBe('avoid')
})

test('exposes document input through the top-bar command surface', async ({ page }) => {
  await page.goto('/')

  const button = page.getByTestId('floating-affordance-button')
  const topBarRect = await page.getByTestId('app-top-bar').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width }
  })
  const headerMark = page.locator('.app-shell__mark')
  await expect(headerMark).toContainText('miru')
  await expect(headerMark).not.toHaveAttribute('role')
  await expect(page.getByRole('button', { name: '回到当前阅读' })).toHaveCount(0)
  const markRect = await headerMark.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      cursor: getComputedStyle(element).cursor,
      tagName: element.tagName,
      width: rect.width,
    }
  })
  expect(markRect.tagName).toBe('DIV')
  expect(markRect.cursor).toBe('auto')

  if (isWideViewport(page)) {
    expect(markRect.width).toBeLessThan(topBarRect.width * 0.45)
  }

  await button.click()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByRole('button', { name: /搜索/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /书签此处/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /打开文件/ })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^文库/ })).toBeVisible()
  await expect(page.getByLabel('URL 导入')).toBeVisible()
  await expect(page.getByRole('button', { name: /清空当前.*回到示例文档.*不影响文库/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /打印/ })).toBeVisible()
  await expect(page.locator('input[type="file"]')).not.toHaveAttribute('accept')
  await expect(page.getByRole('button', { name: /搜索/ })).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: /书签此处/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByLabel('URL 导入')).toBeFocused()

  await page.getByRole('button', { name: /清空当前/ }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '关闭文档操作' })).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: /清空当前/ })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.click()
  await expect(page.getByRole('button', { name: /搜索/ })).toBeFocused()
  await page.mouse.click(200, 120)
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.click()
  await expect(page.getByRole('button', { name: /搜索/ })).toBeFocused()
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(page.getByTestId('reading-settings-panel')).toBeVisible()

  await button.click()
  await expect(page.getByTestId('reading-settings-panel')).not.toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()

  await button.click()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.evaluate(element => (element as HTMLElement).blur())
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.getByTestId('app-top-bar')).toBeVisible()
})

test('collapses the floating menu and focuses the reader after URL fetch success', async ({ page }) => {
  await page.route('https://example.com/readme.md', async route => route.fulfill({
    contentType: 'text/markdown',
    body: fetchedMarkdown,
  }))

  await page.goto('/')

  const button = page.getByTestId('floating-affordance-button')

  await button.click()
  await page.getByLabel('URL').fill('https://example.com/readme.md')
  await page.getByRole('button', { name: '拉取' }).click()

  await expect(page.getByRole('heading', { name: 'Remote doc' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(page.locator('.reader-surface')).toBeFocused()

  await button.click()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByRole('button', { name: /搜索/ })).toBeFocused()
})

test('uses a clean display title for URL imports without leaking the full URL into the header or library title', async ({ page }) => {
  await page.route('https://example.com/guides/daily-note.md', async route => route.fulfill({
    contentType: 'text/markdown',
    body: 'Plain remote note without a heading.',
  }))

  await page.goto('/')

  await page.getByTestId('floating-affordance-button').click()
  await page.getByLabel('URL').fill('https://example.com/guides/daily-note.md')
  await page.getByRole('button', { name: '拉取' }).click()

  await expect(page.getByText('Plain remote note without a heading.')).toBeVisible()
  await expect(page.locator('.app-shell__document-title')).toHaveText('daily-note')
  await expect(page.locator('.reader-surface__meta')).toHaveText('daily-note')

  await page.getByTestId('library-open-button').click()
  const entry = page.getByTestId('library-entry').filter({ hasText: 'daily-note' })
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('URL · example.com')
  await expect(entry.locator('.library-entry__title-button')).toHaveText('daily-note')
  await expect(page.getByTestId('library-entry').filter({ hasText: 'https://example.com/guides/daily-note.md' })).toHaveCount(0)
})

test('prompts to update repeated URL imports and clears the library from the toolbar', async ({ page }) => {
  let fetchCount = 0
  await page.route('https://example.com/library/fresh.md', async (route) => {
    fetchCount += 1
    await route.fulfill({
      contentType: 'text/markdown',
      headers: { 'Cache-Control': 'public, max-age=3600' },
      body: fetchCount === 1
        ? '# Remote Note\n\nOld content.'
        : '# Remote Note\n\nUpdated content.',
    })
  })

  await page.goto('/')

  await page.getByTestId('floating-affordance-button').click()
  await page.getByLabel('URL').fill('https://example.com/library/fresh.md')
  await page.getByRole('button', { name: '拉取' }).click()
  await expect(page.getByRole('heading', { name: 'Remote Note' })).toBeVisible()
  await expect(page.getByText('Old content.')).toBeVisible()
  await page.getByTestId('floating-affordance-button').click()
  await page.getByRole('button', { name: '书签此处' }).click()
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('miru:reader-bookmarks:v1')
    return raw ? JSON.parse(raw).length : 0
  })).toBe(1)

  await page.getByTestId('floating-affordance-button').click()
  await page.getByLabel('URL').fill('https://example.com/library/fresh.md')
  await page.getByRole('button', { name: '拉取' }).click()

  const conflict = page.getByTestId('url-import-conflict')
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText('该链接已在文库中')
  await expect(conflict).toContainText('Remote Note')
  await expect(page.getByText('Updated content.')).toHaveCount(0)
  expect(fetchCount).toBe(2)

  await page.getByRole('button', { name: '更新到最新' }).click()
  await expect(page.getByText('Updated content.')).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('miru:reader-bookmarks:v1')
    return raw ? JSON.parse(raw).length : 0
  })).toBe(0)

  await page.getByTestId('library-open-button').click()
  await expect(page.getByTestId('library-entry').filter({ hasText: 'Remote Note' })).toHaveCount(1)
  await page.getByTestId('library-management-button').click()
  await page.getByTestId('library-clear-button').click()
  const clearDialog = page.getByRole('dialog', { name: '清空文库?' })
  await expect(clearDialog).toBeVisible()
  await expect(page.getByText('将删除全部 1 篇文档')).toBeVisible()
  await expect(page.getByText('不影响你的阅读设置、字体/主题、示例文档入口。')).toBeVisible()
  await clearDialog.getByRole('button', { name: '清空全部' }).click()

  await expect(page.getByTestId('library-entry')).toHaveCount(0)
  await expect(page.getByTestId('library-empty')).toBeVisible()
  await expect(page.getByRole('button', { name: '回到示例文档' })).toBeVisible()
})

test('auto-fetches a bare URL pasted into the reader', async ({ page }) => {
  await page.route('https://example.com/readme.md', async route => route.fulfill({
    contentType: 'text/markdown',
    body: fetchedMarkdown,
  }))

  await page.goto('/')

  await pasteText(page, 'https://example.com/readme.md')

  await expect(page.getByRole('heading', { name: 'Remote doc' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(page.locator('.reader-surface')).toBeFocused()
  await expect(page.locator('.app-shell__live-status')).toHaveText('文档已加载')
})

test('converts GitHub blob URLs to raw markdown before fetching', async ({ page }) => {
  let requestedRawUrl = ''

  await page.route('https://raw.githubusercontent.com/LoTwT/miru/main/README.md', async (route) => {
    requestedRawUrl = route.request().url()
    await route.fulfill({
      contentType: 'text/markdown',
      body: '# GitHub doc\n\nLoaded from a blob URL.',
    })
  })
  await page.route('https://github.com/LoTwT/miru/blob/main/README.md', route => route.abort('failed'))

  await page.goto('/')
  await pasteText(page, 'https://github.com/LoTwT/miru/blob/main/README.md')

  await expect(page.getByRole('heading', { name: 'GitHub doc' })).toBeVisible()
  expect(requestedRawUrl).toBe('https://raw.githubusercontent.com/LoTwT/miru/main/README.md')
  await expect(page.locator('.reader-surface__meta')).toHaveText('GitHub doc')
})

test('keeps the current document when pasted URL fetch is not markdown-readable', async ({ page }) => {
  await page.route('https://example.com/page', async route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Not markdown</title>',
  }))

  await page.goto('/')

  await pasteText(page, '# Current doc\n\nKeep reading.')
  await expect(page.getByRole('heading', { name: 'Current doc' })).toBeVisible()

  await pasteText(page, 'https://example.com/page')

  await expect(page.getByRole('heading', { name: 'Current doc' })).toBeVisible()
  await expect(page.getByText('Keep reading.')).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')
    .getByText('这个链接像网页或文件。试试它的 raw / 源文件链接，或直接粘贴 markdown。', { exact: false })).toBeVisible()
})

test('keeps the current document and explains missing URL fetches', async ({ page }) => {
  await page.route('https://example.com/missing.md', async route => route.fulfill({
    status: 404,
    contentType: 'text/plain',
    body: 'Not found',
  }))

  await page.goto('/')

  await pasteText(page, '# Current doc\n\nKeep reading.')
  await expect(page.getByRole('heading', { name: 'Current doc' })).toBeVisible()

  await pasteText(page, 'https://example.com/missing.md')

  await expect(page.getByRole('heading', { name: 'Current doc' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')
    .getByText('404 或不存在——核对一下地址。', { exact: false })).toBeVisible()
})

test('keeps the current document and explains CORS-style URL failures', async ({ page }) => {
  await page.route('https://example.com/cors.md', route => route.abort('failed'))

  await page.goto('/')

  await pasteText(page, '# Current doc\n\nKeep reading.')
  await expect(page.getByRole('heading', { name: 'Current doc' })).toBeVisible()

  await pasteText(page, 'https://example.com/cors.md')

  await expect(page.getByRole('heading', { name: 'Current doc' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')
    .getByText('该站点未开放跨域。换 raw 链接，或直接把内容粘贴进 miru。', { exact: false })).toBeVisible()
})

test('keeps URL field paste inside the URL input', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' })
  await page.goto('/')

  const button = page.getByTestId('floating-affordance-button')
  const urlInput = page.getByLabel('URL')

  await button.click()
  await urlInput.focus()
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/readme.md'))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')

  await expect(urlInput).toHaveValue('https://example.com/readme.md')
  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
})

test('collapses heading sections while preserving heading permalinks', async ({ page }) => {
  await page.goto('/')

  await page.evaluate(() => {
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
    event.clipboardData?.setData('text/plain', [
      '# First section',
      '',
      'First body.',
      '',
      '## Nested topic',
      '',
      'Nested body.',
      '',
      '# Second section',
      '',
      'Second body.',
    ].join('\n'))
    document.querySelector('main')?.dispatchEvent(event)
  })

  const firstHeading = page.getByRole('heading', { name: 'First section' })
  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  const nestedToggle = page.locator('[data-reader-heading-toggle][data-reader-heading-level="2"]').first()

  await expect(page.locator('h1#first-section a.header-anchor')).toHaveAttribute('href', '#first-section')
  await expect(page.getByRole('button', { name: '折叠「First section」章节' })).toBeVisible()
  await expect(nestedToggle).toHaveAttribute('aria-label', '折叠「Nested topic」章节')
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')

  await nestedToggle.click()

  await expect(nestedToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('Nested body.')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Second section' })).toBeVisible()

  await nestedToggle.click()
  await expect(page.getByText('Nested body.')).toBeVisible()

  await firstToggle.click()

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: '展开「First section」章节' })).toBeVisible()
  await expect(page.getByText('First body.')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nested topic' })).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Second section' })).toBeVisible()
  await expect(page.getByText('Second body.')).toBeVisible()

  await firstToggle.focus()
  await page.keyboard.press('Enter')

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('First body.')).toBeVisible()

  await page.locator('h1#first-section a.header-anchor').click()
  await expect(page).toHaveURL(/#first-section$/)
})

test('keeps heading permalinks below the sticky top bar', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Sticky anchor offset',
    '',
    Array.from({ length: 14 }, (_, index) => `Before paragraph ${index + 1}.`).join('\n\n'),
    '',
    '## Target heading',
    '',
    'Target body.',
    '',
    Array.from({ length: 40 }, (_, index) => `After paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))

  const targetHeading = page.locator('h2#target-heading')
  await targetHeading.scrollIntoViewIfNeeded()
  await targetHeading.locator('a.header-anchor').click()
  await expect(page).toHaveURL(/#target-heading$/)

  const positions = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-testid="app-top-bar"]')
    const heading = document.querySelector<HTMLElement>('h2#target-heading')

    return {
      headerBottom: header?.getBoundingClientRect().bottom ?? 0,
      headingTop: heading?.getBoundingClientRect().top ?? 0,
    }
  })

  expect(positions.headingTop).toBeGreaterThanOrEqual(positions.headerBottom + 8)
})

test('separates heading, body link, permalink, and collapse control styles', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First body with an [external reference](https://example.com/resource).',
    '',
    '## Nested topic',
    '',
    'Nested body.',
    '',
    '### Small detail',
    '',
    'Detail body.',
    '',
    '# Second section',
    '',
    'Second body.',
  ].join('\n'))

  const h1 = page.locator('h1#first-section')
  const h2 = page.locator('h2#nested-topic')
  const h3 = page.locator('h3#small-detail')
  const h2Anchor = page.locator('h2#nested-topic > a.header-anchor')
  const bodyLink = page.locator('.reader-surface__content p a[href="https://example.com/resource"]')
  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  const h2Toggle = page.getByRole('button', { name: '折叠「Nested topic」章节' })
  const h3Toggle = page.getByRole('button', { name: '折叠「Small detail」章节' })

  for (const heading of [h1, h2, h3]) {
    await expect.poll(() => heading.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  }

  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element).color)).toBe(
    await h2.evaluate(element => getComputedStyle(element).color),
  )
  await expect.poll(() => bodyLink.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('underline')

  await expect.poll(() => h2.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none')
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0')
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element, '::after').content)).toContain('¶')
  await h2.hover()
  if (await page.evaluate(() => window.matchMedia('(hover: hover)').matches)) {
    await expect.poll(() => h2Anchor.evaluate(element => Number(getComputedStyle(element, '::after').opacity))).toBeGreaterThan(0)
  }
  else {
    await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0')
  }

  if (await page.evaluate(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches)) {
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(0.3)
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThanOrEqual(0.35)
  }
  else {
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(0.45)
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThanOrEqual(0.5)
  }

  await h2Anchor.focus()
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(h2Toggle).toHaveAttribute('data-reader-heading-level', '2')
  await expect(h3Toggle).toHaveAttribute('data-reader-heading-level', '3')
  await expect.poll(() => firstToggle.evaluate(element => element.tagName)).toBe('BUTTON')
  await expect.poll(() => firstToggle.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  await expect.poll(() => firstToggle.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44)
  await expect.poll(() => firstToggle.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  await firstToggle.focus()
  await expect.poll(() => firstToggle.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await expect.poll(() => h2Toggle.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44)
  await expect.poll(() => h3Toggle.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => firstToggle.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
})

test('does not persist collapsed H1 state after reload', async ({ page }) => {
  await page.goto('/')

  const firstToggle = page.locator('[data-reader-heading-toggle]').first()

  await firstToggle.click()
  await expect(page.getByText('打开 miru，像翻开一本排版精良的小册子。')).not.toBeVisible()

  await page.reload()

  await expect(page.locator('[data-reader-heading-toggle]').first()).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('打开 miru，像翻开一本排版精良的小册子。')).toBeVisible()
})

test('shows quiet outline navigation only for heading-rich documents', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# One',
    '',
    'One body.',
    '',
    '## Two',
    '',
    'Two body.',
    '',
    '## Three',
    '',
    'Three body.',
  ].join('\n'))
  await expect(page.getByTestId('reader-outline')).toHaveCount(0)

  await pasteText(page, [
    '# One',
    '',
    'One body.',
    '',
    '## Two',
    '',
    'Two body.',
    '',
    '## Three',
    '',
    'Three body.',
    '',
    '# Four',
    '',
    'Four body.',
  ].join('\n'))

  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline')).toBeVisible()
    await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  }
  else {
    const topBar = page.getByTestId('app-top-bar')
    const outlineButton = page.getByTestId('reader-outline-button')

    await expect(page.getByTestId('reader-outline')).toHaveCount(0)
    await expect(outlineButton).toBeVisible()
    await expect(topBar.locator('[data-testid="reader-outline-button"]')).toBeVisible()
    await expect(page.locator('.reader-outline__button')).toHaveCount(0)

    const layout = await Promise.all([
      topBar.boundingBox(),
      outlineButton.boundingBox(),
    ])
    expect(layout[0]).not.toBeNull()
    expect(layout[1]).not.toBeNull()
    expect(layout[1]!.y).toBeGreaterThanOrEqual(layout[0]!.y - 1)
    expect(layout[1]!.y + layout[1]!.height).toBeLessThanOrEqual(layout[0]!.y + layout[0]!.height + 1)
  }
})

test('keeps long outline navigation scrollable without dragging reader content', async ({ page }) => {
  const longOutlineMarkdown = [
    '# Long outline',
    '',
    'Start.',
    '',
    ...Array.from({ length: 36 }, (_, index) => [
      `## Outline section ${String(index + 1).padStart(2, '0')}`,
      '',
      `Section ${index + 1} body.`,
      '',
    ].join('\n')),
    '## Final outline stop',
    '',
    'End.',
  ].join('\n')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await pasteText(page, longOutlineMarkdown)
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()

  const desktopScrollMetrics = await page.evaluate(() => {
    const scrollBox = document.querySelector<HTMLElement>('[data-testid="reader-outline-scroll"]')
      ?? document.querySelector<HTMLElement>('[data-testid="reader-outline-rail"]')

    if (!scrollBox) {
      return { clientHeight: 0, scrollHeight: 0, scrollTop: 0 }
    }

    scrollBox.scrollTop = scrollBox.scrollHeight

    return {
      clientHeight: Math.round(scrollBox.clientHeight),
      scrollHeight: Math.round(scrollBox.scrollHeight),
      scrollTop: Math.round(scrollBox.scrollTop),
    }
  })

  expect(desktopScrollMetrics.scrollHeight).toBeGreaterThan(desktopScrollMetrics.clientHeight)
  expect(desktopScrollMetrics.scrollTop).toBeGreaterThan(0)
  await expect(page.getByTestId('reader-outline').getByRole('link', { name: 'Final outline stop' })).toBeInViewport()

  await page.evaluate(() => window.scrollTo(0, 480))
  const desktopReaderScrollBefore = await page.evaluate(() => Math.round(window.scrollY))
  await page.evaluate(() => {
    const scrollBox = document.querySelector<HTMLElement>('[data-testid="reader-outline-scroll"]')
      ?? document.querySelector<HTMLElement>('[data-testid="reader-outline-rail"]')
    if (scrollBox) {
      scrollBox.scrollTop = 0
    }
  })
  await page.getByTestId('reader-outline-rail').hover()
  await page.mouse.wheel(0, 720)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(desktopReaderScrollBefore)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await pasteText(page, longOutlineMarkdown)
  await expect(page.getByRole('heading', { name: 'Long outline' })).toBeVisible()
  const mobileReaderScrollBefore = await page.evaluate(() => Math.round(window.scrollY))

  await page.getByTestId('reader-outline-button').click()
  const panel = page.getByTestId('reader-outline-panel')
  await expect(panel).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${mobileReaderScrollBefore}px`)

  const mobileScrollMetrics = await page.evaluate(() => {
    const scrollBox = document.querySelector<HTMLElement>('[data-testid="reader-outline-scroll"]')
      ?? document.querySelector<HTMLElement>('[data-testid="reader-outline-panel"]')

    if (!scrollBox) {
      return { clientHeight: 0, scrollHeight: 0, scrollTop: 0 }
    }

    scrollBox.scrollTop = scrollBox.scrollHeight

    return {
      clientHeight: Math.round(scrollBox.clientHeight),
      scrollHeight: Math.round(scrollBox.scrollHeight),
      scrollTop: Math.round(scrollBox.scrollTop),
    }
  })

  expect(mobileScrollMetrics.scrollHeight).toBeGreaterThan(mobileScrollMetrics.clientHeight)
  expect(mobileScrollMetrics.scrollTop).toBeGreaterThan(0)
  await expect(panel.getByRole('link', { name: 'Final outline stop' })).toBeInViewport()

  await page.mouse.wheel(0, 720)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${mobileReaderScrollBefore}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)
})

test('keeps the active outline item visible while the reader scrolls', async ({ page }) => {
  const autoRevealMarkdown = [
    '# Active outline reveal',
    '',
    'Start.',
    '',
    ...Array.from({ length: 28 }, (_, index) => [
      `## Follow section ${String(index + 1).padStart(2, '0')}`,
      '',
      Array.from({ length: 8 }, (_, paragraphIndex) =>
        `Paragraph ${index + 1}.${paragraphIndex + 1} keeps this section tall enough for scroll-spy.`,
      ).join('\n\n'),
      '',
    ].join('\n')),
  ].join('\n')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await pasteText(page, autoRevealMarkdown)
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()

  await scrollHeadingNearTop(page, 'Follow section 24')
  await expect.poll(async () => {
    const state = await readOutlineItemState(page, 'Follow section 24')
    return Boolean(state?.isCurrent && state.isInsideScrollBox && state.scrollTop > 0)
  }).toBe(true)

  await setOutlineScrollTop(page, 0)
  await page.getByTestId('reader-outline-rail').hover()
  const pausedScrollTop = await readOutlineScrollTop(page)
  await scrollHeadingNearTop(page, 'Follow section 26')
  await expect.poll(async () => {
    const state = await readOutlineItemState(page, 'Follow section 26')
    return Boolean(state?.isCurrent)
  }).toBe(true)
  await page.waitForTimeout(260)
  await expect.poll(() => readOutlineScrollTop(page)).toBe(pausedScrollTop)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await pasteText(page, autoRevealMarkdown)
  await scrollHeadingNearTop(page, 'Follow section 20')

  await page.getByTestId('reader-outline-button').click()
  const panel = page.getByTestId('reader-outline-panel')
  await expect(panel).toBeVisible()

  await expect.poll(async () => {
    const state = await readOutlineItemState(page, 'Follow section 20')
    return Boolean(state?.isCurrent && state.isInsideScrollBox && state.scrollTop > 0)
  }).toBe(true)
  await expect.poll(() =>
    page.evaluate(() => Boolean(document.querySelector('[data-testid="reader-outline-panel"]')?.contains(document.activeElement))),
  ).toBe(true)
})

test('navigates from the outline and expands a collapsed parent section first', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First body.',
    '',
    '## Nested topic',
    '',
    'Nested body.',
    '',
    '# Second section',
    '',
    'Second body.',
    '',
    '# Third section',
    '',
    'Third body.',
  ].join('\n'))

  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  await firstToggle.click()
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Nested topic' })).not.toBeVisible()

  if (!isWideViewport(page)) {
    const outlineButton = page.getByTestId('reader-outline-button')
    const panel = page.getByTestId('reader-outline-panel')
    const firstOutlineItem = panel.getByRole('link', { name: 'First section' })

    await outlineButton.click()
    await expect(panel).toBeVisible()
    await expect(firstOutlineItem).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await expect(outlineButton).toBeFocused()

    await outlineButton.click()
    await expect(panel).toBeVisible()
    await expect(firstOutlineItem).toBeFocused()

    await page.mouse.click(12, 12)
    await expect(panel).not.toBeVisible()
    await expect(outlineButton).toBeFocused()

    await outlineButton.click()
    await expect(panel).toBeVisible()
    await expect(firstOutlineItem).toBeFocused()
  }

  await page.getByTestId('reader-outline').getByRole('link', { name: 'Nested topic' }).click()

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('heading', { name: 'Nested topic' })).toBeVisible()
  await expect(page).toHaveURL(/#nested-topic$/)
  await expect(page.getByRole('heading', { name: 'Nested topic' })).toBeFocused()

  if (!isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline-panel')).not.toBeVisible()
    await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  }
})

test('navigates from the outline and expands nested collapsed sections', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First body.',
    '',
    '## Nested topic',
    '',
    'Nested body.',
    '',
    '### Small detail',
    '',
    'Detail body.',
    '',
    '# Second section',
    '',
    'Second body.',
  ].join('\n'))

  const nestedToggle = page.locator('[data-reader-heading-toggle][data-reader-heading-level="2"]').first()
  await nestedToggle.click()
  await expect(nestedToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Small detail' })).not.toBeVisible()

  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
    await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
  }

  await page.getByTestId('reader-outline').getByRole('link', { name: 'Small detail' }).click()

  await expect(nestedToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/#small-detail$/)
  await expect(page.getByRole('heading', { name: 'Small detail' })).toBeFocused()
})

test('activates the final outline item near the page bottom', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Overview',
    '',
    'Start here.',
    '',
    '## Details',
    '',
    Array.from({ length: 36 }, (_, index) => `Long paragraph ${index + 1}.`).join('\n\n'),
    '',
    '# Table',
    '',
    'A short section.',
    '',
    '# Privacy',
    '',
    'Another short section.',
    '',
    '# Now try',
    '',
    'The last section is intentionally short.',
  ].join('\n'))

  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline')).toBeVisible()
  }
  else {
    await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
    await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
  }

  await expect
    .poll(async () =>
      page
        .getByTestId('reader-outline')
        .getByRole('link', { name: 'Now try' })
        .first()
        .getAttribute('aria-current'),
    )
    .toBe('location')
})

test('persists desktop outline position and hides the control on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  const rightLayout = await readOutlineLayout(page)
  expect(rightLayout.railLeft).toBeGreaterThan(rightLayout.contentRight)

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '大纲位置 右' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: '大纲位置 左' }).click()
  await expect(page.getByRole('radio', { name: '大纲位置 左' })).toHaveAttribute('aria-checked', 'true')

  const leftLayout = await readOutlineLayout(page)
  expect(leftLayout.railRight).toBeLessThan(leftLayout.contentLeft)
  expect(leftLayout.contentLeft - leftLayout.railRight).toBeGreaterThan(56)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}').outlinePosition)).toBe('left')

  await page.reload()
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  const persistedLeftLayout = await readOutlineLayout(page)
  expect(persistedLeftLayout.railRight).toBeLessThan(persistedLeftLayout.contentLeft)

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
  const resetLayout = await readOutlineLayout(page)
  expect(resetLayout.railLeft).toBeGreaterThan(resetLayout.contentRight)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '大纲位置 左' })).toHaveCount(0)
  await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  await expect(page.getByTestId('app-top-bar').locator('[data-testid="reader-outline-button"]')).toBeVisible()
})

test('collapses the floating menu and focuses the reader after menu paste success', async ({ page }) => {
  await page.addInitScript((markdown) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => markdown,
      },
    })
  }, fetchedMarkdown)

  await page.goto('/')

  const button = page.getByTestId('floating-affordance-button')

  await button.click()
  await page.getByRole('button', { name: /粘贴/ }).click()

  await expect(page.getByRole('heading', { name: 'Remote doc' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(page.locator('.reader-surface')).toBeFocused()
})

test('collapses the floating menu and focuses the reader after open-file success', async ({ page }) => {
  await page.goto('/')

  const button = page.getByTestId('floating-affordance-button')

  await button.click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /打开文件/ }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'remote-doc.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(fetchedMarkdown),
  })

  await expect(page.getByRole('heading', { name: 'Remote doc' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(page.locator('.reader-surface')).toBeFocused()
})

test('customizes reading settings, persists them, and resets to defaults', async ({ page }) => {
  await page.goto('/')
  await pasteText(page, [
    '# Heading one',
    '',
    'Body copy.',
    '',
    '## Heading two',
    '',
    'Second section.',
    '',
    '### Heading three',
    '',
    'Third section.',
    '',
    '#### Heading four',
    '',
    'Fourth section.',
  ].join('\n'))

  const settingsButton = page.getByTestId('reading-settings-button')
  const defaultTypography = await readReadingTypography(page)

  await settingsButton.click()
  await expect(page.getByTestId('reading-settings-panel')).toBeVisible()
  await expect(page.getByTestId('reading-settings-main-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: '文字' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '版面' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '预设' })).toBeVisible()

  await page.getByRole('button', { name: /管理预设/ }).click()
  await expect(page.getByTestId('reading-settings-presets-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: '管理预设' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回阅读设置' })).toBeFocused()
  await page.getByRole('button', { name: '返回阅读设置' }).click()
  await expect(page.getByTestId('reading-settings-main-panel')).toBeVisible()

  const fontSizeSlider = page.getByRole('slider', { name: '字号' })
  await expect(fontSizeSlider).toHaveAttribute('aria-valuetext', '字号 18px')

  await fontSizeSlider.press('ArrowRight')
  await fontSizeSlider.press('ArrowRight')
  await expect(fontSizeSlider).toHaveAttribute('aria-valuetext', '字号 20px')
  await page.getByRole('radio', { name: '行宽 宽' }).click()
  await page.getByRole('radio', { name: '字间距 松' }).click()
  await page.getByRole('radio', { name: '段间距 松' }).click()
  await page.getByRole('radio', { name: '页边距 宽松' }).click()
  await page.getByRole('radio', { name: '配色 Sepia' }).click()
  await page.getByRole('radio', { name: '对比 醒目' }).click()
  await page.getByRole('radio', { name: '正文字体 系统无衬线' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    measure: '75ch',
    letterSpacing: '0.03em',
    paragraphGap: '1.55em',
    pageMargin: 'clamp(2rem, 7vw, 6rem)',
    bg: '#efe1bd',
    fg: '#2a2012',
    fgMuted: '#3e3220',
    rule: '#ab8b48',
    codeBg: '#e2cb99',
    fontBody: '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    readingStyle: 'brutal',
    readingScheme: 'sepia',
    readingContrast: 'strong',
  })
  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 20,
    paragraphLetterSpacing: 0.6,
  })
  const enlargedTypography = await readReadingTypography(page)

  expect(enlargedTypography.h1).toBeGreaterThan(defaultTypography.h1)
  expect(enlargedTypography.h2).toBeGreaterThan(defaultTypography.h2)
  expect(enlargedTypography.h3).toBeGreaterThan(defaultTypography.h3)
  expect(enlargedTypography.h4).toBeGreaterThan(defaultTypography.h4)

  await page.reload()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    measure: '75ch',
    letterSpacing: '0.03em',
    paragraphGap: '1.55em',
    pageMargin: 'clamp(2rem, 7vw, 6rem)',
    bg: '#efe1bd',
    fg: '#2a2012',
    fgMuted: '#3e3220',
    rule: '#ab8b48',
    codeBg: '#e2cb99',
    readingStyle: 'brutal',
    readingScheme: 'sepia',
    readingContrast: 'strong',
  })
  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 20,
    paragraphLetterSpacing: 0.6,
  })

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: '恢复默认' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '',
    measure: '',
    letterSpacing: '',
    paragraphGap: '',
    pageMargin: '',
    bg: '',
    fontBody: '',
    readingStyle: 'brutal',
    readingScheme: 'system',
    readingContrast: '',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#fcf6ea',
    appBg: 'rgb(252, 246, 234)',
  })
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
})

test('loads curated optional reading fonts only after selection', async ({ page }) => {
  const optionalFontRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/fonts/optional/')) {
      optionalFontRequests.push(pathname)
    }
  })
  const previewFontRequests = () => optionalFontRequests.filter(pathname => pathname.includes('preview'))
  const fullFontRequests = () => optionalFontRequests.filter(pathname => !pathname.includes('preview') && !pathname.includes('LICENSES'))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
  expect(optionalFontRequests).toHaveLength(0)

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '正文字体 Literata' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '正文字体 霞鹜文楷' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '正文字体 Atkinson Hyperlegible' })).toBeVisible()
  await expect.poll(() => previewFontRequests().length).toBeGreaterThanOrEqual(3)
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('radio', { name: '正文字体 Atkinson Hyperlegible' }).click()
  await expect.poll(() => fullFontRequests().filter(pathname => pathname.includes('atkinson-hyperlegible')).length).toBeGreaterThanOrEqual(2)
  expect(fullFontRequests().some(pathname => pathname.includes('literata'))).toBe(false)
  expect(fullFontRequests().some(pathname => pathname.includes('lxgw-wenkai'))).toBe(false)

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '"Atkinson Hyperlegible", -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  })

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persisted.fontFamily).toBeUndefined()
  expect(persisted.tokenOverrides['--reading-font-body']).toContain('"Atkinson Hyperlegible"')
})

test('confirms the LXGW WenKai large optional font before loading the full package', async ({ page }) => {
  const optionalFontRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/fonts/optional/')) {
      optionalFontRequests.push(pathname)
    }
  })
  const fullFontRequests = () => optionalFontRequests.filter(pathname => !pathname.includes('preview') && !pathname.includes('LICENSES'))

  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '正文字体 霞鹜文楷' })).toBeVisible()
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await expect(page.getByTestId('optional-font-download-confirm')).toContainText('约 8.8MB')
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByTestId('optional-font-download-confirm')).toHaveCount(0)
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await page.getByTestId('optional-font-download-accept').click()
  await expect.poll(() => fullFontRequests().filter(pathname => pathname.includes('lxgw-wenkai-300-normal')).length).toBe(1)

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '"LXGW WenKai", "Songti SC", "Noto Serif CJK SC", serif',
  })

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  const confirmedFonts = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:confirmed-optional-fonts:v1') ?? '[]'))

  expect(persistedSettings.fontFamily).toBeUndefined()
  expect(persistedSettings.tokenOverrides['--reading-font-body']).toContain('"LXGW WenKai"')
  expect(confirmedFonts).toContain('lxgw-wenkai')

  await page.getByRole('radio', { name: '正文字体 Newsreader' }).click()
  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await expect(page.getByTestId('optional-font-download-confirm')).toHaveCount(0)
})

test('keeps LXGW WenKai confirmation open when the large font download fails', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const testWindow = window as Window & { __miruOptionalFontLoadFailures?: string[] }
    testWindow.__miruOptionalFontLoadFailures = ['lxgw-wenkai']
  })

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await page.getByTestId('optional-font-download-accept').click()

  await expect(page.getByTestId('optional-font-download-confirm')).toBeVisible()
  await expect(page.getByText('字体加载失败,请检查网络后重试。')).toBeVisible()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '',
  })

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  const confirmedFonts = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:confirmed-optional-fonts:v1') ?? '[]'))

  expect(persistedSettings.tokenOverrides?.['--reading-font-body']).toBeUndefined()
  expect(confirmedFonts).not.toContain('lxgw-wenkai')
})

test('uploads, persists, and safely deletes local reading fonts without third-party requests', async ({ page }) => {
  const requestHosts = new Set<string>()
  page.on('request', (request) => {
    requestHosts.add(new URL(request.url()).host)
  })

  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()

  const uploadedFontName = 'space-mono-latin-400-normal'
  const fontPath = fileURLToPath(import.meta.resolve('@ayingott/theme/fonts/space-mono-latin-400-normal.woff2'))
  await page.getByTestId('local-font-file-input').setInputFiles(fontPath)

  const uploadedFontRadio = page.getByRole('radio', { name: `正文字体 ${uploadedFontName}` })
  await expect(uploadedFontRadio).toBeVisible()
  await expect(uploadedFontRadio).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(`已添加字体「${uploadedFontName}」。`)).toBeVisible()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: expect.stringContaining('MiruLocalFont'),
  })

  const fontStack = (await readInlineReadingTokens(page)).fontBody
  expect(fontStack).toContain('"Songti SC"')
  expect(fontStack).toContain('"Noto Serif CJK SC"')

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persistedSettings.fontFamily).toMatch(/^local:font-/)
  expect(persistedSettings.tokenOverrides['--reading-font-body']).toContain('MiruLocalFont')

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.getByLabel('存为预设').fill('Uploaded face')
  await page.getByRole('button', { name: '保存' }).click()
  const persistedPresets = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v2') ?? '{}'))
  expect(persistedPresets.presets[0].settings.fontFamily).toBe(persistedSettings.fontFamily)

  await page.reload()
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: `正文字体 ${uploadedFontName}` })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: /管理我的字体/ }).click()
  await expect(page.getByTestId('reading-settings-fonts-panel')).toBeVisible()

  const uploadedFontRow = page.locator('.reading-settings__saved-preset').filter({ hasText: uploadedFontName })
  await uploadedFontRow.getByRole('button', { name: '删除' }).click()
  await expect(uploadedFontRow).toHaveAttribute('data-pending-delete', 'true')
  await uploadedFontRow.getByRole('button', { name: '确认删除' }).click()
  await expect(uploadedFontRow).toHaveCount(0)
  await page.getByRole('button', { name: '返回阅读设置' }).click()

  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '',
  })

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.locator('.reading-settings__saved-preset').filter({ hasText: 'Uploaded face' }).getByRole('button', { name: '应用' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '',
  })

  const devServerHost = new URL(page.url()).host
  expect([...requestHosts].every(host => host === devServerHost)).toBe(true)
})

test('rejects malformed local font uploads without changing the current font', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()

  await page.getByTestId('local-font-file-input').setInputFiles({
    name: 'broken.woff2',
    mimeType: 'font/woff2',
    buffer: Buffer.from('not a valid font'),
  })

  const fontError = page.getByText('字体无法解析,请换一个字体文件。')
  await expect(fontError).toBeVisible()
  const fontErrorColors = await fontError.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(fontErrorColors.fg, fontErrorColors.bg)).toBeGreaterThanOrEqual(4.5)
  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
})

test('theme style and color scheme switch independently while preserving OS following', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题风格 Default' }).click()
  await page.getByRole('radio', { name: '配色 深色' }).click()
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#121019',
    appBg: 'rgb(18, 16, 25)',
    codeBg: 'rgb(42, 38, 53)',
  })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('radio', { name: '配色 Sepia' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#efe1bd',
    readingStyle: 'default',
    readingScheme: 'sepia',
  })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#efe1bd')

  await page.getByRole('radio', { name: '配色 跟随系统' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '',
    readingStyle: 'default',
    readingScheme: 'system',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#121019',
    appBg: 'rgb(18, 16, 25)',
  })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persisted).toMatchObject({
    version: 2,
    themeStyle: 'default',
    colorScheme: 'system',
  })
  expect(persisted.tokenOverrides).toBeUndefined()
})

test('defaults to Brutal, can switch to Default, and applies Theme structural roles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  const root = page.locator('html')

  await expect(root).toHaveAttribute('data-reading-style', 'brutal')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).toHaveClass(/\bbrutal\b/)
  await expect(root).not.toHaveClass(/\bdark\b/)
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()

  await page.getByTestId('reading-settings-button').click()
  const brutalTheme = page.getByRole('radio', { name: '主题风格 Brutal' })
  const settingsPanel = page.getByTestId('reading-settings-panel')

  await expect(brutalTheme).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '',
    readingStyle: 'brutal',
    readingScheme: 'system',
  })
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#fcf6ea',
    fg: '#111',
    fgMuted: '#3a3429',
    accent: '#ffd02f',
    accentText: '#3d5afe',
    rule: '#111',
  })
  await expect(settingsPanel).toHaveCSS('border-radius', '0px')
  await expect(settingsPanel).toHaveCSS('border-top-width', '3px')
  await expect(settingsPanel).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(settingsPanel).not.toHaveCSS('box-shadow', 'none')
  await expect(page.getByTestId('reading-settings')).toHaveCSS('z-index', '10')

  const lightColors = await readComputedReadingColors(page)
  expect(contrastRatio(lightColors.fg, lightColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(lightColors.accentText, lightColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.emulateMedia({ colorScheme: 'dark' })

  await expect(root).toHaveClass(/\bdark\b/)
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#161412',
    fg: '#f5f2ea',
    fgMuted: '#e7dfd2',
    accent: '#ffd02f',
    accentText: '#c3a6ff',
    rule: '#f5f2ea',
  })
  await expect(settingsPanel).toHaveCSS('background-color', 'rgb(33, 30, 22)')

  const darkColors = await readComputedReadingColors(page)
  expect(contrastRatio(darkColors.fg, darkColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(darkColors.accentText, darkColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('radio', { name: '主题风格 Default' }).click()

  await expect(root).toHaveAttribute('data-reading-style', 'default')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).not.toHaveClass(/\bbrutal\b/)
  await expect(root).toHaveClass(/\bdark\b/)
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#121019',
    fg: '#f7f1e6',
    fgMuted: '#d7cdbc',
    accent: '#c7b6f5',
    accentText: '#c7b6f5',
  })

  const persistedDefault = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persistedDefault).toMatchObject({
    version: 2,
    themeStyle: 'default',
    colorScheme: 'system',
  })
  expect(persistedDefault.tokenOverrides).toBeUndefined()

  await page.keyboard.press('Escape')
  await page.reload()

  await expect(root).toHaveAttribute('data-reading-style', 'default')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).not.toHaveClass(/\bbrutal\b/)
  await expect(root).toHaveClass(/\bdark\b/)

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题风格 Brutal' }).click()

  await expect(root).toHaveAttribute('data-reading-style', 'brutal')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).toHaveClass(/\bbrutal\b/)
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
})

test('Default contrast adjustment follows the resolved OS theme and keeps AA contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题风格 Default' }).click()
  await page.getByRole('radio', { name: '对比 柔和' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fg: '',
    readingStyle: 'default',
    readingScheme: 'system',
    readingContrast: 'soft',
  })

  const darkColors = await readComputedReadingColors(page)
  expect(darkColors.fg).toBe('#d7cdbc')
  expect(contrastRatio(darkColors.fg, darkColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.emulateMedia({ colorScheme: 'light' })

  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#faf8f4',
    fg: '#514a3e',
  })
  const lightColors = await readComputedReadingColors(page)
  expect(lightColors.fg).toBe('#514a3e')
  expect(contrastRatio(lightColors.fg, lightColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('radio', { name: '对比 醒目' }).click()

  const strongLightColors = await readComputedReadingColors(page)
  expect(strongLightColors.fg).toBe('#191713')
  expect(strongLightColors.fgMuted).toBe('#514a3e')
  expect(contrastRatio(strongLightColors.fg, strongLightColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(strongLightColors.fgMuted, strongLightColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('custom theme editor warns and auto-fixes AA contrast', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '配色 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义配色/ }).click()
  await expect(page.getByTestId('reading-settings-custom-theme-panel')).toBeVisible()

  const contrastWarning = page.locator('.reading-settings__warning')

  await page.getByLabel('自定义配色 背景').fill('#000000')
  await page.getByLabel('自定义配色 正文').fill('#222222')
  await page.getByLabel('自定义配色 强调').fill('#333333')
  await expect(contrastWarning).toHaveAttribute('data-severity', 'critical')
  const warningColors = await contrastWarning.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(warningColors.fg, warningColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByLabel('自定义配色 背景').fill('#ffffff')
  await page.getByLabel('自定义配色 正文').fill('#bbbbbb')
  await page.getByLabel('自定义配色 强调').fill('#cccccc')

  await expect(page.getByText('正文与强调色对比不足，正文几乎无法阅读。')).toBeVisible()
  await expect(contrastWarning).toHaveAttribute('data-severity', 'critical')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#ffffff',
    fg: '#bbbbbb',
    accent: '#cccccc',
    readingStyle: 'brutal',
    readingScheme: 'custom',
  })

  await page.getByLabel('自定义配色 正文').fill('#111111')
  await expect(page.getByText('强调色对比不足，链接和重点可能不清晰。')).toBeVisible()
  await expect(contrastWarning).toHaveAttribute('data-severity', 'notice')

  await page.getByRole('button', { name: /自动修正到 AA/ }).click()

  await expect(contrastWarning).not.toBeVisible()
  const fixedTokens = await readInlineReadingTokens(page)

  expect(contrastRatio(fixedTokens.fg, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.fgMuted, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.accent, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.accentContrast, fixedTokens.accent)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.focus, fixedTokens.bg)).toBeGreaterThanOrEqual(3)
  expect(contrastRatio(fixedTokens.codeFg, fixedTokens.codeBg)).toBeGreaterThanOrEqual(4.5)

  const fixedComputedColors = await readComputedReadingColors(page)
  expect(contrastRatio(fixedComputedColors.accentText, fixedComputedColors.bg)).toBeGreaterThanOrEqual(4.5)

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))

  expect(persisted).toMatchObject({
    version: 2,
    themeStyle: 'brutal',
    colorScheme: 'custom',
  })
  expect(persisted.customTheme.bg).toBe('#ffffff')
  expect(contrastRatio(persisted.customTheme.fg, persisted.customTheme.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(persisted.customTheme.accent, persisted.customTheme.bg)).toBeGreaterThanOrEqual(4.5)

  await page.reload()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#ffffff',
    readingStyle: 'brutal',
    readingScheme: 'custom',
  })
  const reloadedTokens = await readInlineReadingTokens(page)

  expect(contrastRatio(reloadedTokens.fg, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.fgMuted, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.accent, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.codeFg, reloadedTokens.codeBg)).toBeGreaterThanOrEqual(4.5)
})

test('keeps desktop outline focus rings readable on Custom reading palettes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'custom',
      customTheme: {
        bg: '#777777',
        fg: '#000000',
        accent: '#000000',
      },
    }))
  })
  await page.goto('/')

  const rail = page.getByTestId('reader-outline-rail')
  await expect(rail).toBeVisible()

  const outlineItem = rail.locator('.reader-outline__item').first()
  await page.keyboard.press('Tab')
  await outlineItem.focus()
  await expect(outlineItem).toBeFocused()

  const focusColors = await outlineItem.evaluate((element) => {
    const appShell = document.querySelector<HTMLElement>('.app-shell')
    const styles = getComputedStyle(element)

    return {
      background: appShell ? getComputedStyle(appShell).backgroundColor : '',
      outline: styles.outlineColor,
      outlineStyle: styles.outlineStyle,
    }
  })

  expect(focusColors.outlineStyle).not.toBe('none')
  expect(contrastRatio(focusColors.outline, focusColors.background)).toBeGreaterThanOrEqual(3)
})

test('keeps library chrome independent from low-contrast Custom reading colors', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'custom',
      customTheme: {
        bg: '#ffffff',
        fg: '#bbbbbb',
        accent: '#cccccc',
      },
    }))
  })
  await page.goto('/')
  await page.getByTestId('library-open-button').click()

  const appShell = page.locator('.app-shell')
  await expect(appShell).toHaveClass(/\bapp-shell--library\b/)

  const libraryColors = await page.getByTestId('library-view').evaluate((library) => {
    const shell = library.closest<HTMLElement>('.app-shell')
    const title = library.querySelector<HTMLElement>('.library-view__title')
    const intro = library.querySelector<HTMLElement>('.library-view__intro')
    const sort = library.querySelector<HTMLElement>('.library-view__sort')

    return {
      introFg: intro ? getComputedStyle(intro).color : '',
      shellBg: shell ? getComputedStyle(shell).backgroundColor : '',
      sortBg: sort ? getComputedStyle(sort).backgroundColor : '',
      sortFg: sort ? getComputedStyle(sort).color : '',
      titleFg: title ? getComputedStyle(title).color : '',
    }
  })

  expect(contrastRatio(libraryColors.titleFg, libraryColors.shellBg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(libraryColors.introFg, libraryColors.shellBg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(libraryColors.sortFg, libraryColors.sortBg)).toBeGreaterThanOrEqual(4.5)
})

test('keeps settings status pairs readable in dark schemes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '配色 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义配色/ }).click()
  await page.getByLabel('自定义配色 背景').fill('#000000')
  await page.getByLabel('自定义配色 正文').fill('#222222')
  await page.getByLabel('自定义配色 强调').fill('#333333')

  const failedContrastRow = page.locator('.reading-settings__contrast-row[data-pass="false"]').first()
  const failedRowColors = await failedContrastRow.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(failedRowColors.fg, failedRowColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('button', { name: '返回阅读设置' }).click()
  const warningStatus = page.getByText('需要调整对比', { exact: true })
  const warningStatusColors = await warningStatus.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(warningStatusColors.fg, warningStatusColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('keeps code and semantic panels readable with a dark Custom theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'custom',
      customTheme: {
        bg: '#000000',
        fg: '#ffffff',
        accent: '#ffffff',
      },
    }))
  })
  await page.goto('/')

  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-reading-style', 'default')
  await expect(root).toHaveAttribute('data-reading-scheme', 'custom')
  await expect(root).toHaveClass(/\bdark\b/)

  const codeColors = await page.locator('.reader-surface__content .shiki span').first().evaluate((token) => {
    const code = token.closest<HTMLElement>('.shiki')
    return {
      bg: code ? getComputedStyle(code).backgroundColor : '',
      fg: getComputedStyle(token).color,
    }
  })
  expect(contrastRatio(codeColors.fg, codeColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByTestId('reader-outline-button').click()
  const outlineColors = await page.getByTestId('reader-outline-panel').evaluate((panel) => {
    const title = panel.querySelector<HTMLElement>('.reader-outline__title')
    return {
      bg: getComputedStyle(panel).backgroundColor,
      fg: title ? getComputedStyle(title).color : '',
    }
  })
  expect(contrastRatio(outlineColors.fg, outlineColors.bg)).toBeGreaterThanOrEqual(4.5)
  await page.getByRole('button', { name: '关闭文档大纲' }).click()

  await pasteText(page, '# Custom surface\n\nDark custom content.')
  await page.getByTestId('library-open-button').click()

  const entry = page.getByTestId('library-entry').filter({ hasText: 'Custom surface' })
  await entry.getByRole('button', { name: 'Custom surface 更多操作' }).click()
  const menu = entry.getByRole('menu')
  const menuColors = await menu.evaluate((element) => {
    const item = element.querySelector<HTMLElement>('.library-entry__menu-item:not(.library-entry__menu-item--danger)')
    return {
      bg: getComputedStyle(element).backgroundColor,
      fg: item ? getComputedStyle(item).color : '',
    }
  })
  expect(contrastRatio(menuColors.fg, menuColors.bg)).toBeGreaterThanOrEqual(4.5)

  await menu.getByRole('menuitem', { name: '删除' }).click()
  const dialog = page.getByRole('dialog', { name: /删除「Custom surface」/ })
  const dialogColors = await dialog.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.library-dialog__panel')
    const title = element.querySelector<HTMLElement>('.library-dialog__title')
    return {
      bg: panel ? getComputedStyle(panel).backgroundColor : '',
      fg: title ? getComputedStyle(title).color : '',
    }
  })
  expect(contrastRatio(dialogColors.fg, dialogColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('saves, applies, renames, and deletes reading presets', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()

  const fontSizeSlider = page.getByRole('slider', { name: '字号' })
  await fontSizeSlider.press('ArrowRight')
  await fontSizeSlider.press('ArrowRight')
  await page.getByRole('radio', { name: '字间距 松' }).click()
  await page.getByRole('radio', { name: '配色 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义配色/ }).click()
  await page.getByLabel('自定义配色 背景').fill('#ffffff')
  await page.getByLabel('自定义配色 正文').fill('#111111')
  await page.getByLabel('自定义配色 强调').fill('#767676')
  await page.getByRole('button', { name: '返回阅读设置' }).click()

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.getByLabel('存为预设').fill('Focus preset')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' })).toBeVisible()
  await page.getByLabel('存为预设').fill('Focus preset')
  await expect(page.getByText('已有同名预设，不会覆盖。')).toBeVisible()

  const persistedAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v2') ?? '{}'))
  expect(persistedAfterSave.presets).toHaveLength(1)
  expect(persistedAfterSave.presets[0].name).toBe('Focus preset')
  expect(persistedAfterSave.presets[0].settings).toMatchObject({
    fontSize: '20',
    letterSpacing: 'loose',
    themeStyle: 'brutal',
    colorScheme: 'custom',
    customTheme: {
      bg: '#ffffff',
      fg: '#111111',
      accent: '#767676',
    },
  })

  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '',
    letterSpacing: '',
    bg: '',
    readingStyle: 'brutal',
    readingScheme: 'system',
  })

  await page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' }).getByRole('button', { name: '应用' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    letterSpacing: '0.03em',
    bg: '#ffffff',
    fg: '#111111',
    accent: '#767676',
    readingStyle: 'brutal',
    readingScheme: 'custom',
  })
  await expect(page.getByText('当前: Focus preset')).toBeVisible()

  const savedPreset = page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' })
  await savedPreset.getByRole('button', { name: '重命名' }).click()
  await page.getByLabel('重命名预设 Focus preset').fill('Deep focus')
  await page.locator('.reading-settings__saved-preset').getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.reading-settings__saved-preset').filter({ hasText: 'Deep focus' })).toBeVisible()
  await expect(page.getByText('当前: Deep focus')).toBeVisible()

  const renamedPreset = page.locator('.reading-settings__saved-preset').filter({ hasText: 'Deep focus' })
  await renamedPreset.getByRole('button', { name: '删除' }).click()
  await expect(renamedPreset).toHaveAttribute('data-pending-delete', 'true')
  await renamedPreset.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('Deep focus')).not.toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-presets:v2'))).toBeNull()
})

test('reading settings use a bottom sheet on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 18,
  })

  await page.getByTestId('reading-settings-button').click()

  const panel = page.getByTestId('reading-settings-panel')
  await expect(panel).toBeVisible()

  const box = await panel.boundingBox()
  expect(box?.width).toBeGreaterThan(360)
  expect(box?.y).toBeGreaterThan(250)
  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(page.getByTestId('reading-settings-button')).toBeFocused()
})

test('contains reading settings panel scroll chaining on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await pasteText(page, [
    '# Long settings panel doc',
    '',
    Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Long settings panel doc' })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 360))
  const pageScrollBefore = await page.evaluate(() => Math.round(window.scrollY))
  expect(pageScrollBefore).toBeGreaterThan(250)

  await page.getByTestId('reading-settings-button').click()
  const panel = page.getByTestId('reading-settings-panel')
  await expect(panel).toBeVisible()
  await expect.poll(() => panel.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe('contain')
  await expect.poll(() => panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)

  const panelBox = await panel.boundingBox()
  expect(panelBox).not.toBeNull()
  await page.mouse.move(panelBox!.x + panelBox!.width / 2, panelBox!.y + panelBox!.height / 2)

  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const panelScrollBottom = await panel.evaluate(element => Math.round(element.scrollTop))
  expect(panelScrollBottom).toBeGreaterThan(0)

  await page.mouse.wheel(0, 1200)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(pageScrollBefore)
  await expect.poll(() => panel.evaluate(element => Math.round(element.scrollTop))).toBe(panelScrollBottom)

  await panel.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.mouse.wheel(0, -1200)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(pageScrollBefore)
  await expect.poll(() => panel.evaluate(element => Math.round(element.scrollTop))).toBe(0)
})

test('locks page scroll while mobile command sheets are open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await pasteText(page, [
    '# Scroll lock doc',
    '',
    '## First section',
    '',
    '## Second section',
    '',
    '### Third section',
    '',
    Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Scroll lock doc' })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 520))
  const scrollBeforeSettings = await page.evaluate(() => Math.round(window.scrollY))
  expect(scrollBeforeSettings).toBeGreaterThan(300)

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByTestId('reading-settings-panel')).toBeVisible()
  await expect(page.getByTestId('command-scrim')).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reading-settings-panel')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeSettings)

  await page.getByTestId('floating-affordance-button').click()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByTestId('command-scrim')).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeSettings)

  await page.getByTestId('reader-outline-button').click()
  await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
  await expect(page.getByTestId('command-scrim')).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.getByTestId('command-scrim').click({ position: { x: 20, y: 20 } })
  await expect(page.getByTestId('reader-outline-panel')).not.toBeVisible()
  await expect(page.getByTestId('reader-outline-button')).toBeFocused()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeSettings)
})

test('uses a full-width outline sheet scrim on tablet and system dark', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await pasteText(page, [
    '# Tablet outline',
    '',
    '## First section',
    '',
    '## Second section',
    '',
    '### Third section',
    '',
    Array.from({ length: 48 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Tablet outline' })).toBeVisible()
  await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  await expect(page.getByTestId('reader-outline')).toHaveCount(0)

  async function readOutlineScrimStyle(): Promise<{ animationName: string, backgroundColor: string }> {
    await page.getByTestId('reader-outline-button').click()
    await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
    await expect(page.getByTestId('command-scrim')).toBeVisible()

    return page.evaluate(() => {
      const scrim = document.querySelector<HTMLElement>('[data-testid="command-scrim"]')
      const style = scrim ? getComputedStyle(scrim) : null

      return {
        animationName: style?.animationName ?? '',
        backgroundColor: style?.backgroundColor ?? '',
      }
    })
  }

  async function closeOutlineScrim(): Promise<void> {
    await page.getByTestId('command-scrim').click({ position: { x: 24, y: 24 } })
    await expect(page.getByTestId('reader-outline-panel')).not.toBeVisible()
    await expect(page.getByTestId('reader-outline-button')).toBeFocused()
  }

  async function selectReadingOption(name: string): Promise<void> {
    await page.getByTestId('reading-settings-button').click()
    await expect(page.getByTestId('reading-settings-panel')).toBeVisible()
    await page.getByRole('radio', { name }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('reading-settings-panel')).not.toBeVisible()
  }

  await page.evaluate(() => window.scrollTo(0, 520))
  const scrollBeforeOutline = await page.evaluate(() => Math.round(window.scrollY))
  expect(scrollBeforeOutline).toBeGreaterThan(300)

  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
  await expect(page.locator('html')).toHaveClass(/\bbrutal\b/)
  expect(await readOutlineScrimStyle()).toMatchObject({
    animationName: expect.stringContaining('command-scrim-fade'),
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).top)).toBe(`-${scrollBeforeOutline}px`)

  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="reader-outline-panel"]')

    return {
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
    }
  })

  expect(layout.panelWidth).toBeGreaterThan(740)

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeOutline}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await closeOutlineScrim()
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeOutline)

  await selectReadingOption('配色 浅色')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'light')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await selectReadingOption('配色 Sepia')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'sepia')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await page.emulateMedia({ colorScheme: 'light' })
  await selectReadingOption('配色 深色')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.4)')
  await closeOutlineScrim()

  await selectReadingOption('主题风格 Default')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
  await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.4)')
  await closeOutlineScrim()

  await selectReadingOption('配色 跟随系统')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  expect(await readOutlineScrimStyle()).toMatchObject({
    animationName: 'none',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  })
  await closeOutlineScrim()
})

test('default Brutal follows OS color scheme changes for reading and code surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
  await expect(page.locator('.reader-surface__content')).toBeVisible()

  const lightTheme = await readThemeSnapshot(page)
  const lightTypography = await readReadingTypography(page)

  await page.emulateMedia({ colorScheme: 'dark' })

  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#161412',
    appBg: 'rgb(22, 20, 18)',
    codeBg: 'rgb(58, 52, 39)',
  })

  const darkTheme = await readThemeSnapshot(page)
  const darkTypography = await readReadingTypography(page)

  expect(lightTheme.readingBg).toBe('#fcf6ea')
  expect(darkTheme.shikiColor).not.toBe(lightTheme.shikiColor)
  expect(darkTypography).toEqual(lightTypography)
})

async function readThemeSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const app = document.querySelector('.app-shell')
    const code = document.querySelector('pre')
    const shikiToken = document.querySelector('.shiki span')

    return {
      readingBg: getComputedStyle(document.documentElement).getPropertyValue('--reading-bg').trim(),
      appBg: app ? getComputedStyle(app).backgroundColor : '',
      codeBg: code ? getComputedStyle(code).backgroundColor : '',
      shikiColor: shikiToken ? getComputedStyle(shikiToken).color : '',
    }
  })
}

async function readInlineReadingTokens(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.documentElement

    return {
      fontSize: root.style.getPropertyValue('--reading-font-size').trim(),
      measure: root.style.getPropertyValue('--reading-measure').trim(),
      letterSpacing: root.style.getPropertyValue('--reading-letter-spacing').trim(),
      paragraphGap: root.style.getPropertyValue('--reading-paragraph-gap').trim(),
      pageMargin: root.style.getPropertyValue('--reading-page-margin').trim(),
      bg: root.style.getPropertyValue('--reading-bg').trim(),
      fg: root.style.getPropertyValue('--reading-fg').trim(),
      fgMuted: root.style.getPropertyValue('--reading-fg-muted').trim(),
      accent: root.style.getPropertyValue('--reading-accent').trim(),
      accentContrast: root.style.getPropertyValue('--reading-accent-contrast').trim(),
      focus: root.style.getPropertyValue('--reading-focus').trim(),
      rule: root.style.getPropertyValue('--reading-rule').trim(),
      codeFg: root.style.getPropertyValue('--reading-code-fg').trim(),
      codeBg: root.style.getPropertyValue('--reading-code-bg').trim(),
      fontBody: root.style.getPropertyValue('--reading-font-body').trim(),
      readingStyle: root.dataset.readingStyle ?? '',
      readingScheme: root.dataset.readingScheme ?? '',
      readingContrast: root.dataset.readingContrast ?? '',
    }
  })
}

async function readReadingTypography(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const readPx = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0
    }
    const readLetterSpacingPx = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? Number.parseFloat(getComputedStyle(element).letterSpacing) : 0
    }

    return {
      body: readPx('.reader-surface__content'),
      h1: readPx('.reader-surface__content h1'),
      h2: readPx('.reader-surface__content h2'),
      h3: readPx('.reader-surface__content h3'),
      h4: readPx('.reader-surface__content h4'),
      paragraphLetterSpacing: readLetterSpacingPx('.reader-surface__content p'),
    }
  })
}

async function readComputedReadingColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement)

    return {
      bg: rootStyle.getPropertyValue('--reading-bg').trim(),
      fg: rootStyle.getPropertyValue('--reading-fg').trim(),
      fgMuted: rootStyle.getPropertyValue('--reading-fg-muted').trim(),
      accent: rootStyle.getPropertyValue('--reading-accent').trim(),
      accentText: rootStyle.getPropertyValue('--reading-accent-text').trim(),
      accentContrast: rootStyle.getPropertyValue('--reading-accent-contrast').trim(),
      rule: rootStyle.getPropertyValue('--reading-rule').trim(),
    }
  })
}

function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA)
  const luminanceB = relativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = parseRgbColor(color).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function parseRgbColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const raw = color.slice(1)
    const normalized = raw.length === 3
      ? raw.split('').map(channel => `${channel}${channel}`).join('')
      : raw

    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
    ]
  }

  const channels = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number)

  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported color format: ${color}`)
  }

  return [channels[0]!, channels[1]!, channels[2]!]
}

async function readOutlineLayout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.reader-surface__content')
    const rail = document.querySelector<HTMLElement>('[data-testid="reader-outline-rail"]')

    if (!content || !rail) {
      return {
        contentLeft: 0,
        contentRight: 0,
        railLeft: 0,
        railRight: 0,
      }
    }

    const contentRect = content.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()

    return {
      contentLeft: contentRect.left,
      contentRight: contentRect.right,
      railLeft: railRect.left,
      railRight: railRect.right,
    }
  })
}

async function pasteText(page: import('@playwright/test').Page, text: string) {
  await page.evaluate((value) => {
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
    event.clipboardData?.setData('text/plain', value)
    document.querySelector('main')?.dispatchEvent(event)
  }, text)
}

async function readReadingProgressPercent(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('reading-progress-fill').evaluate((element) => {
    return Number.parseFloat((element as HTMLElement).style.inlineSize || '0')
  })
}

async function scrollHeadingNearTop(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.getByRole('heading', { name }).evaluate((heading) => {
    const rect = heading.getBoundingClientRect()
    window.scrollTo({
      top: rect.top + window.scrollY - 92,
      behavior: 'auto',
    })
  })
}

async function readOutlineItemState(page: import('@playwright/test').Page, label: string) {
  return page.evaluate((targetLabel) => {
    const scrollBox = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="reader-outline-scroll"]'))
      .find(element => element.getClientRects().length > 0)

    if (!scrollBox) {
      return null
    }

    const item = Array.from(scrollBox.querySelectorAll<HTMLElement>('[data-outline-item]'))
      .find(element => element.textContent?.trim() === targetLabel)

    if (!item) {
      return null
    }

    const scrollRect = scrollBox.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()

    return {
      isCurrent: item.getAttribute('aria-current') === 'location',
      isInsideScrollBox: itemRect.top >= scrollRect.top - 1 && itemRect.bottom <= scrollRect.bottom + 1,
      itemBottom: Math.round(itemRect.bottom),
      itemTop: Math.round(itemRect.top),
      scrollBottom: Math.round(scrollRect.bottom),
      scrollTop: Math.round(scrollBox.scrollTop),
      scrollViewportTop: Math.round(scrollRect.top),
    }
  }, label)
}

async function setOutlineScrollTop(page: import('@playwright/test').Page, scrollTop: number): Promise<void> {
  await page.evaluate((nextScrollTop) => {
    const scrollBox = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="reader-outline-scroll"]'))
      .find(element => element.getClientRects().length > 0)

    if (scrollBox) {
      scrollBox.scrollTop = nextScrollTop
    }
  }, scrollTop)
}

async function readOutlineScrollTop(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const scrollBox = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="reader-outline-scroll"]'))
      .find(element => element.getClientRects().length > 0)

    return Math.round(scrollBox?.scrollTop ?? 0)
  })
}

async function expectVisibleFocusRing(locator: import('@playwright/test').Locator) {
  await locator.page().keyboard.press('Tab')
  await locator.focus()

  const ring = await locator.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      boxShadow: styles.boxShadow,
      outlineColor: styles.outlineColor,
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth || '0'),
    }
  })

  expect(ring.outlineStyle).not.toBe('none')
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2)
  expect(ring.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(ring.boxShadow).not.toBe('none')
}

async function readTopBarHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('app-top-bar').evaluate((element) => {
    return Math.round(element.getBoundingClientRect().height)
  })
}

async function openFileThroughFloatingMenu(
  page: import('@playwright/test').Page,
  file: { name: string, mimeType: string, buffer: Buffer },
) {
  await page.getByTestId('floating-affordance-button').click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /打开文件/ }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(file)
}

interface SimplePdfPageInput {
  height?: number
  text: string
  width?: number
}

function createSimplePdfBuffer(text: string | Array<string | SimplePdfPageInput>): Buffer {
  const pages = (Array.isArray(text) ? text : [text]).map((page): Required<SimplePdfPageInput> => {
    if (typeof page === 'string') {
      return { height: 792, text: page, width: 612 }
    }

    return {
      height: page.height ?? 792,
      text: page.text,
      width: page.width ?? 612,
    }
  })
  const pageObjectOffset = 4
  const contentObjectOffset = pageObjectOffset + pages.length
  const kids = pages.map((_, index) => `${pageObjectOffset + index} 0 R`).join(' ')
  const streams = pages.map(page => `BT /F1 24 Tf 72 ${Math.max(72, page.height - 72)} Td (${escapePdfText(page.text)}) Tj ET`)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ...pages.map((page, index) =>
      `${pageObjectOffset + index} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectOffset + index} 0 R >>\nendobj\n`,
    ),
    ...streams.map((stream, index) =>
      `${contentObjectOffset + index} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    ),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf)
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

async function openBookshelfEntry(entry: import('@playwright/test').Locator, title: string) {
  await expect(entry).toBeVisible()

  if (!isWideViewport(entry.page())) {
    await entry.getByRole('button', { name: title, exact: true }).click()
    return
  }

  const directOpen = entry.getByRole('button', { name: /^(打开|看原件)$/ })
  await expect(directOpen.first()).toBeVisible()
  await directOpen.first().click()
}

async function chooseBookshelfAction(
  entry: import('@playwright/test').Locator,
  title: string,
  actionName: string,
) {
  await expect(entry).toBeVisible()

  if (!isWideViewport(entry.page())) {
    await entry.getByRole('button', { name: `${title} 更多操作`, exact: true }).click()
    await entry.getByRole('menuitem', { name: actionName, exact: true }).click()
    return
  }

  const directAction = entry.getByRole('button', { name: actionName, exact: true })
  await expect(directAction.first()).toBeVisible()
  await directAction.first().click()
}

function isWideViewport(page: import('@playwright/test').Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1100
}
