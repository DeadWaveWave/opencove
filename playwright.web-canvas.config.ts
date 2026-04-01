import { defineConfig } from '@playwright/test'

const baseURL = process.env['OPENCOVE_WEB_CANVAS_BASE_URL']

export default defineConfig({
  testDir: './tests/e2e-web-canvas',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-web-canvas' }]],
  outputDir: './test-results-web-canvas',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
})
