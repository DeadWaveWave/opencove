import { normalizeSlashes } from './pathHelpers'

export function isAllocateProjectPlaceholderPath(
  workspacePath: string,
  workspaceId: string,
): boolean {
  const normalizedPath = normalizeSlashes(workspacePath.trim()).replace(/\/+$/, '')
  const normalizedWorkspaceId = workspaceId.trim()
  if (normalizedPath.length === 0 || normalizedWorkspaceId.length === 0) {
    return false
  }

  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length < 2) {
    return false
  }

  const last = segments[segments.length - 1]
  const parent = segments[segments.length - 2]
  return last === normalizedWorkspaceId && parent === 'projects'
}
