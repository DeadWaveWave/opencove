import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const temporaryRepositories: string[] = []

const gates = [
  {
    name: 'format',
    script: 'check-format-staged.mjs',
    fixture: { file: 'sample.json', content: '{}\n' },
    expectedStdout: '',
  },
  {
    name: 'naming',
    script: 'check-naming-staged.mjs',
    fixture: { file: 'sample.ts', content: 'export const value = 1\n' },
    expectedStdout: '',
  },
  {
    name: 'secrets',
    script: 'check-secrets-staged.mjs',
    fixture: { file: 'sample.txt', content: 'safe fixture\n' },
    expectedStdout: '[fake-pnpm] exec secretlint --stdinFileName sample.txt\n',
  },
  {
    name: 'vitest-related',
    script: 'run-vitest-related-staged.mjs',
    fixture: { file: 'sample.ts', content: 'export const value = 1\n' },
    expectedStdout: '[fake-pnpm] exec vitest related --run --passWithNoTests sample.ts\n',
  },
] as const

function runGit(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  }
}

function createRepository(): { path: string; env: NodeJS.ProcessEnv } {
  const path = mkdtempSync(join(tmpdir(), 'opencove-staged-gate-'))
  temporaryRepositories.push(path)
  runGit(['init'], path)

  const binPath = join(path, 'bin')
  mkdirSync(binPath)
  const executableName = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const executablePath = join(binPath, executableName)
  const executable =
    process.platform === 'win32'
      ? '@echo off\r\necho [fake-pnpm] %*\r\n'
      : '#!/bin/sh\necho "[fake-pnpm] $*"\n'
  writeFileSync(executablePath, executable)
  if (process.platform !== 'win32') {
    chmodSync(executablePath, 0o755)
  }

  return {
    path,
    env: {
      ...process.env,
      PATH: `${binPath}${delimiter}${process.env.PATH ?? ''}`,
    },
  }
}

function warningFor(gateName: string): string {
  return (
    `[gate:${gateName}] WARNING: no staged files matched — this gate checked NOTHING and is not a pass.\n` +
    'Stage your changes first (git add -A) and confirm: git diff --cached --name-only\n'
  )
}

afterEach(() => {
  for (const repoPath of temporaryRepositories.splice(0)) {
    rmSync(repoPath, { recursive: true, force: true })
  }
})

describe.each(gates)('$name staged gate', gate => {
  function run(args: string[] = [], strict = false) {
    const repository = createRepository()
    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts', gate.script), ...args],
      {
        cwd: repository.path,
        encoding: 'utf8',
        env: {
          ...repository.env,
          OPENCOVE_REQUIRE_STAGED: strict ? '1' : '0',
        },
      },
    )
    return { repository, result }
  }

  it('warns and exits zero by default when no staged files match', () => {
    const { result } = run()

    expect(result.status).toBe(0)
    expect(result.stderr).toBe(warningFor(gate.name))
  })

  it('warns and exits nonzero in strict mode when no staged files match', () => {
    const { result } = run([], true)

    expect(result.status).toBe(1)
    expect(result.stderr).toBe(warningFor(gate.name))
  })

  it('preserves the successful non-empty invocation output', () => {
    const repository = createRepository()
    writeFileSync(join(repository.path, gate.fixture.file), gate.fixture.content)
    runGit(['add', gate.fixture.file], repository.path)

    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts', gate.script), gate.fixture.file],
      {
        cwd: repository.path,
        encoding: 'utf8',
        env: repository.env,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(gate.expectedStdout)
    expect(result.stderr).toBe('')
  })

  it('does not report an explicit unmatched target as an empty staged run', () => {
    const { result } = run(['asset.png'], true)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})
