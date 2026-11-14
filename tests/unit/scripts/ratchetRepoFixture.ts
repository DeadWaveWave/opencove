import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitRepository, runGit, writeRepositoryFile } from './repoFixture'

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

export function commitAll(cwd: string, message: string): string {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

export function baselineJson(rules: Record<string, Record<string, number>>): string {
  return `${JSON.stringify(rules, null, 2)}\n`
}

const directories: string[] = []

export function removeFixtureDirectories(): void {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
}

export function createTemporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  directories.push(path)
  return path
}

// Commits everything on `main` and pushes it to a new bare `origin`, so `origin/main` is the
// merge base of every later commit.
export function publishToOrigin(repo: string) {
  git(repo, 'checkout', '-q', '-B', 'main')
  const first = commitAll(repo, 'base')
  const origin = createTemporaryDirectory('opencove-repo-origin-')
  runGit(['init', '-q', '--bare'], origin)
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-q', 'origin', 'main')
  return { repo, origin, first }
}

export function createClonedRepository(files: Record<string, string> = {}) {
  const repo = createGitRepository()
  writeRepositoryFile(repo, 'README.md', 'x\n')
  for (const [path, content] of Object.entries(files)) {
    writeRepositoryFile(repo, path, content)
  }
  return publishToOrigin(repo)
}
