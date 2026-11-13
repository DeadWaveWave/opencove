import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Pins the knip behaviour scripts/check-dead-code.mjs relies on, so a knip upgrade that changes
// it fails here and not silently in the gate.
const repoRoot = resolve(__dirname, '../../..')
const fixtureRoot = resolve(repoRoot, 'tests/fixtures/dead-code')

type Row = {
  file: string
  files: Array<{ name: string }>
  exports: Array<{ name: string }>
}

function runKnipOnFixture(): Row[] {
  const result = spawnSync(
    process.execPath,
    [
      resolve(repoRoot, 'node_modules/knip/bin/knip.js'),
      '--production',
      '--reporter',
      'json',
      '--no-exit-code',
    ],
    { cwd: fixtureRoot, encoding: 'utf8' },
  )
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout).issues as Row[]
}

describe('knip production mode on the dead-code fixture', () => {
  const issues = runKnipOnFixture()

  it('reports a file that only a spec imports', () => {
    const unusedFiles = issues.flatMap(row => row.files.map(file => file.name))

    expect(unusedFiles).toEqual(['src/replaced.ts'])
  })

  it('reports an export that only a spec imports, and honours @internal', () => {
    const exportsByFile = Object.fromEntries(
      issues
        .filter(row => row.exports.length > 0)
        .map(row => [row.file, row.exports.map(e => e.name)]),
    )

    expect(exportsByFile).toEqual({ 'src/used.ts': ['exportedOnlyForSpec'] })
  })

  it('does not report a @public export, which is why the wrapper rejects that tag', () => {
    const reported = issues.flatMap(row => row.exports.map(e => e.name))

    expect(reported).not.toContain('publicButUnused')
  })
})
