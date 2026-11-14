import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const repositoryRoot = resolve(import.meta.dirname, '../../..')

const temporaryRepositories: string[] = []

export function runGit(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  }
}

export function createGitRepository(): string {
  const path = mkdtempSync(join(tmpdir(), 'opencove-repo-checks-'))
  temporaryRepositories.push(path)
  runGit(['init', '-q'], path)
  return path
}

export function writeRepositoryFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function removeTemporaryRepositories(): void {
  for (const path of temporaryRepositories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
}

export function runScript(script: string, cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(repositoryRoot, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
  })
}

export function repeatLines(line: string, count: number): string {
  return `${line}\n`.repeat(count)
}
