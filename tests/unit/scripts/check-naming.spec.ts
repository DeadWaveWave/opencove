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
    expect(result.stderr).toContain('src/feature.ts')
  })

  it('accepts a clean repository and reports how many files it scanned', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/feature.ts', "export const name = 'opencove-test-1'\n")
    const result = runScript('check-naming.mjs', root)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('scanned 1 files')
  })

  it('accepts a legacy storage key that carries the same-line marker', () => {
    const root = createGitRepository()
    writeRepositoryFile(
      root,
      'src/migrate.ts',
      `const LEGACY_KEY = '${c}:m0:state'\nconst other = '${c}:m0:state' // legacy\n`,
    )
    expect(runScript('check-naming.mjs', root).status).toBe(0)

    writeRepositoryFile(root, 'src/migrate2.ts', `const key = '${c}:m0:state'\n`)
    expect(runScript('check-naming.mjs', root).status).toBe(1)
  })

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

  it('fails when it scanned zero files', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'notes.md', 'text\n')
    const result = runScript('check-naming.mjs', root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('scanned 0 files')
  })
})
