import { expect, type Locator, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { pasteText } from './support/reader'

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
  await expect(page.getByTestId('reading-settings-main-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: '文字' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '版面' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '预设' })).toBeVisible()

  await page.getByRole('button', { name: /管理预设/ }).click()
  await expect(page.getByTestId('reading-settings-presets-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: '管理预设' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回阅读设置' })).toBeFocused()
  await page.getByRole('button', { name: '返回阅读设置' }).click()
  await expect(page.getByTestId('reading-settings-main-panel')).toBeVisible()

  const fontSizeSlider = page.getByRole('slider', { name: '字号' })
  await expect(fontSizeSlider).toHaveAttribute('aria-valuetext', '字号 18px')

  await fontSizeSlider.press('ArrowRight')
  await fontSizeSlider.press('ArrowRight')
  await expect(fontSizeSlider).toHaveAttribute('aria-valuetext', '字号 20px')
  await page.getByRole('radio', { name: '行宽 宽' }).click()
  await page.getByRole('radio', { name: '字间距 松' }).click()
  await page.getByRole('radio', { name: '段间距 松' }).click()
  await page.getByRole('radio', { name: '页边距 宽松' }).click()
  await page.getByRole('radio', { name: '配色 Sepia' }).click()
  await page.getByRole('radio', { name: '对比 醒目' }).click()
  await page.getByRole('radio', { name: '正文字体 系统无衬线' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    measure: '75ch',
    letterSpacing: '0.03em',
    paragraphGap: '1.55em',
    pageMargin: 'clamp(2rem, 7vw, 6rem)',
    bg: '#efe1bd',
    fg: '#2a2012',
    fgMuted: '#3e3220',
    rule: '#ab8b48',
    codeBg: '#e2cb99',
    fontBody: '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    readingStyle: 'brutal',
    readingScheme: 'sepia',
    readingContrast: 'strong',
  })
  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 20,
    paragraphLetterSpacing: 0.6,
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
    letterSpacing: '0.03em',
    paragraphGap: '1.55em',
    pageMargin: 'clamp(2rem, 7vw, 6rem)',
    bg: '#efe1bd',
    fg: '#2a2012',
    fgMuted: '#3e3220',
    rule: '#ab8b48',
    codeBg: '#e2cb99',
    readingStyle: 'brutal',
    readingScheme: 'sepia',
    readingContrast: 'strong',
  })
  await expect.poll(() => readReadingTypography(page)).toMatchObject({
    body: 20,
    paragraphLetterSpacing: 0.6,
  })

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: '恢复默认' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '',
    measure: '',
    letterSpacing: '',
    paragraphGap: '',
    pageMargin: '',
    bg: '',
    fontBody: '',
    readingStyle: 'brutal',
    readingScheme: 'system',
    readingContrast: '',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#fcf6ea',
    appBg: 'rgb(252, 246, 234)',
  })
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
})

test('loads curated optional reading fonts only after selection', async ({ page }) => {
  const optionalFontRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/fonts/optional/')) {
      optionalFontRequests.push(pathname)
    }
  })
  const previewFontRequests = () => optionalFontRequests.filter(pathname => pathname.includes('preview'))
  const fullFontRequests = () => optionalFontRequests.filter(pathname => !pathname.includes('preview') && !pathname.includes('LICENSES'))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'miru' })).toBeVisible()
  expect(optionalFontRequests).toHaveLength(0)

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '正文字体 Literata' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '正文字体 霞鹜文楷' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '正文字体 Atkinson Hyperlegible' })).toBeVisible()
  await expect.poll(() => previewFontRequests().length).toBeGreaterThanOrEqual(3)
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('radio', { name: '正文字体 Atkinson Hyperlegible' }).click()
  await expect.poll(() => fullFontRequests().filter(pathname => pathname.includes('atkinson-hyperlegible')).length).toBeGreaterThanOrEqual(2)
  expect(fullFontRequests().some(pathname => pathname.includes('literata'))).toBe(false)
  expect(fullFontRequests().some(pathname => pathname.includes('lxgw-wenkai'))).toBe(false)

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '"Atkinson Hyperlegible", -apple-system, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  })

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persisted.fontFamily).toBeUndefined()
  expect(persisted.tokenOverrides['--reading-font-body']).toContain('"Atkinson Hyperlegible"')
})

