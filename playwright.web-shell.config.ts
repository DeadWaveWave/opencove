import { defineConfig } from '@playwright/test'

const baseURL = process.env['OPENCOVE_WEB_SHELL_BASE_URL']

export default defineConfig({
  testDir: './tests/e2e-web-shell',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-web-shell' }]],
  outputDir: './test-results-web-shell',
  projects: [
    {
      name: 'chromium',
      use: {
        baseURL,
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],
})
