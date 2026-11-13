import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

for (const file of ['out/main/worker.js', 'out/cli/opencove.mjs']) {
  if (!existsSync(resolve(file))) throw new Error(`Run pnpm build first: missing ${file}`)
}

// Playwright supplies polling, isolation and repeats, but no browser or Desktop is launched.
// The Worker subprocess uses Electron's Node ABI and the existing postinstall native modules.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../test-results/worker-cli',
})