test('confirms the LXGW WenKai large optional font before loading the full package', async ({ page }) => {
  const optionalFontRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/fonts/optional/')) {
      optionalFontRequests.push(pathname)
    }
  })
  const fullFontRequests = () => optionalFontRequests.filter(pathname => !pathname.includes('preview') && !pathname.includes('LICENSES'))

  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '正文字体 霞鹜文楷' })).toBeVisible()
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await expect(page.getByTestId('optional-font-download-confirm')).toContainText('约 8.8MB')
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByTestId('optional-font-download-confirm')).toHaveCount(0)
  expect(fullFontRequests()).toHaveLength(0)

  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await page.getByTestId('optional-font-download-accept').click()
  await expect.poll(() => fullFontRequests().filter(pathname => pathname.includes('lxgw-wenkai-300-normal')).length).toBe(1)

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '"LXGW WenKai", "Songti SC", "Noto Serif CJK SC", serif',
  })

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  const confirmedFonts = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:confirmed-optional-fonts:v1') ?? '[]'))

  expect(persistedSettings.fontFamily).toBeUndefined()
  expect(persistedSettings.tokenOverrides['--reading-font-body']).toContain('"LXGW WenKai"')
  expect(confirmedFonts).toContain('lxgw-wenkai')

  await page.getByRole('radio', { name: '正文字体 Newsreader' }).click()
  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await expect(page.getByTestId('optional-font-download-confirm')).toHaveCount(0)
})

test('keeps LXGW WenKai confirmation open when the large font download fails', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const testWindow = window as Window & { __miruOptionalFontLoadFailures?: string[] }
    testWindow.__miruOptionalFontLoadFailures = ['lxgw-wenkai']
  })

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '正文字体 霞鹜文楷' }).click()
  await page.getByTestId('optional-font-download-accept').click()

  await expect(page.getByTestId('optional-font-download-confirm')).toBeVisible()
  await expect(page.getByText('字体加载失败,请检查网络后重试。')).toBeVisible()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '',
  })

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  const confirmedFonts = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:confirmed-optional-fonts:v1') ?? '[]'))

  expect(persistedSettings.tokenOverrides?.['--reading-font-body']).toBeUndefined()
  expect(confirmedFonts).not.toContain('lxgw-wenkai')
})

test('uploads, persists, and safely deletes local reading fonts without third-party requests', async ({ page }) => {
  const requestHosts = new Set<string>()
  page.on('request', (request) => {
    requestHosts.add(new URL(request.url()).host)
  })

  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()

  const uploadedFontName = 'space-mono-latin-400-normal'
  const fontPath = fileURLToPath(import.meta.resolve('@ayingott/theme/fonts/space-mono-latin-400-normal.woff2'))
  await page.getByTestId('local-font-file-input').setInputFiles(fontPath)

  const uploadedFontRadio = page.getByRole('radio', { name: `正文字体 ${uploadedFontName}` })
  await expect(uploadedFontRadio).toBeVisible()
  await expect(uploadedFontRadio).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(`已添加字体「${uploadedFontName}」。`)).toBeVisible()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: expect.stringContaining('MiruLocalFont'),
  })

  const fontStack = (await readInlineReadingTokens(page)).fontBody
  expect(fontStack).toContain('"Songti SC"')
  expect(fontStack).toContain('"Noto Serif CJK SC"')

  const persistedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persistedSettings.fontFamily).toMatch(/^local:font-/)
  expect(persistedSettings.tokenOverrides['--reading-font-body']).toContain('MiruLocalFont')

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.getByLabel('存为预设').fill('Uploaded face')
  await page.getByRole('button', { name: '保存' }).click()
  const persistedPresets = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v2') ?? '{}'))
  expect(persistedPresets.presets[0].settings.fontFamily).toBe(persistedSettings.fontFamily)

  await page.reload()
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: `正文字体 ${uploadedFontName}` })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: /管理我的字体/ }).click()
  await expect(page.getByTestId('reading-settings-fonts-panel')).toBeVisible()

  const uploadedFontRow = page.locator('.reading-settings__saved-preset').filter({ hasText: uploadedFontName })
  await uploadedFontRow.getByRole('button', { name: '重命名' }).click()
  const localFontRenameInput = page.getByLabel(`重命名字体 ${uploadedFontName}`)
  await enterComposingText(localFontRenameInput, 'xin')
  await expect(localFontRenameInput).toBeVisible()
  await expect(localFontRenameInput).toHaveValue('xin')
  await finishComposingText(localFontRenameInput, '新字体')
  await localFontRenameInput.press('Enter')

  const renamedFontRow = page.locator('.reading-settings__saved-preset').filter({ hasText: '新字体' })
  await expect(renamedFontRow).toBeVisible()
  await renamedFontRow.getByRole('button', { name: '删除' }).click()
  await expect(renamedFontRow).toHaveAttribute('data-pending-delete', 'true')
  await renamedFontRow.getByRole('button', { name: '确认删除' }).click()
  await expect(renamedFontRow).toHaveCount(0)
  await page.getByRole('button', { name: '返回阅读设置' }).click()

  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '',
  })

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.locator('.reading-settings__saved-preset').filter({ hasText: 'Uploaded face' }).getByRole('button', { name: '应用' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontBody: '',
  })

  const devServerHost = new URL(page.url()).host
  expect([...requestHosts].every(host => host === devServerHost)).toBe(true)
})

