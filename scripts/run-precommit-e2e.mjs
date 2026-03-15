#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const env =
  process.platform === 'win32' && !process.env['OPENCOVE_E2E_TEST_MATCH']
    ? {
        ...process.env,
        OPENCOVE_E2E_TEST_MATCH: '**/*.windows.spec.ts',
      }
    : process.env

const result = spawnSync(PNPM_COMMAND, ['test:e2e'], {
  encoding: 'utf8',
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
