import { expect, type Page, test } from '@playwright/test'

test.describe('PWA install and offline shell', () => {
  test('exposes the expected manifest and install metadata', async ({ page }) => {
    await page.goto('/')

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifestHref).toBe('/manifest.webmanifest')

    const manifest = await page.evaluate(async (href) => {
      const response = await fetch(href)
      return response.json()
    }, manifestHref)

    expect(manifest).toMatchObject({
      name: 'miru — 安静地阅读 Markdown',
      short_name: 'miru',
      lang: 'zh-CN',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#fbf8f1',
      theme_color: '#fbf8f1',
    })
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src: '/icons/icon-192.png',
        sizes: '192x192',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/icon-512.png',
        sizes: '512x512',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        purpose: 'maskable',
      }),
    ]))

    for (const icon of manifest.icons) {
      const response = await page.request.get(new URL(icon.src, page.url()).toString())
      expect(response.ok()).toBe(true)
      expect(response.headers()['content-type']).toContain('image/png')
    }

    await expect(page.getByText(/安装 miru/)).toHaveCount(0)
  })

  test('serves the app shell offline without caching user or remote content', async ({ page, context }) => {
    await page.goto('/')
    await waitForServiceWorkerReady(page)
    await page.reload({ waitUntil: 'load' })
    await waitForServiceWorkerController(page)

    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
    await expect(page.getByTestId('floating-affordance-button')).toBeVisible()

    await pasteText(page, '# Offline paste\n\nLocal content still works.')
    await expect(page.getByRole('heading', { name: 'Offline paste' })).toBeVisible()
    await expect(page.getByText('Local content still works.')).toBeVisible()

    await page.getByTestId('floating-affordance-button').click()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /打开文件/ }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles({
      name: 'offline-file.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Offline file\n\nFile content still works.'),
    })
    await expect(page.getByRole('heading', { name: 'Offline file' })).toBeVisible()
    await expect(page.getByText('File content still works.')).toBeVisible()

    await pasteText(page, 'https://example.com/offline.md')
    const menu = page.getByTestId('floating-affordance-menu')
    await expect(page.getByRole('heading', { name: 'Offline file' })).toBeVisible()
    await expect(menu).toBeVisible()
    await expect(menu.getByText('可能是跨域限制、离线或链接失效。可以复制 raw 内容后粘贴进 miru。')).toBeVisible()

    const cachedUrls = await readCachedUrls(page)
    const pageOrigin = new URL(page.url()).origin
    const cachedPaths = cachedUrls.map(url => new URL(url).pathname)
    expect(cachedUrls.length).toBeGreaterThan(0)
    expect(cachedUrls.every(url => new URL(url).origin === pageOrigin)).toBe(true)
    expect(cachedPaths.some(pathname => pathname === '/' || pathname === '/index.html')).toBe(true)
    expect(cachedUrls.some(url => url.includes('example.com'))).toBe(false)
    expect(cachedUrls.some(url => url.includes('Offline%20file'))).toBe(false)
  })
})

async function waitForServiceWorkerReady(page: Page) {
  await expect.poll(() => serviceWorkerStatus(page), { timeout: 15_000 }).toMatchObject({
    ready: true,
  })
}

async function waitForServiceWorkerController(page: Page) {
  await expect.poll(async () => (await serviceWorkerStatus(page)).controlled, { timeout: 15_000 }).toBe(true)
}

async function serviceWorkerStatus(page: Page) {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return { ready: false, controlled: false }
    }

    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | null>(resolve => setTimeout(() => resolve(null), 2_000)),
    ])

    return {
      ready: Boolean(registration?.active),
      controlled: Boolean(navigator.serviceWorker.controller),
    }
  })
}

async function readCachedUrls(page: Page) {
  return page.evaluate(async () => {
    const cacheNames = await caches.keys()
    const urls: string[] = []

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName)
      const requests = await cache.keys()
      urls.push(...requests.map(request => request.url))
    }

    return urls.sort()
  })
}

async function pasteText(page: Page, text: string) {
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
