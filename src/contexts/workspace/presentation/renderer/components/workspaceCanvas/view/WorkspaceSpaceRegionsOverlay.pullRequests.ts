import React from 'react'
import type {
  GitHubPullRequestSummary,
  GitWorktreeInfo,
  ResolveGitHubPullRequestsResult,
} from '@shared/contracts/dto'
import type { SpaceVisual } from '../types'
import {
  normalizeComparablePath,
  resolveClosestWorktree,
} from './WorkspaceSpaceRegionsOverlay.helpers'

const PULL_REQUEST_REFRESH_INTERVAL_MS = 60_000
const LEGACY_PULL_REQUEST_MOUNT_KEY = '__legacy__'
const PULL_REQUEST_KEY_SEPARATOR = '\u0000'

export function toPullRequestKey(mountId: string | null | undefined, branch: string): string {
  const normalizedMountId = mountId?.trim() ?? ''
  const mountKey = normalizedMountId.length > 0 ? normalizedMountId : LEGACY_PULL_REQUEST_MOUNT_KEY
  return `${mountKey}${PULL_REQUEST_KEY_SEPARATOR}${branch}`
}

export function useWorkspaceSpacePullRequests(options: {
  githubPullRequestsEnabled: boolean
  spaceVisuals: SpaceVisual[]
  worktrees: GitWorktreeInfo[]
  normalizedWorkspacePath: string
  selectedSpaceIdSet: ReadonlySet<string>
  openExplorerSpaceId: string | null
  worktreeRepoRootPath: string
}): Record<string, GitHubPullRequestSummary | null> {
  const [pullRequestsByKey, setPullRequestsByKey] = React.useState<
    Record<string, GitHubPullRequestSummary | null>
  >(() => ({}))

  const pullRequestTargets = React.useMemo(() => {
    const branchesByMountId = new Map<string, Set<string>>()
    const legacyBranches = new Set<string>()

    options.spaceVisuals.forEach(space => {
      const info = resolveClosestWorktree(options.worktrees, space.directoryPath)
      if (!info) {
        return
      }

      const normalizedWorktreePath = normalizeComparablePath(info.path)
      if (
        normalizedWorktreePath.length === 0 ||
        (normalizedWorktreePath === options.normalizedWorkspacePath &&
          !options.selectedSpaceIdSet.has(space.id) &&
          options.openExplorerSpaceId !== space.id)
      ) {
        return
      }

      const branch = info.branch?.trim() ?? ''
      if (branch.length === 0) {
        return
      }

      const mountId = space.targetMountId?.trim() ?? ''
      if (mountId.length > 0) {
        const existing = branchesByMountId.get(mountId)
        if (existing) {
          existing.add(branch)
          return
        }

        branchesByMountId.set(mountId, new Set([branch]))
        return
      }

      legacyBranches.add(branch)
    })

    const mountRequests = [...branchesByMountId.entries()]
      .map(([mountId, branches]) => ({
        mountId,
        branches: [...branches].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.mountId.localeCompare(right.mountId))

    const legacy = [...legacyBranches].sort((left, right) => left.localeCompare(right))

    const keys: string[] = []
    mountRequests.forEach(request => {
      request.branches.forEach(branch => {
        keys.push(toPullRequestKey(request.mountId, branch))
      })
    })
    legacy.forEach(branch => {
      keys.push(toPullRequestKey(null, branch))
    })

    return {
      mountRequests,
      legacyBranches: legacy,
      keys,
    }
  }, [
    options.normalizedWorkspacePath,
    options.openExplorerSpaceId,
    options.selectedSpaceIdSet,
    options.spaceVisuals,
    options.worktrees,
  ])

  const pullRequestTargetsKey = React.useMemo(() => {
    const parts: string[] = []
    pullRequestTargets.mountRequests.forEach(request => {
      parts.push(`${request.mountId}:${request.branches.join(',')}`)
    })
    if (pullRequestTargets.legacyBranches.length > 0) {
      parts.push(`legacy:${pullRequestTargets.legacyBranches.join(',')}`)
    }

    return parts.join('|')
  }, [pullRequestTargets])

  React.useEffect(() => {
    if (pullRequestTargets.keys.length === 0) {
      setPullRequestsByKey({})
      return
    }

    if (!options.githubPullRequestsEnabled) {
      setPullRequestsByKey({})
      return
    }

    const controlSurfaceInvoke = window.opencoveApi?.controlSurface?.invoke
    const legacyResolvePullRequests = window.opencoveApi?.integration?.github?.resolvePullRequests
    const canResolveMountRequests =
      pullRequestTargets.mountRequests.length > 0 && typeof controlSurfaceInvoke === 'function'
    const canResolveLegacyRequests =
      pullRequestTargets.legacyBranches.length > 0 &&
      typeof legacyResolvePullRequests === 'function'

    if (!canResolveMountRequests && !canResolveLegacyRequests) {
      setPullRequestsByKey(Object.fromEntries(pullRequestTargets.keys.map(key => [key, null])))
      return
    }

    let cancelled = false
    let intervalId: number | null = null

    const resolveAll = async (): Promise<void> => {
      const tasks: Array<
        Promise<{
          mountId: string | null
          pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null>
        }>
      > = []

      if (
        pullRequestTargets.mountRequests.length > 0 &&
        typeof controlSurfaceInvoke === 'function'
      ) {
        pullRequestTargets.mountRequests.forEach(request => {
          tasks.push(
            controlSurfaceInvoke<ResolveGitHubPullRequestsResult>({
              kind: 'query',
              id: 'integration.github.resolvePullRequestsInMount',
              payload: { mountId: request.mountId, branches: request.branches },
            }).then(result => ({
              mountId: request.mountId,
              pullRequestsByBranch: result.pullRequestsByBranch,
            })),
          )
        })
      }

      if (
        pullRequestTargets.legacyBranches.length > 0 &&
        typeof legacyResolvePullRequests === 'function'
      ) {
        tasks.push(
          legacyResolvePullRequests({
            repoPath: options.worktreeRepoRootPath,
            branches: pullRequestTargets.legacyBranches,
          }).then(result => ({
            mountId: null,
            pullRequestsByBranch: result.pullRequestsByBranch,
          })),
        )
      }

      const settled = await Promise.allSettled(tasks)

      if (cancelled) {
        return
      }

      setPullRequestsByKey(previous => {
        const next: Record<string, GitHubPullRequestSummary | null> = {}

        pullRequestTargets.keys.forEach(key => {
          next[key] = previous[key] ?? null
        })

        if (
          pullRequestTargets.mountRequests.length > 0 &&
          typeof controlSurfaceInvoke !== 'function'
        ) {
          pullRequestTargets.mountRequests.forEach(request => {
            request.branches.forEach(branch => {
              next[toPullRequestKey(request.mountId, branch)] = null
            })
          })
        }

        if (
          pullRequestTargets.legacyBranches.length > 0 &&
          typeof legacyResolvePullRequests !== 'function'
        ) {
          pullRequestTargets.legacyBranches.forEach(branch => {
            next[toPullRequestKey(null, branch)] = null
          })
        }

        settled.forEach(entry => {
          if (entry.status !== 'fulfilled') {
            return
          }

          Object.entries(entry.value.pullRequestsByBranch).forEach(([branch, summary]) => {
            next[toPullRequestKey(entry.value.mountId, branch)] = summary ?? null
          })
        })

        return next
      })
    }

    void resolveAll()
    intervalId = window.setInterval(() => {
      void resolveAll()
    }, PULL_REQUEST_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [
    options.githubPullRequestsEnabled,
    options.worktreeRepoRootPath,
    pullRequestTargets,
    pullRequestTargetsKey,
  ])

  return pullRequestsByKey
}
