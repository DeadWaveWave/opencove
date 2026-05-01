import { dirname, join, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../platform/os/HomeDirectory'

export function encodeClaudeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
}

export function resolveClaudeWorkspacePathCandidates(cwd: string): string[] {
  const candidates: string[] = []
  let current = resolve(cwd)

  while (!candidates.includes(current)) {
    candidates.push(current)
    const parent = dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  return candidates
}

export function resolveClaudeProjectDirectoryCandidateGroups(
  cwd: string,
  homeDirectories = resolveHomeDirectoryCandidates(),
): string[][] {
  return resolveClaudeWorkspacePathCandidates(cwd).map(workspacePath => {
    const encodedPath = encodeClaudeProjectPath(workspacePath)
    return [...new Set(homeDirectories)].map(homeDirectory =>
      join(homeDirectory, '.claude', 'projects', encodedPath),
    )
  })
}
