import { spawnSync } from 'node:child_process'
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractClaudeBaseline } from './lib/claude-baseline.mjs'
const root = resolve(import.meta.dirname, '..')
const base = resolve(root, 'tests/fixtures/claude/non-clear')
const { temporary, manifest, entries, commit } = extractClaudeBaseline(process.argv[2])
try {
  const runner = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(
    runner,
    ['test', '--', '--run', 'tests/unit/app/claudeNonClearCompatibility.spec.ts', '--maxWorkers=1'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, OPENCOVE_NON_CLEAR_BASELINE: temporary },
    },
  )
  if (result.status !== 0) {
    throw new Error(`Baseline execution failed: ${result.status}`)
  }
  cpSync(resolve(temporary, 'results'), resolve(base, 'goldens'), { recursive: true })
  writeFileSync(
    resolve(base, 'manifest.json'),
    JSON.stringify({ commit, entries, sources: manifest }, null, 2) + '\n',
  )
  process.stdout.write(
    `Generated non-clear goldens from ${commit}; ${Object.keys(manifest).length} source files\n`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
