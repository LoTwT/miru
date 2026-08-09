import { expect, type Page, test } from '@playwright/test'
import { waitForReaderReady } from './support/reader'

test.describe('PWA install and offline shell', () => {
  test('applies the default Brutal scheme before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      const bootstrap = page.locator('script[data-theme-bootstrap]')
      await expect(bootstrap).toHaveCount(1)
      expect(await bootstrap.getAttribute('src')).toBeNull()
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
      await expect(page.locator('html')).toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#161412')
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('migrates and restores a legacy dark Custom scheme before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v1', JSON.stringify({
        version: 1,
        presetId: 'custom',
        customTheme: {
          bg: '#000000',
          fg: '#ffffff',
          accent: '#ffffff',
        },
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'custom')
      await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await expect.poll(() => page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)

        return {
          bg: style.getPropertyValue('--reading-bg').trim(),
          fg: style.getPropertyValue('--reading-fg').trim(),
        }
      })).toEqual({
        bg: '#000000',
        fg: '#ffffff',
      })
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('falls back to valid legacy settings when the v2 payload is corrupt before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', '{bad json')
      localStorage.setItem('miru:reading-settings:v1', JSON.stringify({
        version: 1,
        presetId: 'dark',
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
      await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('restores a same-revision v1 projection when a v2 theme field is invalid', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'invalid',
        colorScheme: 'dark',
        compatibilityRevision: 'shared-revision',
      }))
      localStorage.setItem('miru:reading-settings:v1', JSON.stringify({
        version: 1,
        presetId: 'dark',
        themeStyle: 'default',
        colorScheme: 'dark',
        compatibilityRevision: 'shared-revision',
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
      await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('restores a rollback-era v1 edit instead of an older v2 snapshot before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'brutal',
        colorScheme: 'dark',
        contrast: 'invalid',
        compatibilityRevision: 'older-v2-snapshot',
      }))
      localStorage.setItem('miru:reading-settings:v1', JSON.stringify({
        version: 1,
        presetId: 'light',
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'light')
      await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#faf8f4')
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('preserves the v2-only style when a rollback-era writer changes typography', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'brutal',
        colorScheme: 'dark',
        contrast: 'invalid',
        compatibilityRevision: 'older-v2-snapshot',
      }))
      localStorage.setItem('miru:reading-settings:v1', JSON.stringify({
        version: 1,
        presetId: 'dark',
        tokenOverrides: {
          '--reading-font-size': '20px',
        },
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
      await expect(page.locator('html')).toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#161412')
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('restores the complete Sepia contrast palette before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'brutal',
        colorScheme: 'sepia',
        contrast: 'strong',
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'sepia')
      await expect(page.locator('html')).toHaveAttribute('data-reading-contrast', 'strong')
      await expect(page.locator('html')).toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#efe1bd')
      await expect.poll(() => page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)

        return {
          bg: style.getPropertyValue('--reading-bg').trim(),
          fg: style.getPropertyValue('--reading-fg').trim(),
          muted: style.getPropertyValue('--reading-fg-muted').trim(),
          rule: style.getPropertyValue('--reading-rule').trim(),
        }
      })).toEqual({
        bg: '#efe1bd',
        fg: '#2a2012',
        muted: '#3e3220',
        rule: '#ab8b48',
      })
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('sanitizes an incomplete Custom palette before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'brutal',
        colorScheme: 'custom',
        customTheme: {
          bg: '#000000',
          fg: 'invalid',
          accent: '#ffffff',
        },
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'custom')
      await expect(page.locator('html')).toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#faf8f4')
      await expect.poll(() => page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)

        return {
          bg: style.getPropertyValue('--reading-bg').trim(),
          fg: style.getPropertyValue('--reading-fg').trim(),
          accent: style.getPropertyValue('--reading-accent').trim(),
        }
      })).toEqual({
        bg: '#faf8f4',
        fg: '#191713',
        accent: '#66569d',
      })
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('restores a pinned Default dark scheme and its browser theme color before the app module runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'default',
        colorScheme: 'dark',
      }))
    })

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
      await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
      await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')
    }
    finally {
      releaseModule()
    }

    await navigation
  })

  test('does not replay persisted CSS values that can load external resources', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
        version: 2,
        themeStyle: 'brutal',
        colorScheme: 'sepia',
        tokenOverrides: {
          '--reading-bg': 'url(https://attacker.invalid/pixel)',
        },
      }))
    })

    const attackerRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith('https://attacker.invalid/')) {
        attackerRequests.push(request.url())
      }
    })
    await page.route('https://attacker.invalid/**', route => route.abort())

    let markModuleRequested!: () => void
    let releaseModule!: () => void
    const moduleRequested = new Promise<void>((resolve) => {
      markModuleRequested = resolve
    })
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve
    })

    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      markModuleRequested()
      await moduleGate
      await route.continue()
    })

    const navigation = page.goto('/')

    try {
      await moduleRequested
      await expect.poll(() => page.evaluate(() => {
        return document.documentElement.style.getPropertyValue('--reading-bg').trim()
      })).toBe('#efe1bd')
      expect(attackerRequests).toEqual([])
    }
    finally {
      releaseModule()
    }

    await navigation
    expect(attackerRequests).toEqual([])
  })

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
      background_color: '#fcf6ea',
      theme_color: '#fcf6ea',
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

    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        get: () => false,
      })
    })
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
    await expect(page.getByTestId('floating-affordance-button')).toBeVisible()

    await pasteText(page, '# Offline paste\n\nLocal content still works.')
    await waitForReaderReady(page, 'Offline paste')
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
    await expect(menu.getByText('联网后再试，或先粘贴 / 打开本地文件。', { exact: false })).toBeVisible()

    const cachedUrls = await readCachedUrls(page)
    const pageOrigin = new URL(page.url()).origin
    const cachedPaths = cachedUrls.map(url => new URL(url).pathname)
    expect(cachedUrls.length).toBeGreaterThan(0)
    expect(cachedUrls.every(url => new URL(url).origin === pageOrigin)).toBe(true)
    expect(cachedPaths.some(pathname => pathname === '/' || pathname === '/index.html')).toBe(true)
    expect(cachedPaths.some(pathname => /\/assets\/bricolage-grotesque-[^/]+\.woff2$/.test(pathname))).toBe(true)
    expect(cachedPaths.some(pathname => /\/assets\/space-mono-[^/]+\.woff2$/.test(pathname))).toBe(true)
    expect(cachedPaths.some(pathname => /\/assets\/PdfViewer-[^/]+\.js$/.test(pathname))).toBe(true)
    expect(cachedPaths.some(pathname => /\/assets\/literata-[^/]+\.woff2$/.test(pathname))).toBe(false)
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
