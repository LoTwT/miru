import { expect, test } from '@playwright/test'

const fetchedMarkdown = '# Remote doc\n\nLoaded from URL.'

test('renders the sample document and supports paste input', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
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
  await expect(footer).toContainText('安静地读 Markdown · 文档留在本机 · 隐私是默认')
  await expect(footer.getByRole('link', { name: '源码 (GitHub)' })).toHaveAttribute('rel', 'noreferrer')
  await expect(footer.getByRole('link', { name: 'CommonMark' })).toHaveAttribute('rel', 'noreferrer')
  await expect.poll(() =>
    footer.getByRole('link', { name: '源码 (GitHub)' }).evaluate((link) => link.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44)

  await footer.getByRole('button', { name: '↑ 回到顶部' }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(24)
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
    buffer: createSimplePdfBuffer('Daily Paper'),
  })

  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Daily Paper' })).toBeVisible()
  await expect(page.getByText('PDF 保持原样显示, 不做文字提取或上传。')).toBeVisible()
  await expect(page.getByTestId('pdf-viewer-canvas')).toBeVisible()
  await expect(page.getByText('1 / 1')).toBeVisible()
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
  await expect(page.locator('.reader-surface')).toHaveCount(0)
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
  await page.getByTestId('floating-affordance-menu').getByRole('button', { name: /文库/ }).click()
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
  await expect(page.getByTestId('reader-outline')).toBeVisible()

  await page.emulateMedia({ media: 'print' })

  await expect(page.getByText('Collapsed body.')).toBeVisible()
  await expect(page.getByTestId('floating-affordance')).not.toBeVisible()
  await expect(page.getByTestId('reading-settings')).not.toBeVisible()
  await expect(page.getByTestId('reader-outline')).not.toBeVisible()
  await expect(page.locator('.app-shell__header')).not.toBeVisible()
  await expect(page.locator('.reader-footer__links')).not.toBeVisible()
  await expect(page.getByText('安静地读 Markdown · 文档留在本机 · 隐私是默认')).toBeVisible()

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

test('exposes document input through the floating affordance', async ({ page }) => {
  await page.goto('/')

  const affordance = page.getByTestId('floating-affordance')
  const button = page.getByTestId('floating-affordance-button')

  await button.click()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /打开文件/ })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu').getByRole('button', { name: /文库/ })).toBeVisible()
  await expect(page.getByLabel('URL')).toBeVisible()
  await expect(page.getByRole('button', { name: /清空/ })).toBeVisible()
  await expect(page.locator('input[type="file"]')).not.toHaveAttribute('accept')
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: /打开文件/ })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.click()
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()
  await page.mouse.click(24, 24)
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.click()
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeFocused()
  await button.click()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(button).toBeFocused()

  await button.evaluate(element => (element as HTMLElement).blur())
  await page.mouse.move(20, 20)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(async () => Number.parseFloat(await affordance.evaluate(element => getComputedStyle(element).opacity))).toBeLessThan(0.5)

  await page.evaluate(() => window.scrollTo(0, 360))
  await expect(page.getByTestId('scroll-top-button')).toBeVisible()
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
  await expect(page.locator('.reader-surface__meta')).toHaveText('https://github.com/LoTwT/miru/blob/main/README.md')
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

test('collapses H1 sections while preserving heading permalinks', async ({ page }) => {
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

  await expect(page.locator('h1#first-section a.header-anchor')).toHaveAttribute('href', '#first-section')
  await expect(page.getByRole('button', { name: '折叠「First section」章节' })).toBeVisible()
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')

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

  await expect(page.getByTestId('reader-outline')).toBeVisible()

  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  }
  else {
    await expect(page.getByTestId('reader-outline-button')).toBeVisible()
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

  await expect(page.getByTestId('reader-outline')).toBeVisible()
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
  await expect(page.getByRole('radio', { name: '字号 很小' })).toBeFocused()

  await page.getByRole('radio', { name: '字号 大' }).click()
  await page.getByRole('radio', { name: '行宽 宽' }).click()
  await page.getByRole('radio', { name: '主题 Sepia' }).click()
  await page.getByRole('radio', { name: '正文字体 无衬线' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    measure: '75ch',
    bg: '#efe1bd',
    fgMuted: '#64553e',
    codeBg: '#e2cb99',
    fontBody: '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    readingTheme: 'sepia',
  })
  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 20,
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
    bg: '#efe1bd',
    fgMuted: '#64553e',
    codeBg: '#e2cb99',
    readingTheme: 'sepia',
  })
  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 20,
  })

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: '恢复默认' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '',
    measure: '',
    bg: '',
    fontBody: '',
    readingTheme: '',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#fbf8f1',
    appBg: 'rgb(251, 248, 241)',
  })
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
  await expect(page.getByRole('radio', { name: '字号 很小' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(page.getByTestId('reading-settings-button')).toBeFocused()
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
      bg: root.style.getPropertyValue('--reading-bg').trim(),
      fgMuted: root.style.getPropertyValue('--reading-fg-muted').trim(),
      codeBg: root.style.getPropertyValue('--reading-code-bg').trim(),
      fontBody: root.style.getPropertyValue('--reading-font-body').trim(),
      readingTheme: root.dataset.readingTheme ?? '',
    }
  })
}

async function readReadingTypography(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const readPx = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0
    }

    return {
      body: readPx('.reader-surface__content'),
      h1: readPx('.reader-surface__content h1'),
      h2: readPx('.reader-surface__content h2'),
      h3: readPx('.reader-surface__content h3'),
      h4: readPx('.reader-surface__content h4'),
    }
  })
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

function createSimplePdfBuffer(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
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
