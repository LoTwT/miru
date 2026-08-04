import { defineConfig, devices } from '@playwright/test'

const loopbackNoProxy = '127.0.0.1,localhost'
const crossBrowserSmokeSpec = /cross-browser-smoke\.spec\.ts/

process.env.NO_PROXY = process.env.NO_PROXY
  ? `${process.env.NO_PROXY},${loopbackNoProxy}`
  : loopbackNoProxy
process.env.no_proxy = process.env.no_proxy
  ? `${process.env.no_proxy},${loopbackNoProxy}`
  : loopbackNoProxy

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: crossBrowserSmokeSpec,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      testIgnore: crossBrowserSmokeSpec,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'firefox-smoke',
      testMatch: crossBrowserSmokeSpec,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-smoke',
      testMatch: crossBrowserSmokeSpec,
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
