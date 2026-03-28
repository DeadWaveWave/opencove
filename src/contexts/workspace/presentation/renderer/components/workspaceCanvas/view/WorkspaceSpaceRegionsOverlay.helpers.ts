export function normalizeComparablePath(pathValue: string): string {
  const normalized = pathValue
    .trim()
    .replace(/[/\\]+$/, '')
    .replaceAll('\\', '/')
  const platform = window.opencoveApi?.meta?.platform
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function resolveClosestWorktree<T extends { path: string }>(
  worktrees: T[],
  directoryPath: string,
): T | null {
  const normalizedDirectory = normalizeComparablePath(directoryPath)
  if (normalizedDirectory.length === 0) {
    return null
  }

  let closest: T | null = null
  let closestLength = -1

  for (const entry of worktrees) {
    const normalizedWorktreePath = normalizeComparablePath(entry.path)
    if (normalizedWorktreePath.length === 0) {
      continue
    }

    if (
      normalizedDirectory === normalizedWorktreePath ||
      normalizedDirectory.startsWith(`${normalizedWorktreePath}/`)
    ) {
      if (normalizedWorktreePath.length > closestLength) {
        closest = entry
        closestLength = normalizedWorktreePath.length
      }
    }
  }

  return closest
}

export function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}
