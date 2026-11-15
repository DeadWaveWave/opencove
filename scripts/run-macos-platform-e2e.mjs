#!/usr/bin/env node
import './lib/isolateHostEnvironment.mjs'

import { spawnSync } from 'node:child_process'
import { selectMacosPlatformE2E } from './lib/macos-platform-e2e.mjs'
import { QUICK_E2E_GROUPS } from './precommit-e2e-selection.mjs'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--print') || args.length > 1) {
  process.stderr.write('Usage: node scripts/run-macos-platform-e2e.mjs [--print]\n')
  process.exit(1)
}

const tracked = spawnSync('git', ['ls-files', '-z', '--', 'tests/e2e'], { encoding: 'utf8' })
if (tracked.error || tracked.status !== 0) {
  process.stderr.write(
    `[e2e:macos-platform] ${tracked.error?.message ?? tracked.stderr ?? 'git ls-files failed.'}\n`,
  )
  process.exit(1)
}

const tests = selectMacosPlatformE2E({
  trackedFiles: tracked.stdout.split('\0').filter(Boolean),
  coreTests: QUICK_E2E_GROUPS.core.tests,
})

if (args.includes('--print')) {
  process.stdout.write(`${tests.join('\n')}\n`)
  process.exit(0)
}

process.stdout.write(`[e2e:macos-platform] ${tests.length} E2E files selected.\n`)
const result = spawnSync(PNPM_COMMAND, ['test:e2e', ...tests], {
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
