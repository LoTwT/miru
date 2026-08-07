import { expect, test } from '@playwright/test'
import { isWideViewport, pasteText } from './support/reader'

const fetchedMarkdown = '# Remote doc\n\nLoaded from URL.'

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

test('keeps the latest pasted document active when an earlier import finishes later', async ({ page }) => {
  await installFirstStorageEstimateGate(page, 'resolve')

  await page.goto('/')

  await pasteText(page, '# Earlier import\n\nThis should stay in the library.')
  await waitForFirstStorageEstimate(page)

  await pasteText(page, '# Latest import\n\nThis should remain active.')
  await expect(page.getByRole('heading', { name: 'Latest import' })).toBeVisible()

  await releaseFirstStorageEstimate(page)
  await expect.poll(() => countLibraryEntries(page)).toBe(2)

  await expect(page.getByRole('heading', { name: 'Latest import' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Earlier import' })).toHaveCount(0)
})

test('ignores an earlier import failure after a newer document becomes active', async ({ page }) => {
  await installFirstStorageEstimateGate(page, 'reject')
  await page.goto('/')

  await pasteText(page, '# Earlier import\n\nThis write will fail late.')
  await waitForFirstStorageEstimate(page)

  await pasteText(page, '# Latest import\n\nThis should remain active.')
  await expect(page.getByRole('heading', { name: 'Latest import' })).toBeVisible()

  await releaseFirstStorageEstimate(page)
  await page.evaluate(async () => {
    const state = window as typeof window & {
      waitForFirstStorageEstimateSettled?: Promise<void>
    }
    await state.waitForFirstStorageEstimateSettled
    await new Promise<void>(resolve => window.setTimeout(resolve, 0))
  })

  await expect(page.getByRole('heading', { name: 'Latest import' })).toBeVisible()
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect(page.getByText('无法加入文库。当前文档没有被替换, 请稍后再试。')).toHaveCount(0)
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

async function countLibraryEntries(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('miru:library:v1')

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('entries', 'readonly')
      const countRequest = transaction.objectStore('entries').count()

      countRequest.onerror = () => reject(countRequest.error)
      countRequest.onsuccess = () => resolve(countRequest.result)
      transaction.oncomplete = () => database.close()
    }
  }))
}

async function installFirstStorageEstimateGate(
  page: import('@playwright/test').Page,
  outcome: 'reject' | 'resolve',
): Promise<void> {
  await page.addInitScript(({ outcome }) => {
    const state = window as typeof window & {
      releaseFirstStorageEstimate?: () => void
      waitForFirstStorageEstimate?: Promise<void>
      waitForFirstStorageEstimateSettled?: Promise<void>
    }
    let markFirstEstimateStarted!: () => void
    let estimateCount = 0

    state.waitForFirstStorageEstimate = new Promise<void>((resolve) => {
      markFirstEstimateStarted = resolve
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: () => {
          estimateCount += 1

          if (estimateCount === 1) {
            markFirstEstimateStarted()
            const estimate = new Promise<StorageEstimate>((resolve, reject) => {
              state.releaseFirstStorageEstimate = () => {
                if (outcome === 'resolve') {
                  resolve({ quota: 1024 ** 3, usage: 0 })
                }
                else {
                  reject(new DOMException('Storage estimate failed', 'UnknownError'))
                }
              }
            })
            state.waitForFirstStorageEstimateSettled = estimate.then(() => undefined, () => undefined)
            return estimate
          }

          return Promise.resolve({ quota: 1024 ** 3, usage: 0 })
        },
      },
    })
  }, { outcome })
}

async function waitForFirstStorageEstimate(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => (window as typeof window & {
    waitForFirstStorageEstimate?: Promise<void>
  }).waitForFirstStorageEstimate)
}

async function releaseFirstStorageEstimate(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => (window as typeof window & {
    releaseFirstStorageEstimate?: () => void
  }).releaseFirstStorageEstimate?.())
}

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
