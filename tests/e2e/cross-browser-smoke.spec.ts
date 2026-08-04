import { expect, test } from '@playwright/test'
import { createSimplePdfBuffer, openFileThroughFloatingMenu } from './support/documentInputs'

test.describe('cross-browser reading smoke', () => {
  test('starts with the sample document ready to read', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '输入方式', level: 2 })).toBeVisible()
    await expect(page.getByTestId('floating-affordance-button')).toBeVisible()
  })

  test('imports Markdown from an explicit URL', async ({ page }) => {
    await page.route('https://example.com/cross-browser.md', async route => route.fulfill({
      contentType: 'text/markdown',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '# Cross-browser URL\n\nLoaded through the browser fetch boundary.',
    }))
    await page.goto('/')

    await page.getByTestId('floating-affordance-button').click()
    await page.getByLabel('URL').fill('https://example.com/cross-browser.md')
    await page.getByRole('button', { name: '拉取' }).click()

    await expect(page.getByRole('heading', { name: 'Cross-browser URL' })).toBeVisible()
    await expect(page.getByText('Loaded through the browser fetch boundary.')).toBeVisible()
    await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  })

  test('persists an imported Markdown file in the local library', async ({ page }) => {
    await page.goto('/')
    await openFileThroughFloatingMenu(page, {
      name: 'cross-browser-note.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Cross-browser note\n\nSaved in IndexedDB.'),
    })

    await expect(page.getByRole('heading', { name: 'Cross-browser note' })).toBeVisible()
    await page.reload()
    await page.getByTestId('library-open-button').click()

    const entry = page.getByTestId('library-entry').filter({ hasText: 'Cross-browser note' })
    await expect(entry).toBeVisible()
    await entry.getByRole('button', { name: /^(打开|看原件)$/ }).click()
    await expect(page.getByRole('heading', { name: 'Cross-browser note' })).toBeVisible()
    await expect(page.getByText('Saved in IndexedDB.')).toBeVisible()
  })

  test('restores the selected reading scheme after reload', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('reading-settings-button').click()

    const darkScheme = page.getByRole('radio', { name: '配色 深色' })
    await darkScheme.click()
    await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
    await page.getByTestId('reading-settings-button').click()
    await expect(page.getByRole('radio', { name: '配色 深色' })).toHaveAttribute('aria-checked', 'true')
  })

  test('opens and reopens a local PDF', async ({ page }) => {
    await page.goto('/')
    await openFileThroughFloatingMenu(page, {
      name: 'Cross-browser Paper.pdf',
      mimeType: 'application/pdf',
      buffer: createSimplePdfBuffer('Cross browser PDF smoke'),
    })

    await expect(page.getByTestId('pdf-viewer')).toBeVisible()
    await expect(page.getByTestId('pdf-viewer-canvas')).toBeVisible()
    await expect(page.getByText('1 / 1')).toBeVisible()

    await page.getByTestId('library-open-button').click()
    const entry = page.getByTestId('library-entry').filter({ hasText: 'Cross-browser Paper' })
    await expect(entry).toBeVisible()
    await entry.getByRole('button', { name: /^(打开|看原件)$/ }).click()
    await expect(page.getByTestId('pdf-viewer')).toBeVisible()
    await expect(page.getByTestId('pdf-viewer-canvas')).toBeVisible()
  })
})