test('rejects malformed local font uploads without changing the current font', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await page.getByTestId('reading-settings-button').click()

  await page.getByTestId('local-font-file-input').setInputFiles({
    name: 'broken.woff2',
    mimeType: 'font/woff2',
    buffer: Buffer.from('not a valid font'),
  })

  const fontError = page.getByText('字体无法解析,请换一个字体文件。')
  await expect(fontError).toBeVisible()
  const fontErrorColors = await fontError.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(fontErrorColors.fg, fontErrorColors.bg)).toBeGreaterThanOrEqual(4.5)
  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
})

test('theme style and color scheme switch independently while preserving OS following', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题风格 Default' }).click()
  await page.getByRole('radio', { name: '配色 深色' }).click()
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#121019',
    appBg: 'rgb(18, 16, 25)',
    codeBg: 'rgb(42, 38, 53)',
  })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('radio', { name: '配色 Sepia' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#efe1bd',
    readingStyle: 'default',
    readingScheme: 'sepia',
  })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#efe1bd')

  await page.getByRole('radio', { name: '配色 跟随系统' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '',
    readingStyle: 'default',
    readingScheme: 'system',
  })
  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#121019',
    appBg: 'rgb(18, 16, 25)',
  })
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121019')

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persisted).toMatchObject({
    version: 2,
    themeStyle: 'default',
    colorScheme: 'system',
  })
  expect(persisted.tokenOverrides).toBeUndefined()
})

test('defaults to Brutal, can switch to Default, and applies Theme structural roles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  const root = page.locator('html')

  await expect(root).toHaveAttribute('data-reading-style', 'brutal')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).toHaveClass(/\bbrutal\b/)
  await expect(root).not.toHaveClass(/\bdark\b/)
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()

  await page.getByTestId('reading-settings-button').click()
  const brutalTheme = page.getByRole('radio', { name: '主题风格 Brutal' })
  const settingsPanel = page.getByTestId('reading-settings-panel')

  await expect(brutalTheme).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '',
    readingStyle: 'brutal',
    readingScheme: 'system',
  })
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#fcf6ea',
    fg: '#111',
    fgMuted: '#3a3429',
    accent: '#ffd02f',
    accentText: '#3d5afe',
    rule: '#111',
  })
  await expect(settingsPanel).toHaveCSS('border-radius', '0px')
  await expect(settingsPanel).toHaveCSS('border-top-width', '3px')
  await expect(settingsPanel).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(settingsPanel).not.toHaveCSS('box-shadow', 'none')
  await expect(page.getByTestId('reading-settings')).toHaveCSS('z-index', '10')

  const lightColors = await readComputedReadingColors(page)
  expect(contrastRatio(lightColors.fg, lightColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(lightColors.accentText, lightColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.emulateMedia({ colorScheme: 'dark' })

  await expect(root).toHaveClass(/\bdark\b/)
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#161412',
    fg: '#f5f2ea',
    fgMuted: '#e7dfd2',
    accent: '#ffd02f',
    accentText: '#c3a6ff',
    rule: '#f5f2ea',
  })
  await expect(settingsPanel).toHaveCSS('background-color', 'rgb(33, 30, 22)')

  const darkColors = await readComputedReadingColors(page)
  expect(contrastRatio(darkColors.fg, darkColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(darkColors.accentText, darkColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('radio', { name: '主题风格 Default' }).click()

  await expect(root).toHaveAttribute('data-reading-style', 'default')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).not.toHaveClass(/\bbrutal\b/)
  await expect(root).toHaveClass(/\bdark\b/)
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#121019',
    fg: '#f7f1e6',
    fgMuted: '#d7cdbc',
    accent: '#c7b6f5',
    accentText: '#c7b6f5',
  })

  const persistedDefault = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))
  expect(persistedDefault).toMatchObject({
    version: 2,
    themeStyle: 'default',
    colorScheme: 'system',
  })
  expect(persistedDefault.tokenOverrides).toBeUndefined()

  await page.keyboard.press('Escape')
  await page.reload()

  await expect(root).toHaveAttribute('data-reading-style', 'default')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).not.toHaveClass(/\bbrutal\b/)
  await expect(root).toHaveClass(/\bdark\b/)

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题风格 Brutal' }).click()

  await expect(root).toHaveAttribute('data-reading-style', 'brutal')
  await expect(root).toHaveAttribute('data-reading-scheme', 'system')
  await expect(root).toHaveClass(/\bbrutal\b/)
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
})

