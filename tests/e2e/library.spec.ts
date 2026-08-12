import { expect, test } from '@playwright/test'
import {
  isWideViewport,
  openBookshelfEntry,
  pasteText,
  waitForReaderReady,
} from './support/reader'

interface LibraryReadFaultWindow extends Window {
  __miruMarkdownReadFault?: {
    armed: boolean
    failureCount: number
    restore: () => void
  }
}

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

test.describe('library view resource load recovery', () => {
  test.use({ serviceWorkers: 'block' })

  test('keeps the active reader available when the library view chunk fails to load', async ({ page }) => {
    const libraryChunkPattern = /\/assets\/LibraryView-[^/?]+\.js(?:\?.*)?$/
    let libraryChunkRequests = 0
    await page.route(libraryChunkPattern, async (route) => {
      libraryChunkRequests += 1
      await route.abort('failed')
    })
    await page.goto('/')

    await pasteText(page, '# Chunk-safe document\n\nStill readable while the bookshelf is unavailable.')
    await waitForReaderReady(page, 'Chunk-safe document')
    await page.getByTestId('library-open-button').click()

    await expect.poll(() => libraryChunkRequests).toBeGreaterThan(0)
    await expect(page.getByTestId('library-view')).toHaveCount(0)
    await expect(page.locator('.reader-surface')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Chunk-safe document' })).toBeVisible()
    await expect(page.getByText('Still readable while the bookshelf is unavailable.')).toBeVisible()
    await expect(page.getByTestId('library-open-button')).toContainText('文库')

    const inputMenu = page.getByTestId('floating-affordance-menu')
    await expect(inputMenu).toBeVisible()
    await expect(inputMenu.getByRole('status')).toContainText('文库界面暂时无法加载')
    await expect(inputMenu.getByRole('status')).toContainText('重新加载页面')

    await page.unroute(libraryChunkPattern)
    await page.reload()
    await page.getByTestId('library-open-button').click()
    await expect(page.getByTestId('library-view')).toBeVisible()
    await expect(page.getByTestId('library-entry').filter({ hasText: 'Chunk-safe document' })).toBeVisible()
  })
})

test('keeps a Markdown entry retryable after a transient body read failure', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as LibraryReadFaultWindow
    const originalGet = IDBObjectStore.prototype.get
    const faultState = {
      armed: false,
      failureCount: 0,
      restore: () => {
        IDBObjectStore.prototype.get = originalGet
      },
    }

    IDBObjectStore.prototype.get = function (query: IDBValidKey | IDBKeyRange) {
      if (faultState.armed && this.name === 'markdownBodies') {
        faultState.armed = false
        faultState.failureCount += 1
        throw new DOMException('Injected Markdown body read failure', 'UnknownError')
      }

      return originalGet.call(this, query)
    }
    target.__miruMarkdownReadFault = faultState
  })
  await page.goto('/')

  await pasteText(page, '# Retry local document\n\nStill available after a transient failure.')
  await waitForReaderReady(page, 'Retry local document')
  await page.getByTestId('library-open-button').click()

  const libraryView = page.getByTestId('library-view')
  const entry = page.getByTestId('library-entry').filter({ hasText: 'Retry local document' })
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', error => pageErrors.push(error.message))

  await expect(libraryView).toBeVisible()
  await expect(entry).toBeVisible()
  await page.evaluate(() => {
    const state = (window as LibraryReadFaultWindow).__miruMarkdownReadFault
    if (!state) {
      throw new Error('Markdown read fault hook was not installed')
    }
    state.armed = true
  })
  await openBookshelfEntry(entry, 'Retry local document')

  await expect(libraryView).toBeVisible()
  await expect(entry).toBeVisible()
  await expect(libraryView.getByRole('status')).toContainText('暂时无法打开')
  await expect(libraryView.getByRole('status')).toContainText('请稍后重试')
  await expect.poll(() => page.evaluate(() => (
    (window as LibraryReadFaultWindow).__miruMarkdownReadFault?.failureCount ?? 0
  ))).toBe(1)

  await page.evaluate(() => {
    (window as LibraryReadFaultWindow).__miruMarkdownReadFault?.restore()
  })
  await openBookshelfEntry(entry, 'Retry local document')
  await waitForReaderReady(page, 'Retry local document')
  await expect(page.getByText('Still available after a transient failure.')).toBeVisible()
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
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

