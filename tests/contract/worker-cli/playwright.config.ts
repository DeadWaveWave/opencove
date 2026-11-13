import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// A developer may invoke this runner inside a granted OpenCove terminal. Each test must
// discover its own profile or receive its own PTY grant, never inherit the caller's identity.
for (const name of [
  'OPENCOVE_CONTROL_URL',
  'OPENCOVE_CONTROL_TOKEN',
  'OPENCOVE_ENV',
  'OPENCOVE_NODE_ID',
  'OPENCOVE_SESSION_ID',
  'OPENCOVE_PROJECT_ID',
  'OPENCOVE_SPACE_ID',
  'OPENCOVE_MOUNT_ID',
  'OPENCOVE_ENDPOINT_ID',
  'OPENCOVE_USER_DATA_DIR',
]) {
  delete process.env[name]
}
// Playwright sets FORCE_COLOR in workers; Node otherwise prints a conflicting-color warning
// into stderr, which is part of the CLI's exact JSON/error contract.
delete process.env.NO_COLOR

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
