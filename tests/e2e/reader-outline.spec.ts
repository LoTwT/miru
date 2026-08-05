import { expect, test } from '@playwright/test'
import { isWideViewport, pasteText } from './support/reader'

test('collapses heading sections while preserving heading permalinks', async ({ page }) => {
  await page.goto('/')

  await page.evaluate(() => {
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
    event.clipboardData?.setData('text/plain', [
      '# First section',
      '',
      'First body.',
      '',
      '## Nested topic',
      '',
      'Nested body.',
      '',
      '# Second section',
      '',
      'Second body.',
    ].join('\n'))
    document.querySelector('main')?.dispatchEvent(event)
  })

  const firstHeading = page.getByRole('heading', { name: 'First section' })
  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  const nestedToggle = page.locator('[data-reader-heading-toggle][data-reader-heading-level="2"]').first()

  await expect(page.locator('h1#first-section a.header-anchor')).toHaveAttribute('href', '#first-section')
  await expect(page.getByRole('button', { name: '折叠「First section」章节' })).toBeVisible()
  await expect(nestedToggle).toHaveAttribute('aria-label', '折叠「Nested topic」章节')
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')

  await nestedToggle.click()

  await expect(nestedToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('Nested body.')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Second section' })).toBeVisible()

  await nestedToggle.click()
  await expect(page.getByText('Nested body.')).toBeVisible()

  await firstToggle.click()

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: '展开「First section」章节' })).toBeVisible()
  await expect(page.getByText('First body.')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nested topic' })).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Second section' })).toBeVisible()
  await expect(page.getByText('Second body.')).toBeVisible()

  await firstToggle.focus()
  await page.keyboard.press('Enter')

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('First body.')).toBeVisible()

  await page.locator('h1#first-section a.header-anchor').click()
  await expect(page).toHaveURL(/#first-section$/)
})

test('keeps heading permalinks below the sticky top bar', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Sticky anchor offset',
    '',
    Array.from({ length: 14 }, (_, index) => `Before paragraph ${index + 1}.`).join('\n\n'),
    '',
    '## Target heading',
    '',
    'Target body.',
    '',
    Array.from({ length: 40 }, (_, index) => `After paragraph ${index + 1}.`).join('\n\n'),
  ].join('\n'))

  const targetHeading = page.locator('h2#target-heading')
  await targetHeading.scrollIntoViewIfNeeded()
  await targetHeading.locator('a.header-anchor').click()
  await expect(page).toHaveURL(/#target-heading$/)

  const positions = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-testid="app-top-bar"]')
    const heading = document.querySelector<HTMLElement>('h2#target-heading')

    return {
      headerBottom: header?.getBoundingClientRect().bottom ?? 0,
      headingTop: heading?.getBoundingClientRect().top ?? 0,
    }
  })

  expect(positions.headingTop).toBeGreaterThanOrEqual(positions.headerBottom + 8)
})