test('restores the active library Markdown position when returning from the bookshelf', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, createLongMarkdown('Library return position'))
  await waitForReaderReady(page, 'Library return position')

  const expectedScrollY = await page.evaluate(async () => {
    const didScroll = new Promise<void>((resolve) => {
      window.addEventListener('scroll', () => resolve(), { once: true })
    })
    window.scrollTo({ top: 1200, behavior: 'auto' })
    await didScroll
    return Math.round(window.scrollY)
  })
  expect(expectedScrollY).toBeGreaterThan(800)

  await page.getByTestId('library-open-button').click()
  await expect(page.getByTestId('library-view')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.getByRole('button', { name: '返回阅读', exact: true }).click()
  await waitForReaderReady(page, 'Library return position')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(expectedScrollY)
})

test('keeps a pending Markdown position owned by its source document during rapid import', async ({ page }) => {
  const clockStart = new Date('2026-08-09T00:00:00.000Z')

  await page.clock.install({ time: clockStart })
  await page.goto('/')

  await pasteText(page, createLongMarkdown('Timer owner A'))
  await waitForReaderReady(page, 'Timer owner A')
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000))

  const expectedScrollY = await page.evaluate(async () => {
    const didScroll = new Promise<void>((resolve) => {
      window.addEventListener('scroll', () => resolve(), { once: true })
    })
    window.scrollTo({ top: 1200, behavior: 'auto' })
    await didScroll
    return Math.round(window.scrollY)
  })
  expect(expectedScrollY).toBeGreaterThan(800)

  await page.clock.runFor(449)
  await pasteText(page, createLongMarkdown('Timer owner B'))
  await waitForReaderReady(page, 'Timer owner B')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(expectedScrollY)

  await page.clock.runFor(1)
  await page.evaluate(() => new Promise<void>(resolve => queueMicrotask(resolve)))

  const positions = await readMarkdownPositionsByTitle(page, [
    'Timer owner A',
    'Timer owner B',
  ])

  expect(positions['Timer owner A']).toMatchObject({
    scrollY: expectedScrollY,
    type: 'markdown',
  })
  expect(positions['Timer owner B']).toBeNull()
})

function createLongMarkdown(title: string): string {
  return [
    `# ${title}`,
    '',
    ...Array.from(
      { length: 120 },
      (_, index) => `Paragraph ${index + 1}. ${'Quiet reading text. '.repeat(6)}`,
    ),
  ].join('\n\n')
}

async function readMarkdownPositionsByTitle(
  page: import('@playwright/test').Page,
  titles: string[],
): Promise<Record<string, { scrollY: number, type: string } | null>> {
  return page.evaluate(async (requestedTitles) => {
    const readRequest = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('miru:library:v1')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })

    try {
      const transaction = database.transaction(['entries', 'positions'], 'readonly')
      const completed = new Promise<void>((resolve, reject) => {
        transaction.onabort = () => reject(transaction.error)
        transaction.onerror = () => reject(transaction.error)
        transaction.oncomplete = () => resolve()
      })
      const entriesRequest = transaction.objectStore('entries').getAll()
      const positionsRequest = transaction.objectStore('positions').getAll()
      const [entries, positions] = await Promise.all([
        readRequest<Array<{ id: string, title: string }>>(entriesRequest),
        readRequest<Array<{ documentId: string, scrollY?: number, type: string }>>(positionsRequest),
      ])
      await completed

      return Object.fromEntries(requestedTitles.map((title) => {
        const documentId = entries.find(entry => entry.title === title)?.id
        const position = positions.find(candidate => candidate.documentId === documentId)
        return [
          title,
          position?.type === 'markdown' && typeof position.scrollY === 'number'
            ? { scrollY: position.scrollY, type: position.type }
            : null,
        ]
      }))
    }
    finally {
      database.close()
    }
  }, titles)
}

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