test('Default contrast adjustment follows the resolved OS theme and keeps AA contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '主题风格 Default' }).click()
  await page.getByRole('radio', { name: '对比 柔和' }).click()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fg: '',
    readingStyle: 'default',
    readingScheme: 'system',
    readingContrast: 'soft',
  })

  const darkColors = await readComputedReadingColors(page)
  expect(darkColors.fg).toBe('#d7cdbc')
  expect(contrastRatio(darkColors.fg, darkColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.emulateMedia({ colorScheme: 'light' })

  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  await expect.poll(() => readComputedReadingColors(page)).toMatchObject({
    bg: '#faf8f4',
    fg: '#514a3e',
  })
  const lightColors = await readComputedReadingColors(page)
  expect(lightColors.fg).toBe('#514a3e')
  expect(contrastRatio(lightColors.fg, lightColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('radio', { name: '对比 醒目' }).click()

  const strongLightColors = await readComputedReadingColors(page)
  expect(strongLightColors.fg).toBe('#191713')
  expect(strongLightColors.fgMuted).toBe('#514a3e')
  expect(contrastRatio(strongLightColors.fg, strongLightColors.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(strongLightColors.fgMuted, strongLightColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('custom theme editor warns and auto-fixes AA contrast', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '配色 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义配色/ }).click()
  await expect(page.getByTestId('reading-settings-custom-theme-panel')).toBeVisible()

  const contrastWarning = page.locator('.reading-settings__warning')

  await page.getByLabel('自定义配色 背景').fill('#000000')
  await page.getByLabel('自定义配色 正文').fill('#222222')
  await page.getByLabel('自定义配色 强调').fill('#333333')
  await expect(contrastWarning).toHaveAttribute('data-severity', 'critical')
  const warningColors = await contrastWarning.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(warningColors.fg, warningColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByLabel('自定义配色 背景').fill('#ffffff')
  await page.getByLabel('自定义配色 正文').fill('#bbbbbb')
  await page.getByLabel('自定义配色 强调').fill('#cccccc')

  await expect(page.getByText('正文与强调色对比不足，正文几乎无法阅读。')).toBeVisible()
  await expect(contrastWarning).toHaveAttribute('data-severity', 'critical')
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#ffffff',
    fg: '#bbbbbb',
    accent: '#cccccc',
    readingStyle: 'brutal',
    readingScheme: 'custom',
  })

  await page.getByLabel('自定义配色 正文').fill('#111111')
  await expect(page.getByText('强调色对比不足，链接和重点可能不清晰。')).toBeVisible()
  await expect(contrastWarning).toHaveAttribute('data-severity', 'notice')

  await page.getByRole('button', { name: /自动修正到 AA/ }).click()

  await expect(contrastWarning).not.toBeVisible()
  const fixedTokens = await readInlineReadingTokens(page)

  expect(contrastRatio(fixedTokens.fg, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.fgMuted, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.accent, fixedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.accentContrast, fixedTokens.accent)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(fixedTokens.focus, fixedTokens.bg)).toBeGreaterThanOrEqual(3)
  expect(contrastRatio(fixedTokens.codeFg, fixedTokens.codeBg)).toBeGreaterThanOrEqual(4.5)

  const fixedComputedColors = await readComputedReadingColors(page)
  expect(contrastRatio(fixedComputedColors.accentText, fixedComputedColors.bg)).toBeGreaterThanOrEqual(4.5)

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}'))

  expect(persisted).toMatchObject({
    version: 2,
    themeStyle: 'brutal',
    colorScheme: 'custom',
  })
  expect(persisted.customTheme.bg).toBe('#ffffff')
  expect(contrastRatio(persisted.customTheme.fg, persisted.customTheme.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(persisted.customTheme.accent, persisted.customTheme.bg)).toBeGreaterThanOrEqual(4.5)

  await page.reload()

  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    bg: '#ffffff',
    readingStyle: 'brutal',
    readingScheme: 'custom',
  })
  const reloadedTokens = await readInlineReadingTokens(page)

  expect(contrastRatio(reloadedTokens.fg, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.fgMuted, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.accent, reloadedTokens.bg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(reloadedTokens.codeFg, reloadedTokens.codeBg)).toBeGreaterThanOrEqual(4.5)
})

test('keeps desktop outline focus rings readable on Custom reading palettes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'brutal',
      colorScheme: 'custom',
      customTheme: {
        bg: '#777777',
        fg: '#000000',
        accent: '#000000',
      },
    }))
  })
  await page.goto('/')

  const rail = page.getByTestId('reader-outline-rail')
  await expect(rail).toBeVisible()

  const outlineItem = rail.locator('.reader-outline__item').first()
  await page.keyboard.press('Tab')
  await outlineItem.focus()
  await expect(outlineItem).toBeFocused()

  const focusColors = await outlineItem.evaluate((element) => {
    const appShell = document.querySelector<HTMLElement>('.app-shell')
    const styles = getComputedStyle(element)

    return {
      background: appShell ? getComputedStyle(appShell).backgroundColor : '',
      outline: styles.outlineColor,
      outlineStyle: styles.outlineStyle,
    }
  })

  expect(focusColors.outlineStyle).not.toBe('none')
  expect(contrastRatio(focusColors.outline, focusColors.background)).toBeGreaterThanOrEqual(3)
})

