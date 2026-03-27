import { isAbsolute, resolve } from 'node:path'

export function resolveWorktreesRoot(workspacePath: string, worktreesRoot: string): string {
  const trimmed = worktreesRoot.trim()
  if (trimmed.length === 0) {
    return resolve(workspacePath, '.opencove', 'worktrees')
  }

  if (isAbsolute(trimmed)) {
    return resolve(trimmed)
  }

  return resolve(workspacePath, trimmed)
}
