#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequiredE2EEnvironment } from './precommit-e2e-env.mjs'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const env = createRequiredE2EEnvironment(process.env)

const result = spawnSync(PNPM_COMMAND, ['test:e2e'], {
  encoding: 'utf8',
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