test('separates heading, body link, permalink, and collapse control styles', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First body with an [external reference](https://example.com/resource).',
    '',
    '## Nested topic',
    '',
    'Nested body.',
    '',
    '### Small detail',
    '',
    'Detail body.',
    '',
    '# Second section',
    '',
    'Second body.',
  ].join('\n'))

  const h1 = page.locator('h1#first-section')
  const h2 = page.locator('h2#nested-topic')
  const h3 = page.locator('h3#small-detail')
  const h2Anchor = page.locator('h2#nested-topic > a.header-anchor')
  const bodyLink = page.locator('.reader-surface__content p a[href="https://example.com/resource"]')
  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  const h2Toggle = page.getByRole('button', { name: '折叠「Nested topic」章节' })
  const h3Toggle = page.getByRole('button', { name: '折叠「Small detail」章节' })

  for (const heading of [h1, h2, h3]) {
    await expect.poll(() => heading.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  }

  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element).color)).toBe(
    await h2.evaluate(element => getComputedStyle(element).color),
  )
  await expect.poll(() => bodyLink.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain('underline')

  await expect.poll(() => h2.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none')
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0')
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element, '::after').content)).toContain('¶')
  await h2.hover()
  if (await page.evaluate(() => window.matchMedia('(hover: hover)').matches)) {
    await expect.poll(() => h2Anchor.evaluate(element => Number(getComputedStyle(element, '::after').opacity))).toBeGreaterThan(0)
  }
  else {
    await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0')
  }

  if (await page.evaluate(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches)) {
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(0.3)
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThanOrEqual(0.35)
  }
  else {
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(0.45)
    await expect.poll(() => h2Toggle.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThanOrEqual(0.5)
  }

  await h2Anchor.focus()
  await expect.poll(() => h2Anchor.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(h2Toggle).toHaveAttribute('data-reader-heading-level', '2')
  await expect(h3Toggle).toHaveAttribute('data-reader-heading-level', '3')
  await expect.poll(() => firstToggle.evaluate(element => element.tagName)).toBe('BUTTON')
  await expect.poll(() => firstToggle.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  await expect.poll(() => firstToggle.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44)
  await expect.poll(() => firstToggle.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  await firstToggle.focus()
  await expect.poll(() => firstToggle.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await expect.poll(() => h2Toggle.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44)
  await expect.poll(() => h3Toggle.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => firstToggle.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
})

test('does not persist collapsed H1 state after reload', async ({ page }) => {
  await page.goto('/')

  const firstToggle = page.locator('[data-reader-heading-toggle]').first()

  await firstToggle.click()
  await expect(page.getByText('打开 miru，像翻开一本排版精良的小册子。')).not.toBeVisible()

  await page.reload()

  await expect(page.locator('[data-reader-heading-toggle]').first()).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('打开 miru，像翻开一本排版精良的小册子。')).toBeVisible()
})

test('shows quiet outline navigation only for heading-rich documents', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# One',
    '',
    'One body.',
    '',
    '## Two',
    '',
    'Two body.',
    '',
    '## Three',
    '',
    'Three body.',
  ].join('\n'))
  await expect(page.getByTestId('reader-outline')).toHaveCount(0)

  await pasteText(page, [
    '# One',
    '',
    'One body.',
    '',
    '## Two',
    '',
    'Two body.',
    '',
    '## Three',
    '',
    'Three body.',
    '',
    '# Four',
    '',
    'Four body.',
  ].join('\n'))

  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline')).toBeVisible()
    await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  }
  else {
    const topBar = page.getByTestId('app-top-bar')
    const outlineButton = page.getByTestId('reader-outline-button')

    await expect(page.getByTestId('reader-outline')).toHaveCount(0)
    await expect(outlineButton).toBeVisible()
    await expect(topBar.locator('[data-testid="reader-outline-button"]')).toBeVisible()
    await expect(page.locator('.reader-outline__button')).toHaveCount(0)

    const layout = await Promise.all([
      topBar.boundingBox(),
      outlineButton.boundingBox(),
    ])
    expect(layout[0]).not.toBeNull()
    expect(layout[1]).not.toBeNull()
    expect(layout[1]!.y).toBeGreaterThanOrEqual(layout[0]!.y - 1)
    expect(layout[1]!.y + layout[1]!.height).toBeLessThanOrEqual(layout[0]!.y + layout[0]!.height + 1)
  }
})

