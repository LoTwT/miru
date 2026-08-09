import { expect, test } from '@playwright/test'
import {
  isWideViewport,
  openBookshelfEntry,
  pasteText,
  waitForReaderReady,
} from './support/reader'

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

test('restores local library markdown scroll position when reopening a document', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Long local doc',
    '',
    Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await waitForReaderReady(page, 'Long local doc')

  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800)
  await page.waitForTimeout(600)

  await page.getByTestId('floating-affordance-button').click()
  await page.getByTestId('floating-affordance-menu').getByRole('button', { name: /^文库/ }).click()
  await openBookshelfEntry(page.getByTestId('library-entry').filter({ hasText: 'Long local doc' }), 'Long local doc')

  await expect(page.getByRole('heading', { name: 'Long local doc' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800)
})

async function readTopBarHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('app-top-bar').evaluate((element) => {
    return Math.round(element.getBoundingClientRect().height)
  })
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
