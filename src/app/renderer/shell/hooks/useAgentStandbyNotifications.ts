import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStandbyNotification } from '../components/AppNotifications'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import {
  type AgentStandbyNotificationPayload,
  useAgentStandbyNotificationWatcher,
} from './useAgentStandbyNotificationWatcher'

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

function resolveTaskTitle(workspace: WorkspaceState | null, taskId: string | null): string | null {
  if (!workspace || !taskId) {
    return null
  }

  const taskNode = workspace.nodes.find(node => node.id === taskId)
  if (!taskNode) {
    return null
  }

  return typeof taskNode.data?.title === 'string' && taskNode.data.title.trim().length > 0
    ? taskNode.data.title
    : null
}

function resolveOwningSpace(
  workspace: WorkspaceState | null,
  nodeId: string,
  taskId: string | null,
): { id: string; name: string; directoryPath: string } | null {
  if (!workspace) {
    return null
  }

  const match =
    workspace.spaces.find(space => space.nodeIds.includes(nodeId)) ??
    (taskId ? workspace.spaces.find(space => space.nodeIds.includes(taskId)) : null) ??
    null

  if (!match) {
    return null
  }

  return {
    id: match.id,
    name: match.name,
    directoryPath: match.directoryPath,
  }
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

export function useAgentStandbyNotifications({
  maxVisible = 5,
}: {
  maxVisible?: number
} = {}): {
  notifications: AgentStandbyNotification[]
  dismiss: (id: string) => void
} {
  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined
  const workspaces = useAppStore(state => state.workspaces)
  const isStandbyBannerEnabled = useAppStore(state => state.agentSettings.standbyBannerEnabled)
  const showBranch = useAppStore(state => state.agentSettings.standbyBannerShowBranch)
  const showPullRequest = useAppStore(state => state.agentSettings.standbyBannerShowPullRequest)
  const githubPullRequestsEnabled = useAppStore(
    state => state.agentSettings.githubPullRequestsEnabled,
  )
  const shouldResolveBranch =
    isStandbyBannerEnabled && (showBranch || (showPullRequest && githubPullRequestsEnabled))
  const shouldResolvePullRequest =
    isStandbyBannerEnabled && showPullRequest && githubPullRequestsEnabled

  const [notifications, setNotifications] = useState<AgentStandbyNotification[]>([])
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

  const workspacesById = useMemo(() => {
    return new Map(workspaces.map(workspace => [workspace.id, workspace]))
  }, [workspaces])

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

  const handleAgentEnteredStandby = useCallback(
    (payload: AgentStandbyNotificationPayload) => {
      if (!isStandbyBannerEnabled) {
        return
      }

      const workspace = workspacesById.get(payload.workspaceId) ?? null
      const taskTitle = resolveTaskTitle(workspace, payload.taskId)
      const space = resolveOwningSpace(workspace, payload.nodeId, payload.taskId)

      setNotifications(previous => {
        if (previous.some(notification => notification.id === payload.sessionId)) {
          return previous
        }

        const next: AgentStandbyNotification = {
          kind: 'agent-standby',
          id: payload.sessionId,
          sessionId: payload.sessionId,
          workspaceId: payload.workspaceId,
          workspaceName: payload.workspaceName,
          workspacePath: payload.workspacePath,
          nodeId: payload.nodeId,
          title: payload.title,
          taskId: payload.taskId,
          taskTitle,
          spaceId: space?.id ?? null,
          spaceName: space?.name ?? null,
          spaceDirectoryPath: space?.directoryPath ?? null,
          executionDirectory: payload.executionDirectory,
          gitContext: null,
          pullRequest: null,
          createdAt: Date.now(),
        }

        if (!shouldResolveBranch && !shouldResolvePullRequest) {
          const updated = [next, ...previous]
          return updated.length > maxVisible ? updated.slice(0, maxVisible) : updated
        }

        const updated = [next, ...previous]
        return updated.length > maxVisible ? updated.slice(0, maxVisible) : updated
      })
    },
    [
      isStandbyBannerEnabled,
      maxVisible,
      shouldResolveBranch,
      shouldResolvePullRequest,
      workspacesById,
    ],
  )

  const handleAgentEnteredWorking = useCallback((sessionId: string) => {
    setNotifications(previous =>
      previous.filter(notification => notification.sessionId !== sessionId),
    )
  }, [])

  useEffect(() => {
    if (isStandbyBannerEnabled) {
      return
    }

    setNotifications([])
  }, [isStandbyBannerEnabled])

  const dismiss = useCallback((id: string) => {
    setNotifications(previous => previous.filter(notification => notification.id !== id))
  }, [])

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
    shouldResolveBranch,
    shouldResolvePullRequest,
  ])

  useAgentStandbyNotificationWatcher({
    enabled: isStandbyBannerEnabled,
    onAgentEnteredStandby: handleAgentEnteredStandby,
    onAgentEnteredWorking: handleAgentEnteredWorking,
  })

  return { notifications, dismiss }
}
