import React from 'react'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import { resolveGitWorktreeApiForMount } from '@contexts/worktree/presentation/renderer/windows/mountAwareGitWorktreeApi'
import { normalizeComparablePath } from './WorkspaceSpaceRegionsOverlay.helpers'
import { isWorktreeInfoMapEqual } from './WorkspaceSpaceRegionsOverlay.worktrees'

const WORKTREE_REFRESH_INTERVAL_MS = 10_000

export function useWorkspaceWorktreeInfoByPath({
  workspacePath,
  mountIdsKey,
  refreshNonce,
  worktreeDirectoriesKey,
}: {
  workspacePath: string
  mountIdsKey: string
  refreshNonce: number
  worktreeDirectoriesKey: string
}): Map<string, GitWorktreeInfo> {
  const [worktreeInfoByPath, setWorktreeInfoByPath] = React.useState<Map<string, GitWorktreeInfo>>(
    () => new Map(),
  )

  React.useEffect(() => {
    setWorktreeInfoByPath(new Map())
  }, [mountIdsKey, workspacePath])

  React.useEffect(() => {
    const resolvedMountIds = mountIdsKey.length > 0 ? mountIdsKey.split('|') : []

    if (workspacePath.trim().length === 0 && resolvedMountIds.length === 0) {
      setWorktreeInfoByPath(new Map())
      return
    }

    let cancelled = false
    let refreshInFlight = false
    let intervalId: number | null = null

    const refreshWorktrees = async (): Promise<void> => {
      if (refreshInFlight) {
        return
      }

      if (typeof document !== 'undefined' && document.hidden) {
        return
      }

      refreshInFlight = true

      try {
        const nextMap = new Map<string, GitWorktreeInfo>()

        if (resolvedMountIds.length > 0) {
          await Promise.all(
            resolvedMountIds.map(async mountId => {
              const api = resolveGitWorktreeApiForMount(mountId)
              const listWorktrees = api?.listWorktrees
              if (typeof listWorktrees !== 'function') {
                return
              }

              try {
                const result = await listWorktrees({ repoPath: workspacePath })
                if (cancelled) {
                  return
                }

                result.worktrees.forEach(entry => {
                  nextMap.set(normalizeComparablePath(entry.path), entry)
                })
              } catch {
                // Ignore per-mount failures (e.g. mount root is not a git repo).
              }
            }),
          )
        } else {
          const listWorktrees = window.opencoveApi?.worktree?.listWorktrees
          if (typeof listWorktrees !== 'function') {
            setWorktreeInfoByPath(new Map())
            return
          }

          const result = await listWorktrees({ repoPath: workspacePath })
          if (cancelled) {
            return
          }

          result.worktrees.forEach(entry => {
            nextMap.set(normalizeComparablePath(entry.path), entry)
          })
        }

        if (cancelled) {
          return
        }

        setWorktreeInfoByPath(previous =>
          isWorktreeInfoMapEqual(previous, nextMap) ? previous : nextMap,
        )
      } catch {
        // Keep the last known worktree snapshot on transient failures.
      } finally {
        refreshInFlight = false
      }
    }

    void refreshWorktrees()

    intervalId = window.setInterval(() => {
      void refreshWorktrees()
    }, WORKTREE_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [mountIdsKey, refreshNonce, worktreeDirectoriesKey, workspacePath])

  return worktreeInfoByPath
}
