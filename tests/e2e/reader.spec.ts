import { expect, test } from '@playwright/test'
import path from 'node:path'

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

  await page.evaluate(() => {
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
    event.clipboardData?.setData('text/plain', '# Pasted doc\n\nHello **miru**.')
    document.querySelector('main')?.dispatchEvent(event)
  })

  await expect(page.getByRole('heading', { name: 'Pasted doc' })).toBeVisible()
  await expect(page.getByText('Hello miru.')).toBeVisible()
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

test('adds pasted markdown to the local library and reopens it from the bookshelf', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, '# Library doc\n\nSaved locally.')
  await expect(page.getByRole('heading', { name: 'Library doc' })).toBeVisible()

  await page.getByTestId('library-open-button').click()
  await expect(page.getByTestId('library-view')).toBeVisible()

  const entry = page.getByTestId('library-entry').filter({ hasText: 'Library doc' })
  await expect(entry).toContainText('粘贴')
  await expect(entry).toContainText('MD')

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
    buffer: createSimplePdfBuffer(['Daily Paper', 'Daily Paper page two']),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Daily Paper' })).toBeVisible()
  await expect(page.getByText('PDF 保持原样显示, 不做文字提取或上传。')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer-canvas')).toBeVisible()
  await expect(page.getByText('1 / 2')).toBeVisible()
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
        top: rect.top,
      }
    })
    expect(sideButtonRects).toHaveLength(2)
    for (const rect of sideButtonRects) {
      expect(rect.width).toBeGreaterThanOrEqual(44)
      expect(rect.height).toBeGreaterThanOrEqual(44)
      expect(rect.top).toBeGreaterThanOrEqual(stageRect.top)
      expect(rect.bottom).toBeLessThanOrEqual(stageRect.bottom)
    }
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
  await page.getByLabel('跳转页码').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('2 / 2')).toBeVisible()
  await page.getByTestId('pdf-viewer').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 2')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 2')).toBeVisible()
  const toolbarButtonRects = await page.locator('.pdf-viewer__toolbar button').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect()).map(rect => ({
      height: rect.height,
      width: rect.width,
    })),
  )
  expect(toolbarButtonRects.length).toBeGreaterThan(0)
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
  await page.goto('/')

  await openFileThroughFloatingMenu(page, {
    name: 'Long Paper.pdf',
    mimeType: 'application/pdf',
    buffer: createSimplePdfBuffer(Array.from({ length: 8 }, (_, index) => `Long Paper page ${index + 1}`)),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByText('1 / 8')).toBeVisible()

  await page.getByRole('button', { name: '滚动' }).click()
  await expect(page.getByRole('button', { name: '滚动' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('pdf-viewer-scroll-stack')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer-scroll-page')).toHaveCount(8)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeGreaterThan(0)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeLessThan(8)

  const stage = page.getByTestId('pdf-viewer-stage')
  await page.getByLabel('跳转页码').fill('6')
  await page.keyboard.press('Enter')
  await expect(page.getByText('6 / 8')).toBeVisible()
  await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect.poll(() => page.getByTestId('pdf-viewer-scroll-canvas').count()).toBeLessThan(8)

  let expectedPage = '6 / 8'
  if (isWideViewport(page)) {
    await page.getByTestId('pdf-viewer-side-next').click()
    expectedPage = '7 / 8'
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
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /打开文件/ })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^文库/ })).toBeVisible()
  await expect(page.getByLabel('URL 导入')).toBeVisible()
  await expect(page.getByRole('button', { name: /清空当前.*回到示例文档.*不影响文库/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /打印/ })).toBeVisible()
  await expect(page.locator('input[type="file"]')).not.toHaveAttribute('accept')
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
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()
  await page.mouse.click(200, 120)
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.click()
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()
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
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()
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

  await expect.poll(() => h2.evaluate(element => getComputedStyle(element, '::before').width)).toBe('14px')
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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v1') ?? '{}').outlinePosition)).toBe('left')

  await page.reload()
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  const persistedLeftLayout = await readOutlineLayout(page)
  expect(persistedLeftLayout.railRight).toBeLessThan(persistedLeftLayout.contentLeft)

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('miru:reading-settings:v1'))).toBeNull()
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
  await page.getByRole('radio', { name: '主题 Sepia' }).click()
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
    readingTheme: 'sepia',
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
    readingTheme: 'sepia',
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
    readingTheme: '',
    readingContrast: '',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#fbf8f1',
    appBg: 'rgb(251, 248, 241)',
  })
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v1'))).toBeNull()
})

