import { expect } from '@playwright/test'

export async function pasteText(page: import('@playwright/test').Page, text: string) {
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

export async function waitForReaderReady(
  page: import('@playwright/test').Page,
  headingName: string | RegExp,
) {
  await expect(page.getByRole('heading', { name: headingName })).toBeVisible()
  const readerSurface = page.locator('.reader-surface')
  await expect(readerSurface).toHaveAttribute('aria-busy', 'false')
  await expect(readerSurface).toBeFocused()
}

export async function readReadingProgressPercent(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('reading-progress-fill').evaluate((element) => {
    return Number.parseFloat((element as HTMLElement).style.inlineSize || '0')
  })
}

export async function openBookshelfEntry(entry: import('@playwright/test').Locator, title: string) {
  await expect(entry).toBeVisible()

  if (!isWideViewport(entry.page())) {
    await entry.getByRole('button', { name: title, exact: true }).click()
    return
  }

  const directOpen = entry.getByRole('button', { name: /^(打开|看原件)$/ })
  await expect(directOpen.first()).toBeVisible()
  await directOpen.first().click()
}

export function isWideViewport(page: import('@playwright/test').Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1100
}