test('keeps library chrome independent from low-contrast Custom reading colors', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'custom',
      customTheme: {
        bg: '#ffffff',
        fg: '#bbbbbb',
        accent: '#cccccc',
      },
    }))
  })
  await page.goto('/')
  await page.getByTestId('library-open-button').click()

  const appShell = page.locator('.app-shell')
  await expect(appShell).toHaveClass(/\bapp-shell--library\b/)

  const libraryColors = await page.getByTestId('library-view').evaluate((library) => {
    const shell = library.closest<HTMLElement>('.app-shell')
    const title = library.querySelector<HTMLElement>('.library-view__title')
    const intro = library.querySelector<HTMLElement>('.library-view__intro')
    const sort = library.querySelector<HTMLElement>('.library-view__sort')

    return {
      introFg: intro ? getComputedStyle(intro).color : '',
      shellBg: shell ? getComputedStyle(shell).backgroundColor : '',
      sortBg: sort ? getComputedStyle(sort).backgroundColor : '',
      sortFg: sort ? getComputedStyle(sort).color : '',
      titleFg: title ? getComputedStyle(title).color : '',
    }
  })

  expect(contrastRatio(libraryColors.titleFg, libraryColors.shellBg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(libraryColors.introFg, libraryColors.shellBg)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(libraryColors.sortFg, libraryColors.sortBg)).toBeGreaterThanOrEqual(4.5)
})

test('keeps settings status pairs readable in dark schemes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('radio', { name: '配色 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义配色/ }).click()
  await page.getByLabel('自定义配色 背景').fill('#000000')
  await page.getByLabel('自定义配色 正文').fill('#222222')
  await page.getByLabel('自定义配色 强调').fill('#333333')

  const failedContrastRow = page.locator('.reading-settings__contrast-row[data-pass="false"]').first()
  const failedRowColors = await failedContrastRow.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(failedRowColors.fg, failedRowColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByRole('button', { name: '返回阅读设置' }).click()
  const warningStatus = page.getByText('需要调整对比', { exact: true })
  const warningStatusColors = await warningStatus.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      bg: style.backgroundColor,
      fg: style.color,
    }
  })
  expect(contrastRatio(warningStatusColors.fg, warningStatusColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('keeps code and semantic panels readable with a dark Custom theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('miru:reading-settings:v2', JSON.stringify({
      version: 2,
      themeStyle: 'default',
      colorScheme: 'custom',
      customTheme: {
        bg: '#000000',
        fg: '#ffffff',
        accent: '#ffffff',
      },
    }))
  })
  await page.goto('/')

  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-reading-style', 'default')
  await expect(root).toHaveAttribute('data-reading-scheme', 'custom')
  await expect(root).toHaveClass(/\bdark\b/)

  const codeColors = await page.locator('.reader-surface__content .shiki span').first().evaluate((token) => {
    const code = token.closest<HTMLElement>('.shiki')
    return {
      bg: code ? getComputedStyle(code).backgroundColor : '',
      fg: getComputedStyle(token).color,
    }
  })
  expect(contrastRatio(codeColors.fg, codeColors.bg)).toBeGreaterThanOrEqual(4.5)

  await page.getByTestId('reader-outline-button').click()
  const outlineColors = await page.getByTestId('reader-outline-panel').evaluate((panel) => {
    const title = panel.querySelector<HTMLElement>('.reader-outline__title')
    return {
      bg: getComputedStyle(panel).backgroundColor,
      fg: title ? getComputedStyle(title).color : '',
    }
  })
  expect(contrastRatio(outlineColors.fg, outlineColors.bg)).toBeGreaterThanOrEqual(4.5)
  await page.getByRole('button', { name: '关闭文档大纲' }).click()

  await pasteText(page, '# Custom surface\n\nDark custom content.')
  await page.getByTestId('library-open-button').click()

  const entry = page.getByTestId('library-entry').filter({ hasText: 'Custom surface' })
  await entry.getByRole('button', { name: 'Custom surface 更多操作' }).click()
  const menu = entry.getByRole('menu')
  const menuColors = await menu.evaluate((element) => {
    const item = element.querySelector<HTMLElement>('.library-entry__menu-item:not(.library-entry__menu-item--danger)')
    return {
      bg: getComputedStyle(element).backgroundColor,
      fg: item ? getComputedStyle(item).color : '',
    }
  })
  expect(contrastRatio(menuColors.fg, menuColors.bg)).toBeGreaterThanOrEqual(4.5)

  await menu.getByRole('menuitem', { name: '删除' }).click()
  const dialog = page.getByRole('dialog', { name: /删除「Custom surface」/ })
  const dialogColors = await dialog.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.library-dialog__panel')
    const title = element.querySelector<HTMLElement>('.library-dialog__title')
    return {
      bg: panel ? getComputedStyle(panel).backgroundColor : '',
      fg: title ? getComputedStyle(title).color : '',
    }
  })
  expect(contrastRatio(dialogColors.fg, dialogColors.bg)).toBeGreaterThanOrEqual(4.5)
})

