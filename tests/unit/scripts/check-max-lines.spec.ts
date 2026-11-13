import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGitRepository,
  repositoryRoot,
  removeTemporaryRepositories,
  repeatLines,
  runGit,
  runScript,
  writeRepositoryFile,
} from './repoFixture'

afterEach(removeTemporaryRepositories)

function checkRepository(root: string) {
  return runScript('check-max-lines.mjs', root)
}

// The CLI uses the built-in exemption list, which names files of this repository, so a clean
// temporary repository is checked in-process with an empty list.
async function passes(root: string): Promise<boolean> {
  const { checked, problems } = await runInProcess(root, {})
  return checked > 0 && problems.length === 0
}

async function runInProcess(root: string, exemptions: Record<string, unknown>) {
  const module = await import('../../../scripts/check-max-lines.mjs')
  return module.runMaxLinesCheck({ cwd: root, exemptions }) as {
    checked: number
    problems: string[]
  }
}

describe('max-lines whole-repository mode', () => {
  it('checks every file with nothing staged and keeps the 1000-line boundary', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', repeatLines('export const value = 1', 1000))
    await expect(passes(root)).resolves.toBe(true)

    writeRepositoryFile(root, 'src/big.mjs', repeatLines('export const value = 1', 1001))
    const { problems } = await runInProcess(root, {})
    expect(problems).toEqual([expect.stringContaining('src/big.mjs: 1001 lines')])
    expect(checkRepository(root).status).toBe(1)
  })

  it('includes untracked files and skips ignored files', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, '.gitignore', 'ignored.ts\n')
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    runGit(['add', '.gitignore', 'src/ok.ts'], root)
    writeRepositoryFile(root, 'ignored.ts', repeatLines('a', 1001))
    await expect(passes(root)).resolves.toBe(true)

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

describe('max-lines CLI on this repository', () => {
  it('passes and reports the number of files it checked', () => {
    const result = runScript('check-max-lines.mjs', repositoryRoot)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/checked [1-9]\d* files/)
  })
})

describe('max-lines extension coverage', () => {
  it.each(['a.ts', 'a.tsx', 'a.mjs', 'a.css', 'a.sh', 'a.ps1', 'a.cmd', 'a.cs', 'a.d.ts'])(
    'rejects an oversized %s',
    async name => {
      const root = createGitRepository()
      writeRepositoryFile(root, name, repeatLines('a', 1001))
      const { problems } = await runInProcess(root, {})
      expect(problems).toEqual([expect.stringContaining(`${name}: 1001 lines`)])
    },
  )

  it.each(['a.md', 'a.json', 'a.jsonl', 'a.yml', 'a.yaml', 'a.html'])(
    'does not limit %s',
    async name => {
      const root = createGitRepository()
      writeRepositoryFile(root, 'src/ok.ts', 'a\n')
      writeRepositoryFile(root, name, repeatLines('a', 1500))
      await expect(passes(root)).resolves.toBe(true)
    },
  )

  it('skips files on the explicit generated list but not authored theme CSS', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    writeRepositoryFile(
      root,
      'src/app/renderer/styles/themes/generated/cove.css',
      repeatLines('a', 1500),
    )
    writeRepositoryFile(
      root,
      'src/contexts/agent/domain/claudeRootCommands.generated.ts',
      repeatLines('a', 1500),
    )
    await expect(passes(root)).resolves.toBe(true)

    writeRepositoryFile(root, 'src/app/renderer/styles/themes/pixel.css', repeatLines('a', 1001))
    const { problems } = await runInProcess(root, {})
    expect(problems).toEqual([expect.stringContaining('pixel.css: 1001 lines')])
  })

  it('does not let a file skip the limit by being named *.generated.*', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/feature.generated.ts', repeatLines('a', 1001))
    const { problems } = await runInProcess(root, {})
    expect(problems).toEqual([expect.stringContaining('src/feature.generated.ts: 1001 lines')])
  })

  it('gives the same verdict when started from a subdirectory', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    writeRepositoryFile(
      root,
      'src/app/renderer/styles/themes/generated/cove.css',
      repeatLines('a', 1500),
    )
    writeRepositoryFile(root, 'src/deep/big.ts', repeatLines('a', 1001))
    const result = runScript('check-max-lines.mjs', join(root, 'src', 'deep'))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/deep/big.ts: 1001 lines')
    expect(result.stderr).not.toContain('cove.css')
  })

  it('accepts explicit file arguments', () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'big.ts', repeatLines('a', 1001))
    expect(runScript('check-max-lines.mjs', root, ['big.ts']).status).toBe(1)
  })

  it('applies exemption rules to explicit file arguments', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'tool.mjs', repeatLines('a', 1101))
    const module = await import('../../../scripts/check-max-lines.mjs')
    const result = module.runMaxLinesCheck({
      cwd: root,
      files: ['tool.mjs'],
      exemptions: { 'tool.mjs': { lines: 1100, reason: 'test' } },
    })
    expect(result.problems).toEqual([expect.stringContaining('exceeds its recorded 1100')])
  })
})

describe('max-lines exemptions', () => {
  const exemption = { lines: 1100, reason: 'test' }

  function repositoryWithExemptFile(lines: number): string {
    const root = createGitRepository()
    writeRepositoryFile(root, 'tool.mjs', repeatLines('a', lines))
    return root
  }

  it('accepts an exempt file at its recorded count', async () => {
    const root = repositoryWithExemptFile(1100)
    expect((await runInProcess(root, { 'tool.mjs': exemption })).problems).toEqual([])
  })

  it('fails when an exempt file grows', async () => {
    const root = repositoryWithExemptFile(1101)
    const { problems } = await runInProcess(root, { 'tool.mjs': exemption })
    expect(problems).toEqual([
      expect.stringContaining('tool.mjs: 1101 lines exceeds its recorded 1100'),
    ])
  })

  it('fails with the number to record when an exempt file shrinks but stays over the limit', async () => {
    const root = repositoryWithExemptFile(1050)
    const { problems } = await runInProcess(root, { 'tool.mjs': exemption })
    expect(problems).toEqual([expect.stringContaining('Record 1050')])
  })

  it('fails when an exempt file is back at or under the limit', async () => {
    const root = repositoryWithExemptFile(1000)
    const { problems } = await runInProcess(root, { 'tool.mjs': exemption })
    expect(problems).toEqual([expect.stringContaining('Remove it from LINE_LIMIT_EXEMPTIONS')])
  })

  it('fails when an exempt file no longer exists', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'src/ok.ts', 'a\n')
    const { problems } = await runInProcess(root, { 'tool.mjs': exemption })
    expect(problems).toEqual([
      expect.stringContaining('tool.mjs: listed in LINE_LIMIT_EXEMPTIONS but no longer exists'),
    ])
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
    const { checked, problems } = module.runMaxLinesCheck({ cwd: repositoryRoot })
    expect(problems).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })
})
