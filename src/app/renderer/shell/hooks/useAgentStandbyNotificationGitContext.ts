import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { AgentStandbyNotification } from '../components/AppNotifications'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'

function normalizeComparablePath(pathValue: string, platform?: string): string {
  const normalized = pathValue
    .trim()
    .replace(/[/\\]+$/, '')
    .replaceAll('\\', '/')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function resolveClosestWorktree(
  worktrees: GitWorktreeInfo[],
  directoryPath: string,
  platform?: string,
): GitWorktreeInfo | null {
  const normalizedDirectory = normalizeComparablePath(directoryPath, platform)
  if (normalizedDirectory.length === 0) {
    return null
  }

  let closest: GitWorktreeInfo | null = null
  let closestLength = -1

  for (const entry of worktrees) {
    const normalizedWorktreePath = normalizeComparablePath(entry.path, platform)
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

function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}

function updateNotification(
  previous: AgentStandbyNotification[],
  id: string,
  updater: (notification: AgentStandbyNotification) => AgentStandbyNotification,
): AgentStandbyNotification[] {
  let didChange = false
  const next = previous.map(notification => {
    if (notification.id !== id) {
      return notification
    }

    const updated = updater(notification)
    if (updated === notification) {
      return notification
    }

    didChange = true
    return updated
  })

  return didChange ? next : previous
}

/** Fills in each card's branch (or detached head) and pull request once they resolve. */
export function useAgentStandbyNotificationGitContext({
  notifications,
  setNotifications,
  platform,
  shouldResolveBranch,
  shouldResolvePullRequest,
}: {
  notifications: AgentStandbyNotification[]
  setNotifications: Dispatch<SetStateAction<AgentStandbyNotification[]>>
  platform: string | undefined
  shouldResolveBranch: boolean
  shouldResolvePullRequest: boolean
}): void {
  const worktreeCacheRef = useRef<Map<string, { fetchedAt: number; worktrees: GitWorktreeInfo[] }>>(
    new Map(),
  )
  const worktreeInFlightRef = useRef<Map<string, Promise<GitWorktreeInfo[]>>>(new Map())
  const branchInFlightRef = useRef<Set<string>>(new Set())
  const prInFlightRef = useRef<Set<string>>(new Set())
  const prCacheRef = useRef<
    Map<string, { fetchedAt: number; summary: GitHubPullRequestSummary | null }>
  >(new Map())
  const prInFlightByKeyRef = useRef<Map<string, Promise<GitHubPullRequestSummary | null>>>(
    new Map(),
  )

  const fetchWorktrees = useCallback(
    async (repoPath: string): Promise<GitWorktreeInfo[]> => {
      const normalizedRepoPath = normalizeComparablePath(repoPath, platform)
      if (normalizedRepoPath.length === 0) {
        return []
      }

      const cached = worktreeCacheRef.current.get(normalizedRepoPath)
      if (cached && Date.now() - cached.fetchedAt < 30_000) {
        return cached.worktrees
      }

      const existingInFlight = worktreeInFlightRef.current.get(normalizedRepoPath)
      if (existingInFlight) {
        return await existingInFlight
      }

      const listWorktrees = window.opencoveApi?.worktree?.listWorktrees
      if (typeof listWorktrees !== 'function') {
        return []
      }

      const promise = listWorktrees({ repoPath }).then(result => result.worktrees)
      worktreeInFlightRef.current.set(normalizedRepoPath, promise)

      try {
        const resolved = await promise
        worktreeCacheRef.current.set(normalizedRepoPath, {
          fetchedAt: Date.now(),
          worktrees: resolved,
        })
        return resolved
      } catch {
        return []
      } finally {
        worktreeInFlightRef.current.delete(normalizedRepoPath)
      }
    },
    [platform],
  )

  const fetchPullRequest = useCallback(
    async (repoPath: string, branchName: string): Promise<GitHubPullRequestSummary | null> => {
      const normalizedRepoPath = normalizeComparablePath(repoPath, platform)
      const normalizedBranch = branchName.trim()
      if (normalizedRepoPath.length === 0 || normalizedBranch.length === 0) {
        return null
      }

      const cacheKey = `${normalizedRepoPath}|${normalizedBranch}`
      const cached = prCacheRef.current.get(cacheKey)
      if (cached && Date.now() - cached.fetchedAt < 60_000) {
        return cached.summary
      }

      const existingInFlight = prInFlightByKeyRef.current.get(cacheKey)
      if (existingInFlight) {
        return await existingInFlight
      }

      const resolvePullRequests = window.opencoveApi?.integration?.github?.resolvePullRequests
      if (typeof resolvePullRequests !== 'function') {
        return null
      }

      const promise = resolvePullRequests({ repoPath, branches: [normalizedBranch] }).then(
        result => result.pullRequestsByBranch[normalizedBranch] ?? null,
      )
      prInFlightByKeyRef.current.set(cacheKey, promise)

      try {
        const resolved = await promise
        prCacheRef.current.set(cacheKey, { fetchedAt: Date.now(), summary: resolved })
        return resolved
      } catch {
        return null
      } finally {
        prInFlightByKeyRef.current.delete(cacheKey)
      }
    },
    [platform],
  )

  useEffect(() => {
    if (!shouldResolveBranch && !shouldResolvePullRequest) {
      return
    }

    notifications.forEach(notification => {
      if (!shouldResolveBranch && !shouldResolvePullRequest) {
        return
      }

      const gitDirectory = notification.spaceDirectoryPath?.trim().length
        ? notification.spaceDirectoryPath
        : notification.executionDirectory

      if (
        shouldResolveBranch &&
        !notification.gitContext &&
        !branchInFlightRef.current.has(notification.id)
      ) {
        branchInFlightRef.current.add(notification.id)

        void (async () => {
          try {
            const worktrees = await fetchWorktrees(notification.workspacePath)
            const closest = resolveClosestWorktree(worktrees, gitDirectory, platform)
            if (!closest) {
              return
            }

            const branchName = closest.branch?.trim() ?? ''
            const headSha = closest.head?.trim() ?? ''

            if (branchName.length > 0) {
              setNotifications(prev =>
                updateNotification(prev, notification.id, current => {
                  if (
                    current.gitContext?.kind === 'branch' &&
                    current.gitContext.name === branchName
                  ) {
                    return current
                  }

                  return {
                    ...current,
                    gitContext: { kind: 'branch', name: branchName },
                  }
                }),
              )
              return
            }

            if (headSha.length > 0) {
              const shortHead = toShortSha(headSha)
              setNotifications(prev =>
                updateNotification(prev, notification.id, current => {
                  if (
                    current.gitContext?.kind === 'detached' &&
                    current.gitContext.head === headSha &&
                    current.gitContext.shortHead === shortHead
                  ) {
                    return current
                  }

                  return {
                    ...current,
                    gitContext: { kind: 'detached', head: headSha, shortHead },
                  }
                }),
              )
            }
          } finally {
            branchInFlightRef.current.delete(notification.id)
          }
        })()
      }

      const branchGitContext = notification.gitContext
      if (
        shouldResolvePullRequest &&
        branchGitContext &&
        branchGitContext.kind === 'branch' &&
        !notification.pullRequest &&
        !prInFlightRef.current.has(notification.id)
      ) {
        prInFlightRef.current.add(notification.id)

        void (async () => {
          try {
            const summary = await fetchPullRequest(
              notification.workspacePath,
              branchGitContext.name,
            )
            if (!summary) {
              return
            }

            setNotifications(prev =>
              updateNotification(prev, notification.id, current => {
                if (
                  current.pullRequest?.number === summary.number &&
                  current.pullRequest?.url === summary.ref.url
                ) {
                  return current
                }

                return {
                  ...current,
                  pullRequest: {
                    number: summary.number,
                    title: summary.title,
                    url: summary.ref.url,
                  },
                }
              }),
            )
          } finally {
            prInFlightRef.current.delete(notification.id)
          }
        })()
      }
    })
  }, [
    fetchPullRequest,
    fetchWorktrees,
    notifications,
    platform,
    setNotifications,
    shouldResolveBranch,
    shouldResolvePullRequest,
  ])
}
