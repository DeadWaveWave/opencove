import React from 'react'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import type { SpaceVisual } from '../types'
import { normalizeComparablePath } from './WorkspaceSpaceRegionsOverlay.helpers'

const GIT_STATUS_REFRESH_INTERVAL_MS = 30_000

export function resolveGitStatusRepoKey({
  normalizedDirectoryPath,
  normalizedWorkspacePath,
  isWorktree,
}: {
  normalizedDirectoryPath: string
  normalizedWorkspacePath: string
  isWorktree: boolean
}): string {
  if (normalizedDirectoryPath.length === 0 || normalizedDirectoryPath === normalizedWorkspacePath) {
    return normalizedWorkspacePath
  }

  if (isWorktree) {
    return normalizedDirectoryPath
  }

  return normalizedDirectoryPath.startsWith(`${normalizedWorkspacePath}/`)
    ? normalizedWorkspacePath
    : normalizedDirectoryPath
}

export function useWorkspaceGitStatusSummary({
  workspacePath,
  normalizedWorkspacePath,
  spaceVisuals,
  worktreeInfoByPath,
  refreshNonce,
}: {
  workspacePath: string
  normalizedWorkspacePath: string
  spaceVisuals: SpaceVisual[]
  worktreeInfoByPath: Map<string, GitWorktreeInfo>
  refreshNonce: number
}): Map<string, number | null> {
  const [changedFilesByRepoKey, setChangedFilesByRepoKey] = React.useState<
    Map<string, number | null>
  >(() => new Map())

  const statusRepos = React.useMemo(() => {
    const byKey = new Map<string, { key: string; path: string }>()

    const addRepoPath = (repoPath: string) => {
      const normalizedKey = normalizeComparablePath(repoPath)
      if (normalizedKey.length === 0) {
        return
      }
      if (!byKey.has(normalizedKey)) {
        byKey.set(normalizedKey, { key: normalizedKey, path: repoPath })
      }
    }

    addRepoPath(workspacePath)

    spaceVisuals.forEach(space => {
      const normalizedDirectoryPath = normalizeComparablePath(space.directoryPath)
      if (
        normalizedDirectoryPath.length === 0 ||
        normalizedDirectoryPath === normalizedWorkspacePath
      ) {
        return
      }

      // If this is a tracked worktree, it represents its own repo-like checkout.
      if (worktreeInfoByPath.has(normalizedDirectoryPath)) {
        addRepoPath(space.directoryPath)
        return
      }

      // External directories (outside the workspace root) are treated as independent repos.
      if (!normalizedDirectoryPath.startsWith(`${normalizedWorkspacePath}/`)) {
        addRepoPath(space.directoryPath)
      }
    })

    return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key))
  }, [normalizedWorkspacePath, spaceVisuals, worktreeInfoByPath, workspacePath])

  const statusReposKey = React.useMemo(
    () => statusRepos.map(entry => entry.key).join('|'),
    [statusRepos],
  )

  React.useEffect(() => {
    if (statusRepos.length === 0) {
      setChangedFilesByRepoKey(new Map())
      return
    }

    const statusSummary = window.opencoveApi?.worktree?.statusSummary
    if (typeof statusSummary !== 'function') {
      setChangedFilesByRepoKey(new Map())
      return
    }

    let cancelled = false
    let intervalId: number | null = null

    const refreshAll = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }

      const results = await Promise.all(
        statusRepos.map(async entry => {
          try {
            const summary = await statusSummary({ repoPath: entry.path })
            return [entry.key, summary.changedFileCount] as const
          } catch {
            return [entry.key, null] as const
          }
        }),
      )

      if (cancelled) {
        return
      }

      const next = new Map<string, number | null>()
      results.forEach(([key, count]) => {
        next.set(key, count)
      })
      setChangedFilesByRepoKey(next)
    }

    void refreshAll()

    // Polling is intentionally conservative: this is a hint, not a full git UI.
    if (statusRepos.length <= 12) {
      intervalId = window.setInterval(() => {
        void refreshAll()
      }, GIT_STATUS_REFRESH_INTERVAL_MS)
    }

    return () => {
      cancelled = true
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [refreshNonce, statusRepos.length, statusReposKey])

  return changedFilesByRepoKey
}