test('uploads, persists, and safely deletes local reading fonts without third-party requests', async ({ page }) => {
  const requestHosts = new Set<string>()
  page.on('request', (request) => {
    requestHosts.add(new URL(request.url()).host)
  })

  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()

  const uploadedFontName = 'space-mono-latin-400-normal'
  const fontPath = path.join(process.cwd(), 'node_modules/@ayingott/theme/src/fonts/space-mono-latin-400-normal.woff2')
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

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v1') ?? '{}'))
  expect(persistedSettings.fontFamily).toMatch(/^local:font-/)
  expect(persistedSettings.tokenOverrides['--reading-font-body']).toContain('MiruLocalFont')

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.getByLabel('存为预设').fill('Uploaded face')
  await page.getByRole('button', { name: '保存' }).click()
  const persistedPresets = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v1') ?? '{}'))
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
  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()

  await page.getByTestId('local-font-file-input').setInputFiles({
    name: 'broken.woff2',
    mimeType: 'font/woff2',
    buffer: Buffer.from('not a valid font'),
  })

  await expect(page.getByText('字体无法解析,请换一个字体文件。')).toBeVisible()
  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v1'))).toBeNull()
})

test('system theme clears explicit theme overrides and keeps OS dark following', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题 深色' }).click()
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#171615',
    appBg: 'rgb(23, 22, 21)',
    codeBg: 'rgb(34, 32, 30)',
  })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('radio', { name: '主题 Sepia' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#efe1bd',
    readingTheme: 'sepia',
  })

  await page.getByRole('radio', { name: '主题 跟随系统' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '',
    readingTheme: '',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#171615',
    appBg: 'rgb(23, 22, 21)',
  })
})

