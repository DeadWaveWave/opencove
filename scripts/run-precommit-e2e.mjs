#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequiredE2EEnvironment } from './precommit-e2e-env.mjs'
import { parseStagedE2EChanges, selectPrecommitE2E } from './precommit-e2e-selection.mjs'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--full') || args.length > 1) {
  process.stderr.write('Usage: node scripts/run-precommit-e2e.mjs [--full]\n')
  process.exit(1)
}
const full = args.includes('--full')
const baseEnvironment = { ...process.env }
delete baseEnvironment.OPENCOVE_E2E_TEST_MATCH
const env = createRequiredE2EEnvironment(baseEnvironment)
if (!full) {
  // Explicit quick files include the cross-platform core, not only Windows-only filenames.
  delete env.OPENCOVE_E2E_TEST_MATCH
}
let selection
try {
  const staged = full
    ? null
    : spawnSync('git', ['diff', '--cached', '--name-status', '-z'], {
        encoding: 'utf8',
      })
  if (staged && (staged.error || staged.status !== 0)) {
    throw staged.error ?? new Error(staged.stderr || 'Failed to list staged changes.')
  }
  selection = selectPrecommitE2E({ changes: parseStagedE2EChanges(staged?.stdout ?? ''), full })
} catch (error) {
  process.stderr.write(`[e2e] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
if (full) {
  process.stdout.write('[e2e:full] Running the complete required platform suite.\n')
} else {
  process.stdout.write('[e2e:quick] Representative local checks; PR/CI retains the full suite.\n')
  for (const group of selection.groups) {
    process.stdout.write(`\n[${group.id}] ${group.reason}\n`)
    for (const path of group.paths) {
      process.stdout.write(`  changed: ${path}\n`)
    }
    for (const path of group.tests) {
      process.stdout.write(`  test: ${path}\n`)
    }
  }
  for (const path of selection.unmatchedPaths) {
    process.stdout.write(`  core-only (non-runtime file): ${path}\n`)
  }
  process.stdout.write(`\n[e2e:quick] ${selection.tests.length} unique E2E files selected.\n`)
}

const result = spawnSync(
  PNPM_COMMAND,
  ['test:e2e', ...selection.tests, ...(!full ? ['--max-failures=1'] : [])],
  {
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  },
)

process.exit(result.status ?? 1)
