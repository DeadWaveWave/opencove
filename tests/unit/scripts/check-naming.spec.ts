import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGitRepository,
  removeTemporaryRepositories,
  runScript,
  writeRepositoryFile,
} from './repoFixture'

afterEach(removeTemporaryRepositories)

// Built at runtime so this file itself does not contain the forbidden tokens.
const c = 'cove'
const forbidden = {
  apiToken: `const api = ${c}Api\n`,
  logPrefix: `log('[${c}] ready')\n`,
  protocol: `const channel = '${c}:event'\n`,
  testPrefix: `const name = '${c}-test-1'\n`,
  dbName: `const file = '${c}.db'\n`,
}

describe('naming check over the whole repository', () => {
  it.each(Object.entries(forbidden))('rejects %s in an untouched, unstaged file', (_name, line) => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/feature.ts', `export const ok = 1\n${line}`)
    const result = runScript('check-naming.mjs', root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/feature.ts:2')
  })

  it('accepts a clean repository and reports how many files it scanned', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/feature.ts', "export const name = 'opencove-test-1'\n")
    const result = runScript('check-naming.mjs', root)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('scanned 1 files')
  })

  it('leaves the old storage prefix to the compatibility check in the files that check scans', () => {
    const root = createGitRepository()
    writeRepositoryFile(
      root,
      'src/migrate.ts',
      `const KEY = '${c}:m0:state'\nconst other = '${c}:m0:state' // legacy\n`,
    )
    expect(runScript('check-naming.mjs', root).status).toBe(0)
  })

  it.each(['tests/unit/migrate.ts', 'src/migrate.spec.ts', 'src/main.test.tsx', 'e2e/storage.ts'])(
    'still rejects the old storage prefix in %s, which the compatibility check does not scan',
    path => {
      const root = createGitRepository()
      writeRepositoryFile(root, path, `const KEY = '${c}:m0:state' // legacy\n`)
      const result = runScript('check-naming.mjs', root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`${path}:1`)
    },
  )

  it('does not scan scripts/ or files with other extensions', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/feature.ts', 'export const ok = 1\n')
    writeRepositoryFile(root, 'scripts/tool.mjs', forbidden.apiToken)
    writeRepositoryFile(root, 'docs/notes.md', forbidden.apiToken)
    expect(runScript('check-naming.mjs', root).status).toBe(0)
  })

  it('scans a directory named out/ below the root', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/out/feature.ts', forbidden.apiToken)
    expect(runScript('check-naming.mjs', root).status).toBe(1)
  })

  it('gives the same verdict when started from a subdirectory', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'scripts/tool.mjs', forbidden.apiToken)
    writeRepositoryFile(root, 'src/deep/feature.ts', forbidden.apiToken)
    const result = runScript('check-naming.mjs', join(root, 'src', 'deep'))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/deep/feature.ts:1')
    expect(result.stderr).not.toContain('scripts/tool.mjs')
  })

  it('fails when it scanned zero files', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'notes.md', 'text\n')
    const result = runScript('check-naming.mjs', root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('scanned 0 files')
  })
})