test('does not save a reading preset during IME composition', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: /管理预设/ }).click()

  const presetNameInput = page.getByLabel('存为预设')
  await enterComposingText(presetNameInput, 'ni')

  await expect(presetNameInput).toHaveValue('ni')
  await expect(page.locator('.reading-settings__saved-preset')).toHaveCount(0)

  await finishComposingText(presetNameInput, '你')
  await presetNameInput.press('Enter')

  const savedPreset = page.locator('.reading-settings__saved-preset').filter({ hasText: '你' })
  await expect(savedPreset).toBeVisible()
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v2') ?? '{}'))
  expect(persisted.presets).toHaveLength(1)
  expect(persisted.presets[0].name).toBe('你')

  await savedPreset.getByRole('button', { name: '重命名' }).click()
  const presetRenameInput = page.getByLabel('重命名预设 你')
  await enterComposingText(presetRenameInput, 'ni hao')
  await expect(presetRenameInput).toBeVisible()
  await expect(presetRenameInput).toHaveValue('ni hao')
  await finishComposingText(presetRenameInput, '你好')
  await presetRenameInput.press('Enter')

  await expect(page.locator('.reading-settings__saved-preset').filter({ hasText: '你好' })).toBeVisible()
  const renamedPersisted = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v2') ?? '{}'))
  expect(renamedPersisted.presets[0].name).toBe('你好')
})

test('saves, applies, renames, and deletes reading presets', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('reading-settings-button').click()

  const fontSizeSlider = page.getByRole('slider', { name: '字号' })
  await fontSizeSlider.press('ArrowRight')
  await fontSizeSlider.press('ArrowRight')
  await page.getByRole('radio', { name: '字间距 松' }).click()
  await page.getByRole('radio', { name: '配色 自定义' }).click()
  await page.getByRole('button', { name: /编辑自定义配色/ }).click()
  await page.getByLabel('自定义配色 背景').fill('#ffffff')
  await page.getByLabel('自定义配色 正文').fill('#111111')
  await page.getByLabel('自定义配色 强调').fill('#767676')
  await page.getByRole('button', { name: '返回阅读设置' }).click()

  await page.getByRole('button', { name: /管理预设/ }).click()
  await page.getByLabel('存为预设').fill('Focus preset')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' })).toBeVisible()
  await page.getByLabel('存为预设').fill('Focus preset')
  await expect(page.getByText('已有同名预设，不会覆盖。')).toBeVisible()

  const persistedAfterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-presets:v2') ?? '{}'))
  expect(persistedAfterSave.presets).toHaveLength(1)
  expect(persistedAfterSave.presets[0].name).toBe('Focus preset')
  expect(persistedAfterSave.presets[0].settings).toMatchObject({
    fontSize: '20',
    letterSpacing: 'loose',
    themeStyle: 'brutal',
    colorScheme: 'custom',
    customTheme: {
      bg: '#ffffff',
      fg: '#111111',
      accent: '#767676',
    },
  })

  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '',
    letterSpacing: '',
    bg: '',
    readingStyle: 'brutal',
    readingScheme: 'system',
  })

  await page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' }).getByRole('button', { name: '应用' }).click()
  await expect.poll(() => readInlineReadingTokens(page)).toMatchObject({
    fontSize: '20px',
    letterSpacing: '0.03em',
    bg: '#ffffff',
    fg: '#111111',
    accent: '#767676',
    readingStyle: 'brutal',
    readingScheme: 'custom',
  })
  await expect(page.getByText('当前: Focus preset')).toBeVisible()

  const savedPreset = page.locator('.reading-settings__saved-preset').filter({ hasText: 'Focus preset' })
  await savedPreset.getByRole('button', { name: '重命名' }).click()
  await page.getByLabel('重命名预设 Focus preset').fill('Deep focus')
  await page.locator('.reading-settings__saved-preset').getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.reading-settings__saved-preset').filter({ hasText: 'Deep focus' })).toBeVisible()
  await expect(page.getByText('当前: Deep focus')).toBeVisible()

  const renamedPreset = page.locator('.reading-settings__saved-preset').filter({ hasText: 'Deep focus' })
  await renamedPreset.getByRole('button', { name: '删除' }).click()
  await expect(renamedPreset).toHaveAttribute('data-pending-delete', 'true')
  await renamedPreset.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('Deep focus')).not.toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('miru:reading-presets:v2'))).toBeNull()
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
  await expect(page.getByRole('radio', { name: '正文字体 Newsreader' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(page.getByTestId('reading-settings-button')).toBeFocused()
})

test('contains reading settings panel scroll chaining on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await pasteText(page, [
    '# Long settings panel doc',
    '',
    Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Long settings panel doc' })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 360))
  const pageScrollBefore = await page.evaluate(() => Math.round(window.scrollY))
  expect(pageScrollBefore).toBeGreaterThan(250)

  await page.getByTestId('reading-settings-button').click()
  const panel = page.getByTestId('reading-settings-panel')
  await expect(panel).toBeVisible()
  await expect.poll(() => panel.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe('contain')
  await expect.poll(() => panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)

  const panelBox = await panel.boundingBox()
  expect(panelBox).not.toBeNull()
  await page.mouse.move(panelBox!.x + panelBox!.width / 2, panelBox!.y + panelBox!.height / 2)

  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const panelScrollBottom = await panel.evaluate(element => Math.round(element.scrollTop))
  expect(panelScrollBottom).toBeGreaterThan(0)

  await page.mouse.wheel(0, 1200)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(pageScrollBefore)
  await expect.poll(() => panel.evaluate(element => Math.round(element.scrollTop))).toBe(panelScrollBottom)

  await panel.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.mouse.wheel(0, -1200)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(pageScrollBefore)
  await expect.poll(() => panel.evaluate(element => Math.round(element.scrollTop))).toBe(0)
})

test('locks page scroll while mobile command sheets are open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await pasteText(page, [
    '# Scroll lock doc',
    '',
    '## First section',
    '',
    '## Second section',
    '',
    '### Third section',
    '',
    Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Scroll lock doc' })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, 520))
  const scrollBeforeSettings = await page.evaluate(() => Math.round(window.scrollY))
  expect(scrollBeforeSettings).toBeGreaterThan(300)

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByTestId('reading-settings-panel')).toBeVisible()
  await expect(page.getByTestId('command-scrim')).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reading-settings-panel')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeSettings)

  await page.getByTestId('floating-affordance-button').click()
  await expect(page.getByTestId('floating-affordance-menu')).toBeVisible()
  await expect(page.getByTestId('command-scrim')).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('floating-affordance-menu')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeSettings)

  await page.getByTestId('reader-outline-button').click()
  await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
  await expect(page.getByTestId('command-scrim')).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeSettings}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await page.getByTestId('command-scrim').click({ position: { x: 20, y: 20 } })
  await expect(page.getByTestId('reader-outline-panel')).not.toBeVisible()
  await expect(page.getByTestId('reader-outline-button')).toBeFocused()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed')
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeSettings)
})