test('keeps long outline navigation scrollable without dragging reader content', async ({ page }) => {
  const longOutlineMarkdown = [
    '# Long outline',
    '',
    'Start.',
    '',
    ...Array.from({ length: 36 }, (_, index) => [
      `## Outline section ${String(index + 1).padStart(2, '0')}`,
      '',
      `Section ${index + 1} body.`,
      '',
    ].join('\n')),
    '## Final outline stop',
    '',
    'End.',
  ].join('\n')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await pasteText(page, longOutlineMarkdown)
  await expect(page.getByRole('heading', { name: 'Long outline' })).toBeVisible()
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  await expect(page.getByTestId('reader-outline').getByRole('link', { name: 'Final outline stop' })).toBeVisible()

  const desktopScrollMetrics = await page.evaluate(() => {
    const scrollBox = document.querySelector<HTMLElement>('[data-testid="reader-outline-scroll"]')
      ?? document.querySelector<HTMLElement>('[data-testid="reader-outline-rail"]')

    if (!scrollBox) {
      return { clientHeight: 0, scrollHeight: 0, scrollTop: 0 }
    }

    scrollBox.scrollTop = scrollBox.scrollHeight

    return {
      clientHeight: Math.round(scrollBox.clientHeight),
      scrollHeight: Math.round(scrollBox.scrollHeight),
      scrollTop: Math.round(scrollBox.scrollTop),
    }
  })

  expect(desktopScrollMetrics.scrollHeight).toBeGreaterThan(desktopScrollMetrics.clientHeight)
  expect(desktopScrollMetrics.scrollTop).toBeGreaterThan(0)
  await expect(page.getByTestId('reader-outline').getByRole('link', { name: 'Final outline stop' })).toBeInViewport()

  await page.evaluate(() => window.scrollTo(0, 480))
  const desktopReaderScrollBefore = await page.evaluate(() => Math.round(window.scrollY))
  await page.evaluate(() => {
    const scrollBox = document.querySelector<HTMLElement>('[data-testid="reader-outline-scroll"]')
      ?? document.querySelector<HTMLElement>('[data-testid="reader-outline-rail"]')
    if (scrollBox) {
      scrollBox.scrollTop = 0
    }
  })
  await page.getByTestId('reader-outline-rail').hover()
  await page.mouse.wheel(0, 720)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(desktopReaderScrollBefore)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await pasteText(page, longOutlineMarkdown)
  await expect(page.getByRole('heading', { name: 'Long outline' })).toBeVisible()
  const mobileReaderScrollBefore = await page.evaluate(() => Math.round(window.scrollY))

  await page.getByTestId('reader-outline-button').click()
  const panel = page.getByTestId('reader-outline-panel')
  await expect(panel).toBeVisible()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed')
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${mobileReaderScrollBefore}px`)

  const mobileScrollMetrics = await page.evaluate(() => {
    const scrollBox = document.querySelector<HTMLElement>('[data-testid="reader-outline-scroll"]')
      ?? document.querySelector<HTMLElement>('[data-testid="reader-outline-panel"]')

    if (!scrollBox) {
      return { clientHeight: 0, scrollHeight: 0, scrollTop: 0 }
    }

    scrollBox.scrollTop = scrollBox.scrollHeight

    return {
      clientHeight: Math.round(scrollBox.clientHeight),
      scrollHeight: Math.round(scrollBox.scrollHeight),
      scrollTop: Math.round(scrollBox.scrollTop),
    }
  })

  expect(mobileScrollMetrics.scrollHeight).toBeGreaterThan(mobileScrollMetrics.clientHeight)
  expect(mobileScrollMetrics.scrollTop).toBeGreaterThan(0)
  await expect(panel.getByRole('link', { name: 'Final outline stop' })).toBeInViewport()

  await page.mouse.wheel(0, 720)
  await expect.poll(() => page.evaluate(() => document.body.style.top)).toBe(`-${mobileReaderScrollBefore}px`)
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0)
})

test('keeps the active outline item visible while the reader scrolls', async ({ page }) => {
  const autoRevealMarkdown = [
    '# Active outline reveal',
    '',
    'Start.',
    '',
    ...Array.from({ length: 28 }, (_, index) => [
      `## Follow section ${String(index + 1).padStart(2, '0')}`,
      '',
      Array.from({ length: 8 }, (_, paragraphIndex) =>
        `Paragraph ${index + 1}.${paragraphIndex + 1} keeps this section tall enough for scroll-spy.`,
      ).join('\n\n'),
      '',
    ].join('\n')),
  ].join('\n')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await pasteText(page, autoRevealMarkdown)
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()

  await scrollHeadingNearTop(page, 'Follow section 24')
  await expect.poll(async () => {
    const state = await readOutlineItemState(page, 'Follow section 24')
    return Boolean(state?.isCurrent && state.isInsideScrollBox && state.scrollTop > 0)
  }).toBe(true)

  await setOutlineScrollTop(page, 0)
  await page.getByTestId('reader-outline-rail').hover()
  const pausedScrollTop = await readOutlineScrollTop(page)
  await scrollHeadingNearTop(page, 'Follow section 26')
  await expect.poll(async () => {
    const state = await readOutlineItemState(page, 'Follow section 26')
    return Boolean(state?.isCurrent)
  }).toBe(true)
  await page.waitForTimeout(260)
  await expect.poll(() => readOutlineScrollTop(page)).toBe(pausedScrollTop)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await pasteText(page, autoRevealMarkdown)
  await scrollHeadingNearTop(page, 'Follow section 20')

  await page.getByTestId('reader-outline-button').click()
  const panel = page.getByTestId('reader-outline-panel')
  await expect(panel).toBeVisible()

  await expect.poll(async () => {
    const state = await readOutlineItemState(page, 'Follow section 20')
    return Boolean(state?.isCurrent && state.isInsideScrollBox && state.scrollTop > 0)
  }).toBe(true)
  await expect.poll(() =>
    page.evaluate(() => Boolean(document.querySelector('[data-testid="reader-outline-panel"]')?.contains(document.activeElement))),
  ).toBe(true)
})

