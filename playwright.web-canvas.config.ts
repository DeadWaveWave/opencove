import './scripts/lib/isolateHostEnvironment.mjs'
import { defineConfig } from '@playwright/test'
import { resolveE2ERetries } from './scripts/lib/e2e-retries.mjs'

const baseURL = process.env['OPENCOVE_WEB_CANVAS_BASE_URL']

export default defineConfig({
  testDir: './tests/e2e-web-canvas',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  retries: resolveE2ERetries(process.env.OPENCOVE_E2E_RETRIES),
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-web-canvas' }]],
  outputDir: './test-results-web-canvas',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
})