test('uses a full-width outline sheet scrim on tablet and system dark', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await pasteText(page, [
    '# Tablet outline',
    '',
    '## First section',
    '',
    '## Second section',
    '',
    '### Third section',
    '',
    Array.from({ length: 48 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))
  await expect(page.getByRole('heading', { name: 'Tablet outline' })).toBeVisible()
  await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  await expect(page.getByTestId('reader-outline')).toHaveCount(0)

  async function readOutlineScrimStyle(): Promise<{ animationName: string, backgroundColor: string }> {
    await page.getByTestId('reader-outline-button').click()
    await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
    await expect(page.getByTestId('command-scrim')).toBeVisible()

    return page.evaluate(() => {
      const scrim = document.querySelector<HTMLElement>('[data-testid="command-scrim"]')
      const style = scrim ? getComputedStyle(scrim) : null

      return {
        animationName: style?.animationName ?? '',
        backgroundColor: style?.backgroundColor ?? '',
      }
    })
  }

  async function closeOutlineScrim(): Promise<void> {
    await page.getByTestId('command-scrim').click({ position: { x: 24, y: 24 } })
    await expect(page.getByTestId('reader-outline-panel')).not.toBeVisible()
    await expect(page.getByTestId('reader-outline-button')).toBeFocused()
  }

  async function selectReadingOption(name: string): Promise<void> {
    await page.getByTestId('reading-settings-button').click()
    await expect(page.getByTestId('reading-settings-panel')).toBeVisible()
    await page.getByRole('radio', { name }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('reading-settings-panel')).not.toBeVisible()
  }

  await page.evaluate(() => window.scrollTo(0, 520))
  const scrollBeforeOutline = await page.evaluate(() => Math.round(window.scrollY))
  expect(scrollBeforeOutline).toBeGreaterThan(300)

  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
  await expect(page.locator('html')).toHaveClass(/\bbrutal\b/)
  expect(await readOutlineScrimStyle()).toMatchObject({
    animationName: expect.stringContaining('command-scrim-fade'),
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).top)).toBe(`-${scrollBeforeOutline}px`)

  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="reader-outline-panel"]')

    return {
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
    }
  })

  expect(layout.panelWidth).toBeGreaterThan(740)

  await page.mouse.wheel(0, 800)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${scrollBeforeOutline}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)

  await closeOutlineScrim()
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrollBeforeOutline)

  await selectReadingOption('配色 浅色')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'light')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await selectReadingOption('配色 Sepia')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'sepia')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await page.emulateMedia({ colorScheme: 'light' })
  await selectReadingOption('配色 深色')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.4)')
  await closeOutlineScrim()

  await selectReadingOption('主题风格 Default')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'dark')
  await expect(page.locator('html')).not.toHaveClass(/\bbrutal\b/)
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.4)')
  await closeOutlineScrim()

  await selectReadingOption('配色 跟随系统')
  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'default')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
  expect((await readOutlineScrimStyle()).backgroundColor).toBe('rgba(0, 0, 0, 0.28)')
  await closeOutlineScrim()

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  expect(await readOutlineScrimStyle()).toMatchObject({
    animationName: 'none',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  })
  await closeOutlineScrim()
})

