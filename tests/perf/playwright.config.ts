import '../../scripts/lib/isolateHostEnvironment.mjs'
import { defineConfig } from '@playwright/test'

/**
 * Optional performance runs (Tide phase 4.4): not part of verify:quick or CI. They report numbers
 * instead of gating, because absolute frame times move with machine load; compare only runs from
 * the same batch on the same machine. Run with `pnpm test:perf` after `pnpm build`.
 */
process.env['OPENCOVE_E2E_WINDOW_MODE'] = process.env['OPENCOVE_E2E_WINDOW_MODE'] ?? 'offscreen'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.perf.ts',
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/perf',
  projects: [{ name: 'electron', use: { screenshot: 'off', video: 'off', trace: 'off' } }],
})
