// Resolves the set of paths a change touches: named files, the staged diff, or a diff against a
// base. Read-only: it never changes the working tree or Git state. No `typescript` import.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseStagedE2EChanges } from '../../precommit-e2e-selection.mjs'

function git(root, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr?.trim() ?? ''}`,
    )
  }
  return result.stdout
}

function dedupe(changes) {
  const byPath = new Map()
  for (const change of changes) {
    byPath.set(change.path, change)
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1))
}

export function resolveExplicitChanges(root, files, cwd = process.cwd()) {
  return dedupe(
    files.map(file => {
      const path = relative(root, resolve(cwd, file)).replaceAll('\\', '/')
      if (path.startsWith('..') || isAbsolute(path)) {
        throw new Error(`${file} is outside the repository.`)
      }
      return { path, status: existsSync(join(root, path)) ? 'M' : 'A' }
    }),
  )
}

export function resolveStagedChanges(root) {
  return dedupe(parseStagedE2EChanges(git(root, ['diff', '--cached', '--name-status', '-z', '-M'])))
}

/**
 * Changes since the merge base of `base` and `head`. With a `head`, only that committed range;
 * without one, the diff also covers uncommitted and new untracked files.
 */
export function resolveBaseChanges(root, base, head = null) {
  const mergeBase = git(root, ['merge-base', base, head ?? 'HEAD']).trim()
  const diffArguments = ['diff', '--name-status', '-z', '-M', mergeBase]
  if (head) {
    diffArguments.push(head)
  }
  const changes = parseStagedE2EChanges(git(root, diffArguments))
  if (!head) {
    const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
      .split('\0')
      .filter(entry => entry.length > 0)
    changes.push(...untracked.map(path => ({ path, status: 'A' })))
  }
  return dedupe(changes)
}

export function isWorkingTreeDirty(root) {
  return git(root, ['status', '--porcelain']).trim().length > 0
}