test('default Brutal follows OS color scheme changes for reading and code surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-reading-style', 'brutal')
  await expect(page.locator('html')).toHaveAttribute('data-reading-scheme', 'system')
  await expect(page.locator('.reader-surface__content')).toBeVisible()

  const lightTheme = await readThemeSnapshot(page)
  const lightTypography = await readReadingTypography(page)

  await page.emulateMedia({ colorScheme: 'dark' })

  await expect.poll(() => readThemeSnapshot(page)).toMatchObject({
    readingBg: '#161412',
    appBg: 'rgb(22, 20, 18)',
    codeBg: 'rgb(58, 52, 39)',
  })

  const darkTheme = await readThemeSnapshot(page)
  const darkTypography = await readReadingTypography(page)

  expect(lightTheme.readingBg).toBe('#fcf6ea')
  expect(darkTheme.shikiColor).not.toBe(lightTheme.shikiColor)
  expect(darkTypography).toEqual(lightTypography)
})

async function enterComposingText(input: Locator, value: string): Promise<void> {
  await input.evaluate((element, composingValue) => {
    const field = element as HTMLInputElement
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    field.value = composingValue
    field.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: composingValue,
      inputType: 'insertCompositionText',
      isComposing: true,
    }))
    field.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      isComposing: true,
    }))
  }, value)
}

async function finishComposingText(input: Locator, value: string): Promise<void> {
  await input.evaluate((element, composedValue) => {
    const field = element as HTMLInputElement
    field.value = composedValue
    field.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: composedValue,
    }))
  }, value)
}

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
      letterSpacing: root.style.getPropertyValue('--reading-letter-spacing').trim(),
      paragraphGap: root.style.getPropertyValue('--reading-paragraph-gap').trim(),
      pageMargin: root.style.getPropertyValue('--reading-page-margin').trim(),
      bg: root.style.getPropertyValue('--reading-bg').trim(),
      fg: root.style.getPropertyValue('--reading-fg').trim(),
      fgMuted: root.style.getPropertyValue('--reading-fg-muted').trim(),
      accent: root.style.getPropertyValue('--reading-accent').trim(),
      accentContrast: root.style.getPropertyValue('--reading-accent-contrast').trim(),
      focus: root.style.getPropertyValue('--reading-focus').trim(),
      rule: root.style.getPropertyValue('--reading-rule').trim(),
      codeFg: root.style.getPropertyValue('--reading-code-fg').trim(),
      codeBg: root.style.getPropertyValue('--reading-code-bg').trim(),
      fontBody: root.style.getPropertyValue('--reading-font-body').trim(),
      readingStyle: root.dataset.readingStyle ?? '',
      readingScheme: root.dataset.readingScheme ?? '',
      readingContrast: root.dataset.readingContrast ?? '',
    }
  })
}

async function readReadingTypography(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const readPx = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0
    }
    const readLetterSpacingPx = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? Number.parseFloat(getComputedStyle(element).letterSpacing) : 0
    }

    return {
      body: readPx('.reader-surface__content'),
      h1: readPx('.reader-surface__content h1'),
      h2: readPx('.reader-surface__content h2'),
      h3: readPx('.reader-surface__content h3'),
      h4: readPx('.reader-surface__content h4'),
      paragraphLetterSpacing: readLetterSpacingPx('.reader-surface__content p'),
    }
  })
}

async function readComputedReadingColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement)

    return {
      bg: rootStyle.getPropertyValue('--reading-bg').trim(),
      fg: rootStyle.getPropertyValue('--reading-fg').trim(),
      fgMuted: rootStyle.getPropertyValue('--reading-fg-muted').trim(),
      accent: rootStyle.getPropertyValue('--reading-accent').trim(),
      accentText: rootStyle.getPropertyValue('--reading-accent-text').trim(),
      accentContrast: rootStyle.getPropertyValue('--reading-accent-contrast').trim(),
      rule: rootStyle.getPropertyValue('--reading-rule').trim(),
    }
  })
}

function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA)
  const luminanceB = relativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = parseRgbColor(color).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function parseRgbColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const raw = color.slice(1)
    const normalized = raw.length === 3
      ? raw.split('').map(channel => `${channel}${channel}`).join('')
      : raw

    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
    ]
  }

  const channels = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number)

  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported color format: ${color}`)
  }

  return [channels[0]!, channels[1]!, channels[2]!]
}
