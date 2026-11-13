import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGitRepository,
  removeTemporaryRepositories,
  repeatLines,
  runGit,
  runScript,
  writeRepositoryFile,
} from './repoFixture'

afterEach(removeTemporaryRepositories)

function checkRepository(root: string, exemptions: Record<string, unknown> = {}) {
  const exemptionsPath = join(root, '.test-exemptions.json')
  writeFileSync(exemptionsPath, JSON.stringify(exemptions))
  return runScript('check-max-lines.mjs', root, [`--exemptions=${exemptionsPath}`])
}

describe('max-lines whole-repository mode', () => {
  it('checks every file with nothing staged and keeps the 1000-line boundary', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', repeatLines('export const value = 1', 1000))
    expect(checkRepository(root).status).toBe(0)
    expect(checkRepository(root).stdout).toContain('checked 1 files')

    writeRepositoryFile(root, 'src/big.mjs', repeatLines('export const value = 1', 1001))
    const rejected = checkRepository(root)
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('src/big.mjs: 1001 lines')
  })

  it('includes untracked files and skips ignored files', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, '.gitignore', 'ignored.ts\n')
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    runGit(['add', '.gitignore', 'src/ok.ts'], root)
    writeRepositoryFile(root, 'ignored.ts', repeatLines('a', 1001))
    expect(checkRepository(root).status).toBe(0)

    writeRepositoryFile(root, 'untracked.ts', repeatLines('a', 1001))
    expect(checkRepository(root).status).toBe(1)
  })

  it('checks files under a directory named layout/', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/app/layout/panel.ts', repeatLines('a', 1001))
    const result = checkRepository(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/app/layout/panel.ts: 1001 lines')
  })

  it('fails when it checked zero files', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'notes.md', 'text\n')
    const result = checkRepository(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checked 0 files')
  })
})

describe('max-lines extension coverage', () => {
  it.each(['a.ts', 'a.tsx', 'a.mjs', 'a.css', 'a.sh', 'a.ps1', 'a.cmd', 'a.cs', 'a.d.ts'])(
    'rejects an oversized %s',
    name => {
      const root = createGitRepository()
      writeRepositoryFile(root, name, repeatLines('a', 1001))
      expect(checkRepository(root).status).toBe(1)
    },
  )

  it.each(['a.md', 'a.json', 'a.jsonl', 'a.yml', 'a.yaml', 'a.html'])('does not limit %s', name => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    writeRepositoryFile(root, name, repeatLines('a', 1500))
    expect(checkRepository(root).status).toBe(0)
  })

  it('skips generated files but not authored theme CSS', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    writeRepositoryFile(
      root,
      'src/app/renderer/styles/themes/generated/cove.css',
      repeatLines('a', 1500),
    )
    writeRepositoryFile(root, 'src/contexts/commands.generated.ts', repeatLines('a', 1500))
    expect(checkRepository(root).status).toBe(0)

    writeRepositoryFile(root, 'src/app/renderer/styles/themes/pixel.css', repeatLines('a', 1001))
    const rejected = checkRepository(root)
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('pixel.css: 1001 lines')
  })

  it('accepts explicit file arguments', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'big.ts', repeatLines('a', 1001))
    expect(runScript('check-max-lines.mjs', root, ['big.ts']).status).toBe(1)
  })
})

describe('max-lines exemptions', () => {
  const exemption = { lines: 1100, reason: 'test' }

  function repositoryWithExemptFile(lines: number): string {
    const root = createGitRepository()
    writeRepositoryFile(root, 'tool.mjs', repeatLines('a', lines))
    return root
  }

  it('accepts an exempt file at its recorded count', () => {
    const root = repositoryWithExemptFile(1100)
    expect(checkRepository(root, { 'tool.mjs': exemption }).status).toBe(0)
  })

  it('fails when an exempt file grows', () => {
    const root = repositoryWithExemptFile(1101)
    const result = checkRepository(root, { 'tool.mjs': exemption })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('tool.mjs: 1101 lines exceeds its recorded 1100')
  })

  it('fails with the number to record when an exempt file shrinks but stays over the limit', () => {
    const root = repositoryWithExemptFile(1050)
    const result = checkRepository(root, { 'tool.mjs': exemption })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Record 1050')
  })

  it('fails when an exempt file is back at or under the limit', () => {
    const root = repositoryWithExemptFile(1000)
    const result = checkRepository(root, { 'tool.mjs': exemption })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Remove it from LINE_LIMIT_EXEMPTIONS')
  })

  it('fails when an exempt file no longer exists', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    const result = checkRepository(root, { 'tool.mjs': exemption })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'tool.mjs: listed in LINE_LIMIT_EXEMPTIONS but no longer exists',
    )
  })

  it('pins the built-in exemption list to the two seeded scripts and passes on this repository', async () => {
    const module = await import('../../../scripts/check-max-lines.mjs')
    const seeded = [
      'scripts/debug-repro-restored-agent-input.mjs',
      'scripts/recover-opencove-db-from-sqlite-recover.mjs',
    ]
    expect(Object.keys(module.LINE_LIMIT_EXEMPTIONS).every(path => seeded.includes(path))).toBe(
      true,
    )
    const { checked, problems } = module.runMaxLinesCheck({ cwd: process.cwd() })
    expect(problems).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })
})