test('system contrast adjustment follows the resolved OS theme and keeps AA contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '对比 柔和' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fg: '',
    readingTheme: '',
    readingContrast: 'soft',
  })

  const darkColors = await readComputedReadingColors(page)
  expect(darkColors.fg).toBe('#cfc5b8')
  expect(contrastRatio(darkColors.fg, darkColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.emulateMedia({ colorScheme: 'light' })

  const lightColors = await readComputedReadingColors(page)
  expect(lightColors.fg).toBe('#4a453d')
  expect(contrastRatio(lightColors.fg, lightColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('radio', { name: '对比 醒目' }).click()

  const strongLightColors = await readComputedReadingColors(page)
  expect(strongLightColors.fg).toBe('#17130f')
  expect(strongLightColors.fgMuted).toBe('#322d26')
  expect(strongLightColors.rule).toBe('#c7b8a0')
  expect(contrastRatio(strongLightColors.fg, strongLightColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(strongLightColors.fgMuted, strongLightColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('custom theme editor warns and auto-fixes AA contrast', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义主题/ }).click()
  await expect(page.getByTestId('reading-settings-custom-theme-panel')).toBeVisible()

  await page.getByLabel('自定义主题 背景').fill('#ffffff')
  await page.getByLabel('自定义主题 正文').fill('#bbbbbb')
  await page.getByLabel('自定义主题 强调').fill('#cccccc')

  const contrastWarning = page.locator('.reading-settings__warning')

  await expect(page.getByText('正文与强调色对比不足，正文几乎无法阅读。')).toBeVisible()
  await expect(contrastWarning).toHaveAttribute('data-severity', 'critical')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#ffffff',
    fg: '#bbbbbb',
    accent: '#cccccc',
    readingTheme: 'custom',
  })

  await page.getByLabel('自定义主题 正文').fill('#111111')
  await expect(page.getByText('强调色对比不足，链接和重点可能不清晰。')).toBeVisible()
  await expect(contrastWarning).toHaveAttribute('data-severity', 'notice')

  await page.getByRole('button', { name: /自动修正到 AA/ }).click()

  await expect(contrastWarning).not.toBeVisible()
  const fixedTokens = await readInlineReadingTokens(page)

  expect(contrastRatio(fixedTokens.fg, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.fgMuted, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.accent, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.codeFg, fixedTokens.codeBg)).toBeGreaterThanOrEqual(4.5)

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v1') ?? '{}'))

  expect(persisted.presetId).toBe('custom')
  expect(persisted.customTheme.bg).toBe('#ffffff')
  expect(contrastRatio(persisted.customTheme.fg, persisted.customTheme.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(persisted.customTheme.accent, persisted.customTheme.bg)).toBeGreaterThanOrEqual(4.5)

  await page.reload()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#ffffff',
    readingTheme: 'custom',
  })
  const reloadedTokens = await readInlineReadingTokens(page)

  expect(contrastRatio(reloadedTokens.fg, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.fgMuted, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.accent, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.codeFg, reloadedTokens.codeBg)).toBeGreaterThanOrEqual(4.5)
})

test('saves, applies, renames, and deletes reading presets', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()

  const fontSizeSlider = page.getByRole('slider', { name: '字号' })
  await fontSizeSlider.press('ArrowRight')
  await fontSizeSlider.press('ArrowRight')
  await page.getByRole('radio', { name: '字间距 松' }).click()
  await page.getByRole('radio', { name: '主题 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义主题/ }).click()
  await page.getByLabel('自定义主题 背景').fill('#ffffff')
  await page.getByLabel('自定义主题 正文').fill('#111111')
  await page.getByLabel('自定义主题 强调').fill('#767676')
  await page.getByRole('button', { name: '返回阅读设置' }).click()

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.getByLabel('存为预设').fill('Focus preset')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' })).toBeVisible()
  await page.getByLabel('存为预设').fill('Focus preset')
  await expect(page.getByText('已有同名预设，不会覆盖。')).toBeVisible()

  const persistedAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v1') ?? '{}'))
  expect(persistedAfterSave.presets).toHaveLength(1)
  expect(persistedAfterSave.presets[0].name).toBe('Focus preset')
  expect(persistedAfterSave.presets[0].settings).toMatchObject({
    fontSize: '20',
    letterSpacing: 'loose',
    theme: 'custom',
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
    readingTheme: '',
  })

  await page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' }).getByRole('button', { name: '应用' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    letterSpacing: '0.03em',
    bg: '#ffffff',
    fg: '#111111',
    accent: '#767676',
    readingTheme: 'custom',
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
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-presets:v1'))).toBeNull()
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

  async function selectTheme(name: string): Promise<void> {
    await page.getByTestId('reading-settings-button').click()
    await expect(page.getByTestId('reading-settings-panel')).toBeVisible()
    await page.getByRole('radio', { name }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('reading-settings-panel')).not.toBeVisible()
  }

  await page.evaluate(() => window.scrollTo(0, 520))
  const scrollBeforeOutline = await page.evaluate(() => Math.round(window.scrollY))
  expect(scrollBeforeOutline).toBeGreaterThan(300)

  await expect(page.locator('html')).not.toHaveAttribute('data-reading-theme')
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

  await selectTheme('主题 浅色')
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'light')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await selectTheme('主题 Sepia')
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'sepia')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await page.emulateMedia({ colorScheme: 'light' })
  await selectTheme('主题 深色')
  await expect(page.locator('html')).toHaveAttribute('data-reading-theme', 'dark')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.4)')
  await closeOutlineScrim()

  await selectTheme('主题 跟随系统')
  await expect(page.locator('html')).not.toHaveAttribute('data-reading-theme')
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

test('follows OS color scheme changes for reading and code surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await expect(page.locator('.reader-surface__content')).toBeVisible()

  const lightTheme = await readThemeSnapshot(page)

  await page.emulateMedia({ colorScheme: 'dark' })

  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#171615',
    appBg: 'rgb(23, 22, 21)',
    codeBg: 'rgb(34, 32, 30)',
  })

  const darkTheme = await readThemeSnapshot(page)

  expect(lightTheme.readingBg).toBe('#fbf8f1')
  expect(darkTheme.shikiColor).not.toBe(lightTheme.shikiColor)
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
      rule: root.style.getPropertyValue('--reading-rule').trim(),
      codeFg: root.style.getPropertyValue('--reading-code-fg').trim(),
      codeBg: root.style.getPropertyValue('--reading-code-bg').trim(),
      fontBody: root.style.getPropertyValue('--reading-font-body').trim(),
      readingTheme: root.dataset.readingTheme ?? '',
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
    const normalized = color.slice(1)
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

function createSimplePdfBuffer(text: string | string[]): Buffer {
  const pageTexts = Array.isArray(text) ? text : [text]
  const pageObjectOffset = 4
  const contentObjectOffset = pageObjectOffset + pageTexts.length
  const kids = pageTexts.map((_, index) => `${pageObjectOffset + index} 0 R`).join(' ')
  const streams = pageTexts.map(value => `BT /F1 24 Tf 72 720 Td (${escapePdfText(value)}) Tj ET`)
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ...pageTexts.map((_, index) =>
      `${pageObjectOffset + index} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectOffset + index} 0 R >>\nendobj\n`,
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
