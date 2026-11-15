import './scripts/lib/isolateHostEnvironment.mjs'
import { defineConfig } from '@playwright/test'
import { resolveE2ERetries } from './scripts/lib/e2e-retries.mjs'

const baseURL = process.env['OPENCOVE_WEB_CANVAS_BASE_URL']
// Playwright clears outputDir and rewrites the report when a run starts. A second run of this
// config in one job (CI runs a WebKit subset after Chromium) sets a suffix, so that a failure
// of the first run keeps its trace and its report.
const artifactSuffix = process.env['OPENCOVE_WEB_CANVAS_ARTIFACT_SUFFIX'] ?? ''

export default defineConfig({
  testDir: './tests/e2e-web-canvas',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  // A stray test.only would silently shrink a CI run to one test.
  forbidOnly: !!process.env.CI,
  retries: resolveE2ERetries(process.env.OPENCOVE_E2E_RETRIES),
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `playwright-report-web-canvas${artifactSuffix}` }],
  ],
  outputDir: `./test-results-web-canvas${artifactSuffix}`,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
})