test('navigates from the outline and expands a collapsed parent section first', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First body.',
    '',
    '## Nested topic',
    '',
    'Nested body.',
    '',
    '# Second section',
    '',
    'Second body.',
    '',
    '# Third section',
    '',
    'Third body.',
  ].join('\n'))

  const firstToggle = page.locator('[data-reader-heading-toggle]').first()
  await firstToggle.click()
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Nested topic' })).not.toBeVisible()

  if (!isWideViewport(page)) {
    const outlineButton = page.getByTestId('reader-outline-button')
    const panel = page.getByTestId('reader-outline-panel')
    const firstOutlineItem = panel.getByRole('link', { name: 'First section' })

    await outlineButton.click()
    await expect(panel).toBeVisible()
    await expect(firstOutlineItem).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await expect(outlineButton).toBeFocused()

    await outlineButton.click()
    await expect(panel).toBeVisible()
    await expect(firstOutlineItem).toBeFocused()

    await page.mouse.click(12, 12)
    await expect(panel).not.toBeVisible()
    await expect(outlineButton).toBeFocused()

    await outlineButton.click()
    await expect(panel).toBeVisible()
    await expect(firstOutlineItem).toBeFocused()
  }

  await page.getByTestId('reader-outline').getByRole('link', { name: 'Nested topic' }).click()

  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('heading', { name: 'Nested topic' })).toBeVisible()
  await expect(page).toHaveURL(/#nested-topic$/)
  await expect(page.getByRole('heading', { name: 'Nested topic' })).toBeFocused()

  if (!isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline-panel')).not.toBeVisible()
    await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  }
})

test('navigates from the outline and expands nested collapsed sections', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# First section',
    '',
    'First body.',
    '',
    '## Nested topic',
    '',
    'Nested body.',
    '',
    '### Small detail',
    '',
    'Detail body.',
    '',
    '# Second section',
    '',
    'Second body.',
  ].join('\n'))

  const nestedToggle = page.locator('[data-reader-heading-toggle][data-reader-heading-level="2"]').first()
  await nestedToggle.click()
  await expect(nestedToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Small detail' })).not.toBeVisible()

  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
    await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
  }

  await page.getByTestId('reader-outline').getByRole('link', { name: 'Small detail' }).click()

  await expect(nestedToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/#small-detail$/)
  await expect(page.getByRole('heading', { name: 'Small detail' })).toBeFocused()
})

