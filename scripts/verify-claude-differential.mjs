import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveDifferentialBaseline } from './lib/differential-baseline.mjs'

const baseline = resolveDifferentialBaseline(process.env.OPENCOVE_DIFFERENTIAL_BASELINE)
if (!baseline.enabled) {
  process.stdout.write(`${baseline.reason}\n`)
} else {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['test', '--', '--run', 'tests/unit/app/claudeNonClearFuzz.spec.ts', '--maxWorkers=1'],
    {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, OPENCOVE_DIFFERENTIAL_BASELINE: baseline.commit },
    },
  )
  process.exitCode = result.status ?? 1
}
