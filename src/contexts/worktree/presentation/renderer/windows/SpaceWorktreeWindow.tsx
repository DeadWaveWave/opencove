import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Node } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { CreateGitWorktreeBranchMode, GitWorktreeInfo } from '@shared/contracts/dto'
import { SpaceWorktreeGuardWindow, type SpaceWorktreeGuardState } from './SpaceWorktreeGuardWindow'
import { SpaceWorktreeWindowDialog } from './SpaceWorktreeWindowDialog'
import {
  type BlockingNodesSnapshot,
  type BranchMode,
  getBranchNameValidationError,
  getWorktreeApiMethod,
  normalizeComparablePath,
  type PendingOperation,
  resolveWorktreesRoot,
  type SpaceWorktreeViewMode,
  type UpdateSpaceDirectoryOptions,
} from './spaceWorktree.shared'
import { useSpaceWorktreeGuardActions } from './useSpaceWorktreeGuardActions'
import { useSpaceWorktreePanelHandlers } from './useSpaceWorktreePanelHandlers'
import { useSpaceWorktreeRefresh } from './useSpaceWorktreeRefresh'
import { useSpaceWorktreeSuggestNames } from './useSpaceWorktreeSuggestNames'
import { toErrorMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

export function SpaceWorktreeWindow({
  spaceId,
  initialViewMode = 'home',
  spaces,
  nodes,
  workspacePath,
  worktreesRoot,
  agentSettings,
  onClose,
  onUpdateSpaceDirectory,
  getBlockingNodes,
  closeNodesById,
}: {
  spaceId: string | null
  initialViewMode?: 'home' | 'create' | 'archive'
  spaces: WorkspaceSpaceState[]
  nodes: Node<TerminalNodeData>[]
  workspacePath: string
  worktreesRoot: string
  agentSettings: AgentSettings
  onClose: () => void
  onUpdateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: UpdateSpaceDirectoryOptions,
  ) => void
  getBlockingNodes: (spaceId: string) => BlockingNodesSnapshot
  closeNodesById: (nodeIds: string[]) => Promise<void>
}): React.JSX.Element | null {
  const space = useMemo(
    () => (spaceId ? (spaces.find(candidate => candidate.id === spaceId) ?? null) : null),
    [spaceId, spaces],
  )

  const [viewMode, setViewMode] = useState<SpaceWorktreeViewMode>(initialViewMode)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [branchMode, setBranchMode] = useState<BranchMode>('new')
  const [newBranchName, setNewBranchName] = useState('')
  const [startPoint, setStartPoint] = useState('HEAD')
  const [existingBranchName, setExistingBranchName] = useState('')
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [deleteBranchOnArchive, setDeleteBranchOnArchive] = useState(false)
  const [archiveSpaceOnArchive, setArchiveSpaceOnArchive] = useState(false)

  const [guard, setGuard] = useState<
    (SpaceWorktreeGuardState & { pending: PendingOperation; spaceId: string }) | null
  >(null)

  const resolvedWorktreesRoot = useMemo(
    () => resolveWorktreesRoot(workspacePath, worktreesRoot),
    [workspacePath, worktreesRoot],
  )

  const normalizedWorkspacePath = useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const normalizedSpaceDirectory = useMemo(
    () => normalizeComparablePath(space?.directoryPath ?? workspacePath),
    [space?.directoryPath, workspacePath],
  )

  const isSpaceOnWorkspaceRoot = normalizedSpaceDirectory === normalizedWorkspacePath

  const currentWorktree = useMemo(
    () =>
      worktrees.find(entry => normalizeComparablePath(entry.path) === normalizedSpaceDirectory) ??
      null,
    [normalizedSpaceDirectory, worktrees],
  )

  const spaceTasks = useMemo(() => {
    if (!space) {
      return []
    }

    const spaceNodeIds = new Set(space.nodeIds)

    return nodes
      .filter(node => spaceNodeIds.has(node.id) && node.data.kind === 'task' && node.data.task)
      .map(node => ({
        title: node.data.title,
        requirement: node.data.task?.requirement ?? '',
      }))
  }, [nodes, space])

  const refresh = useSpaceWorktreeRefresh({
    workspacePath,
    setIsLoading,
    setError,
    setBranches,
    setCurrentBranch,
    setWorktrees,
    setExistingBranchName,
    setStartPoint,
  })

  const spaceIdentity = space?.id ?? null

  useEffect(() => {
    if (!spaceId || !spaceIdentity) {
      return
    }

    setViewMode(initialViewMode)
    setBranches([])
    setCurrentBranch(null)
    setWorktrees([])
    setBranchMode('new')
    setNewBranchName('')
    setStartPoint('HEAD')
    setExistingBranchName('')
    setIsSuggesting(false)
    setIsMutating(false)
    setDeleteBranchOnArchive(false)
    setArchiveSpaceOnArchive(false)
    setGuard(null)
    setError(null)

    void refresh()
  }, [initialViewMode, refresh, spaceId, spaceIdentity])

  const queueGuardIfNeeded = useCallback(
    (pending: PendingOperation, label: string): boolean => {
      if (!space) {
        return false
      }

      const blocking = getBlockingNodes(space.id)
      if (blocking.agentNodeIds.length === 0 && blocking.terminalNodeIds.length === 0) {
        return false
      }

      setGuard({
        spaceId: space.id,
        spaceName: space.name,
        agentCount: blocking.agentNodeIds.length,
        terminalCount: blocking.terminalNodeIds.length,
        pendingLabel: label,
        allowMarkMismatch: pending.kind === 'create',
        isBusy: false,
        error: null,
        pending,
      })

      return true
    },
    [getBlockingNodes, space],
  )

  const executePendingOperation = useCallback(
    async (
      targetSpaceId: string,
      pending: PendingOperation,
      options?: UpdateSpaceDirectoryOptions,
    ) => {
      if (pending.kind === 'create') {
        const createWorktree = getWorktreeApiMethod('create')
        const created = await createWorktree({
          repoPath: workspacePath,
          worktreesRoot: pending.worktreesRoot,
          branchMode: pending.branchMode,
        })

        const resolvedSpaceName =
          created.worktree.branch?.trim() || pending.branchMode.name.trim() || undefined

        onUpdateSpaceDirectory(targetSpaceId, created.worktree.path, {
          ...options,
          renameSpaceTo: resolvedSpaceName,
        })
        await refresh()
        return
      }

      const removeWorktree = getWorktreeApiMethod('remove')
      const removed = await removeWorktree({
        repoPath: workspacePath,
        worktreePath: pending.worktreePath,
        force: pending.force,
        deleteBranch: pending.deleteBranch,
      })

      const nextUpdateOptions =
        pending.archiveSpace || options?.markNodeDirectoryMismatch
          ? {
              ...options,
              archiveSpace: pending.archiveSpace || undefined,
            }
          : options

      onUpdateSpaceDirectory(targetSpaceId, workspacePath, nextUpdateOptions)
      setViewMode('home')
      setDeleteBranchOnArchive(false)
      setArchiveSpaceOnArchive(false)
      await refresh()

      if (removed.branchDeleteError) {
        throw new Error(`Space archived, but branch deletion failed: ${removed.branchDeleteError}`)
      }
    },
    [onUpdateSpaceDirectory, refresh, workspacePath],
  )

  const runOperation = useCallback(
    async (pending: PendingOperation, label: string) => {
      if (!space) {
        return
      }

      setError(null)
      if (queueGuardIfNeeded(pending, label)) {
        return
      }

      setIsMutating(true)
      let shouldClose = false
      try {
        await executePendingOperation(space.id, pending)
        shouldClose = pending.kind === 'create' || pending.kind === 'archive'
      } catch (operationError) {
        setError(toErrorMessage(operationError))
      } finally {
        setIsMutating(false)
      }

      if (shouldClose) {
        onClose()
      }
    },
    [executePendingOperation, onClose, queueGuardIfNeeded, space],
  )

  const { applyPendingWithMismatch, applyPendingByClosingAll } = useSpaceWorktreeGuardActions({
    guard,
    setGuard,
    getBlockingNodes,
    closeNodesById,
    executePendingOperation,
    onClose,
  })

  const handleSuggestNames = useSpaceWorktreeSuggestNames({
    space,
    spaceNotes: '',
    spaceTasks,
    agentSettings,
    workspacePath,
    setIsSuggesting,
    setError,
    setNewBranchName,
  })

  const handleCreate = useCallback(async () => {
    if (!space) {
      return
    }

    const branchModePayload: CreateGitWorktreeBranchMode =
      branchMode === 'existing'
        ? { kind: 'existing', name: existingBranchName.trim() }
        : {
            kind: 'new',
            name: newBranchName.trim(),
            startPoint: startPoint.trim().length > 0 ? startPoint.trim() : 'HEAD',
          }

    const branchValidationError = getBranchNameValidationError(branchModePayload.name)
    if (branchValidationError) {
      setError(branchValidationError)
      return
    }

    await runOperation(
      {
        kind: 'create',
        worktreesRoot: resolvedWorktreesRoot,
        branchMode: branchModePayload,
      },
      'Create & bind worktree',
    )
  }, [
    branchMode,
    existingBranchName,
    newBranchName,
    resolvedWorktreesRoot,
    runOperation,
    space,
    startPoint,
  ])

  const handleArchive = useCallback(async () => {
    if (!space) {
      return
    }

    if (isSpaceOnWorkspaceRoot) {
      setError('This Space is already using the workspace root.')
      return
    }

    await runOperation(
      {
        kind: 'archive',
        worktreePath: space.directoryPath,
        deleteBranch: deleteBranchOnArchive,
        archiveSpace: archiveSpaceOnArchive,
        force: false,
      },
      'Archive space',
    )
  }, [archiveSpaceOnArchive, deleteBranchOnArchive, isSpaceOnWorkspaceRoot, runOperation, space])

  const panelHandlers = useSpaceWorktreePanelHandlers({
    setError,
    setViewMode,
    setDeleteBranchOnArchive,
    setArchiveSpaceOnArchive,
    setBranchMode,
    setNewBranchName,
    setStartPoint,
    setExistingBranchName,
    handleSuggestNames,
    handleCreate,
    handleArchive,
  })

  if (!space) {
    return null
  }

  return (
    <>
      <SpaceWorktreeWindowDialog
        space={space}
        isSpaceOnWorkspaceRoot={isSpaceOnWorkspaceRoot}
        currentWorktree={currentWorktree}
        viewMode={viewMode}
        isBusy={isLoading || isMutating}
        isMutating={isMutating}
        isSuggesting={isSuggesting}
        branches={branches}
        currentBranch={currentBranch}
        branchMode={branchMode}
        newBranchName={newBranchName}
        startPoint={startPoint}
        existingBranchName={existingBranchName}
        deleteBranchOnArchive={deleteBranchOnArchive}
        archiveSpaceOnArchive={archiveSpaceOnArchive}
        error={error}
        guardIsBusy={guard?.isBusy === true}
        onBackdropClose={onClose}
        onClose={onClose}
        onOpenCreate={panelHandlers.onOpenCreate}
        onOpenArchive={panelHandlers.onOpenArchive}
        onBackHome={panelHandlers.onBackHome}
        onBranchModeChange={panelHandlers.onBranchModeChange}
        onNewBranchNameChange={panelHandlers.onNewBranchNameChange}
        onStartPointChange={panelHandlers.onStartPointChange}
        onExistingBranchNameChange={panelHandlers.onExistingBranchNameChange}
        onSuggestNames={panelHandlers.onSuggestNames}
        onCreate={panelHandlers.onCreate}
        onDeleteBranchOnArchiveChange={panelHandlers.onDeleteBranchOnArchiveChange}
        onArchiveSpaceOnArchiveChange={panelHandlers.onArchiveSpaceOnArchiveChange}
        onArchive={panelHandlers.onArchive}
      />

      {guard ? (
        <SpaceWorktreeGuardWindow
          guard={guard}
          onCancel={() => {
            setGuard(null)
          }}
          onMarkMismatchAndContinue={() => {
            void applyPendingWithMismatch()
          }}
          onCloseAllAndContinue={() => {
            void applyPendingByClosingAll()
          }}
        />
      ) : null}
    </>
  )
}
