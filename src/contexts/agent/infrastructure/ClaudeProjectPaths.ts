import { dirname, join, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../platform/os/HomeDirectory'

export function encodeClaudeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[:\\/]/g, '-')
}

function encodeLegacyClaudeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
}

function resolveClaudeProjectPathEncodings(cwd: string): string[] {
  return [...new Set([encodeClaudeProjectPath(cwd), encodeLegacyClaudeProjectPath(cwd)])]
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
    const encodedPaths = resolveClaudeProjectPathEncodings(workspacePath)
    const uniqueHomeDirectories = [...new Set(homeDirectories)]

    return encodedPaths.flatMap(encodedPath =>
      uniqueHomeDirectories.map(homeDirectory =>
        join(homeDirectory, '.claude', 'projects', encodedPath),
      ),
    )
  })
}