test('activates the final outline item near the page bottom', async ({ page }) => {
  await page.goto('/')

  await pasteText(page, [
    '# Overview',
    '',
    'Start here.',
    '',
    '## Details',
    '',
    Array.from({ length: 36 }, (_, index) => `Long paragraph ${index + 1}.`).join('\n\n'),
    '',
    '# Table',
    '',
    'A short section.',
    '',
    '# Privacy',
    '',
    'Another short section.',
    '',
    '# Now try',
    '',
    'The last section is intentionally short.',
  ].join('\n'))

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Now try' })).toBeVisible()

  if (isWideViewport(page)) {
    await expect(page.getByTestId('reader-outline')).toBeVisible()
    await expect(page.getByTestId('reader-outline').getByRole('link', { name: 'Now try' })).toBeVisible()
  }
  else {
    await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

  if (!isWideViewport(page)) {
    await page.getByTestId('reader-outline-button').click()
    await expect(page.getByTestId('reader-outline-panel')).toBeVisible()
  }

  await expect
    .poll(async () =>
      page
        .getByTestId('reader-outline')
        .getByRole('link', { name: 'Now try' })
        .first()
        .getAttribute('aria-current'),
    )
    .toBe('location')
})

test('persists desktop outline position and hides the control on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  const rightLayout = await readOutlineLayout(page)
  expect(rightLayout.railLeft).toBeGreaterThan(rightLayout.contentRight)

  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '大纲位置 右' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: '大纲位置 左' }).click()
  await expect(page.getByRole('radio', { name: '大纲位置 左' })).toHaveAttribute('aria-checked', 'true')

  const leftLayout = await readOutlineLayout(page)
  expect(leftLayout.railRight).toBeLessThan(leftLayout.contentLeft)
  expect(leftLayout.contentLeft - leftLayout.railRight).toBeGreaterThan(56)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('miru:reading-settings:v2') ?? '{}').outlinePosition)).toBe('left')

  await page.reload()
  await expect(page.getByTestId('reader-outline-rail')).toBeVisible()
  const persistedLeftLayout = await readOutlineLayout(page)
  expect(persistedLeftLayout.railRight).toBeLessThan(persistedLeftLayout.contentLeft)

  await page.getByTestId('reading-settings-button').click()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('miru:reading-settings:v2'))).toBeNull()
  const resetLayout = await readOutlineLayout(page)
  expect(resetLayout.railLeft).toBeGreaterThan(resetLayout.contentRight)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByTestId('reading-settings-button').click()
  await expect(page.getByRole('radio', { name: '大纲位置 左' })).toHaveCount(0)
  await expect(page.getByTestId('reader-outline-button')).toBeVisible()
  await expect(page.getByTestId('app-top-bar').locator('[data-testid="reader-outline-button"]')).toBeVisible()
})

async function readOutlineLayout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.reader-surface__content')
    const rail = document.querySelector<HTMLElement>('[data-testid="reader-outline-rail"]')

    if (!content || !rail) {
      return {
        contentLeft: 0,
        contentRight: 0,
        railLeft: 0,
        railRight: 0,
      }
    }

    const contentRect = content.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()

    return {
      contentLeft: contentRect.left,
      contentRight: contentRect.right,
      railLeft: railRect.left,
      railRight: railRect.right,
    }
  })
}

async function scrollHeadingNearTop(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.getByRole('heading', { name }).evaluate((heading) => {
    const rect = heading.getBoundingClientRect()
    window.scrollTo({
      top: rect.top + window.scrollY - 92,
      behavior: 'auto',
    })
  })
}

async function readOutlineItemState(page: import('@playwright/test').Page, label: string) {
  return page.evaluate((targetLabel) => {
    const scrollBox = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="reader-outline-scroll"]'))
      .find(element => element.getClientRects().length > 0)

    if (!scrollBox) {
      return null
    }

    const item = Array.from(scrollBox.querySelectorAll<HTMLElement>('[data-outline-item]'))
      .find(element => element.textContent?.trim() === targetLabel)

    if (!item) {
      return null
    }

    const scrollRect = scrollBox.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()

    return {
      isCurrent: item.getAttribute('aria-current') === 'location',
      isInsideScrollBox: itemRect.top >= scrollRect.top - 1 && itemRect.bottom <= scrollRect.bottom + 1,
      itemBottom: Math.round(itemRect.bottom),
      itemTop: Math.round(itemRect.top),
      scrollBottom: Math.round(scrollRect.bottom),
      scrollTop: Math.round(scrollBox.scrollTop),
      scrollViewportTop: Math.round(scrollRect.top),
    }
  }, label)
}

async function setOutlineScrollTop(page: import('@playwright/test').Page, scrollTop: number): Promise<void> {
  await page.evaluate((nextScrollTop) => {
    const scrollBox = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="reader-outline-scroll"]'))
      .find(element => element.getClientRects().length > 0)

    if (scrollBox) {
      scrollBox.scrollTop = nextScrollTop
    }
  }, scrollTop)
}

async function readOutlineScrollTop(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const scrollBox = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="reader-outline-scroll"]'))
      .find(element => element.getClientRects().length > 0)

    return Math.round(scrollBox?.scrollTop ?? 0)
  })
}
