import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import { WorkspaceSearch } from './WorkspaceSearch'

const EMPTY_SPACES: WorkspaceState['spaces'] = []

export function WorkspaceSearchOverlay({
  isOpen,
  activeWorkspace,
  onClose,
  onSelectSpace,
  panelWidth,
  onPanelWidthChange,
}: {
  isOpen: boolean
  activeWorkspace: WorkspaceState | null
  onClose: () => void
  onSelectSpace: (spaceId: string) => void
  panelWidth: number
  onPanelWidthChange: (nextWidth: number) => void
}): React.JSX.Element | null {
  const workspaceId = activeWorkspace?.id ?? null
  const workspacePath = activeWorkspace?.path ?? ''
  const spaces = activeWorkspace?.spaces ?? EMPTY_SPACES

  const githubPullRequestsEnabled = useAppStore(
    state => state.agentSettings.githubPullRequestsEnabled,
  )

  const normalizedWorkspacePath = useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const worktreeDirectoriesKey = useMemo(() => {
    if (spaces.length === 0 || normalizedWorkspacePath.length === 0) {
      return ''
    }

    const unique = new Set<string>()
    spaces.forEach(space => {
      const directoryPath = normalizeComparablePath(space.directoryPath)
      if (directoryPath.length === 0 || directoryPath === normalizedWorkspacePath) {
        return
      }

      unique.add(directoryPath)
    })

    return [...unique].sort((left, right) => left.localeCompare(right)).join('|')
  }, [normalizedWorkspacePath, spaces])

  const [worktreeInfoByPath, setWorktreeInfoByPath] = useState<Map<string, GitWorktreeInfo>>(
    () => new Map(),
  )

  useEffect(() => {
    if (!isOpen || worktreeDirectoriesKey.length === 0 || workspacePath.trim().length === 0) {
      setWorktreeInfoByPath(new Map())
      return
    }

    const listWorktrees = window.opencoveApi?.worktree?.listWorktrees
    if (typeof listWorktrees !== 'function') {
      setWorktreeInfoByPath(new Map())
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const result = await listWorktrees({ repoPath: workspacePath })
        if (cancelled) {
          return
        }

        const nextMap = new Map<string, GitWorktreeInfo>()
        result.worktrees.forEach(entry => {
          nextMap.set(normalizeComparablePath(entry.path), entry)
        })

        setWorktreeInfoByPath(nextMap)
      } catch {
        if (cancelled) {
          return
        }

        setWorktreeInfoByPath(new Map())
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, worktreeDirectoriesKey, workspacePath])

  const worktreeBranchesKey = useMemo(() => {
    if (spaces.length === 0 || worktreeInfoByPath.size === 0) {
      return ''
    }

    const unique = new Set<string>()
    spaces.forEach(space => {
      const directoryPath = normalizeComparablePath(space.directoryPath)
      if (directoryPath.length === 0 || directoryPath === normalizedWorkspacePath) {
        return
      }

      const info = worktreeInfoByPath.get(directoryPath)
      const branch = info?.branch?.trim() ?? ''
      if (branch.length > 0) {
        unique.add(branch)
      }
    })

    return [...unique].sort((left, right) => left.localeCompare(right)).join('|')
  }, [normalizedWorkspacePath, spaces, worktreeInfoByPath])

  const [pullRequestsByBranch, setPullRequestsByBranch] = useState<
    Record<string, GitHubPullRequestSummary | null>
  >(() => ({}))

  useEffect(() => {
    if (!isOpen || worktreeBranchesKey.length === 0 || workspacePath.trim().length === 0) {
      setPullRequestsByBranch({})
      return
    }

    if (!githubPullRequestsEnabled) {
      setPullRequestsByBranch({})
      return
    }

    const resolvePullRequests = window.opencoveApi?.integration?.github?.resolvePullRequests
    if (typeof resolvePullRequests !== 'function') {
      setPullRequestsByBranch({})
      return
    }

    let cancelled = false
    const branches = worktreeBranchesKey.split('|').filter(Boolean)

    void (async () => {
      try {
        const result = await resolvePullRequests({
          repoPath: workspacePath,
          branches,
        })

        if (cancelled) {
          return
        }

        setPullRequestsByBranch(result.pullRequestsByBranch)
      } catch {
        if (cancelled) {
          return
        }

        setPullRequestsByBranch(Object.fromEntries(branches.map(branch => [branch, null])))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [githubPullRequestsEnabled, isOpen, worktreeBranchesKey, workspacePath])

  const handleSelectNode = useCallback(
    (nodeId: string): void => {
      if (!workspaceId) {
        return
      }

      const store = useAppStore.getState()
      store.setFocusRequest(prev => ({
        workspaceId,
        nodeId,
        sequence: (prev?.sequence ?? 0) + 1,
      }))
    },
    [workspaceId],
  )

  return (
    <WorkspaceSearch
      isOpen={isOpen}
      activeWorkspace={activeWorkspace}
      onClose={onClose}
      onSelectNode={handleSelectNode}
      onSelectSpace={onSelectSpace}
      panelWidth={panelWidth}
      onPanelWidthChange={onPanelWidthChange}
      worktreeInfoByPath={worktreeInfoByPath.size > 0 ? worktreeInfoByPath : null}
      pullRequestsByBranch={
        Object.keys(pullRequestsByBranch).length > 0 ? pullRequestsByBranch : null
      }
    />
  )
}

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}
