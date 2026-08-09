import { expect, test } from '@playwright/test'
import {
  isWideViewport,
  openBookshelfEntry,
  pasteText,
  readReadingProgressPercent,
  waitForReaderReady,
} from './support/reader'

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

test('renders fenced code while optional syntax highlighting is unavailable', async ({ page }) => {
  await page.route(/\/assets\/syntaxHighlighter-[^/]+\.js$/, route => route.abort())
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
  await expect(page.locator('.reader-surface__content pre code').first()).toBeVisible()
  await expect(page.locator('.reader-surface__content .shiki')).toHaveCount(0)
})

test('defers local databases until their related surfaces open', async ({ page }) => {
  await page.addInitScript(() => {
    const openedDatabases: string[] = []
    const originalOpen = IDBFactory.prototype.open
    Object.defineProperty(window, '__miruOpenedDatabases', { value: openedDatabases })
    IDBFactory.prototype.open = function (name: string, version?: number): IDBOpenDBRequest {
      openedDatabases.push(name)
      return version === undefined
        ? originalOpen.call(this, name)
        : originalOpen.call(this, name, version)
    }
  })
  const readOpenedDatabases = () => page.evaluate(() =>
    [...(window as typeof window & { __miruOpenedDatabases: string[] }).__miruOpenedDatabases],
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await readOpenedDatabases()).toEqual([])

  await page.getByTestId('library-open-button').click()
  await expect(page.getByTestId('library-view')).toBeVisible()
  await expect.poll(readOpenedDatabases).toContain('miru:library:v1')
  expect(await readOpenedDatabases()).not.toContain('miru:local-fonts:v1')

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByText('字号').first()).toBeVisible()
  await expect.poll(readOpenedDatabases).toContain('miru:local-fonts:v1')
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
  await waitForReaderReady(page, 'Long footer test')
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
  await waitForReaderReady(page, 'Progress doc')
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
  await waitForReaderReady(page, 'Searchable note')

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

  await waitForReaderReady(page, 'First section')

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
