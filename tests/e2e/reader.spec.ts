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

test('exposes document input through the floating affordance', async ({ page }) => {
  await page.goto('/')

  const affordance = page.getByTestId('floating-affordance')
  const button = page.getByTestId('floating-affordance-button')

  await button.click()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByRole('button', { name: /粘贴/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /打开文件/ })).toBeVisible()
  await expect(page.getByLabel('URL')).toBeVisible()
  await expect(page.getByRole('button', { name: /清空/ })).toBeVisible()
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

test('customizes reading settings, persists them, and resets to defaults', async ({ page }) => {
  await page.goto('/')

  const settingsButton = page.getByTestId('reading-settings-button')

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
    bg: '#f4ecd8',
    fgMuted: '#6f6149',
    fontBody: '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    readingTheme: 'sepia',
  })

  await page.reload()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    measure: '75ch',
    bg: '#f4ecd8',
    fgMuted: '#6f6149',
    readingTheme: 'sepia',
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
    bg: '#f4ecd8',
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
      fontBody: root.style.getPropertyValue('--reading-font-body').trim(),
      readingTheme: root.dataset.readingTheme ?? '',
    }
  })
}
