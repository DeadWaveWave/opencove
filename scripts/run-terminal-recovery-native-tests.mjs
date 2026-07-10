#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import electronPath from 'electron'

const tests = [
  'tests/contract/controlSurface/controlSurfaceHttpServer.remoteTerminalRecovery.spec.ts',
  'tests/contract/controlSurface/controlSurfaceHttpServer.terminalRecovery.spec.ts',
  'tests/contract/platform/terminalRecovery.multiEpoch.spec.ts',
]
const result = spawnSync(
  electronPath,
  [path.resolve('node_modules/vitest/vitest.mjs'), '--run', ...tests],
  {
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  },
)

if (result.error) {
  process.stderr.write(`${result.error.message}\n`)
}
process.exit(result.status ?? 1)
