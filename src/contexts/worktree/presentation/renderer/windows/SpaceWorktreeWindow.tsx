import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  SpaceArchiveRecord,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { ShowWorkspaceCanvasMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  CreateGitWorktreeBranchMode,
  GitWorktreeInfo,
  RemoveGitWorktreeResult,
} from '@shared/contracts/dto'
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
import { getSpaceArchiveCounts, resolveSpaceWorktreeStatusPath } from './spaceWorktreeWindowState'
import { buildArchiveWarningMessage } from './spaceWorktreeWarnings'
import { toSpaceWorktreeErrorMessage } from './spaceWorktreeErrorMessage'
import { buildSpaceArchiveRecord } from '@contexts/workspace/presentation/renderer/utils/spaceArchiveRecords'
import { closeBlockingNodesForArchive } from './closeBlockingNodesForArchive'
import { resolveSpaceArchiveGitSnapshot } from './resolveSpaceArchiveGitSnapshot'
import { resolveSpaceTasks } from './resolveSpaceTasks'

export function SpaceWorktreeWindow({
  spaceId,
  initialViewMode = 'create',
  spaces,
  nodes,
  workspacePath,
  worktreesRoot,
  agentSettings,
  onClose,
  onShowMessage,
  onAppendSpaceArchiveRecord,
  onUpdateSpaceDirectory,
  getBlockingNodes,
  closeNodesById,
}: {
  spaceId: string | null
  initialViewMode?: 'create' | 'archive'
  spaces: WorkspaceSpaceState[]
  nodes: Node<TerminalNodeData>[]
  workspacePath: string
  worktreesRoot: string
  agentSettings: AgentSettings
  onClose: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  onAppendSpaceArchiveRecord: (record: SpaceArchiveRecord) => void
  onUpdateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: UpdateSpaceDirectoryOptions,
  ) => void
  getBlockingNodes: (spaceId: string) => BlockingNodesSnapshot
  closeNodesById: (nodeIds: string[]) => Promise<void>
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const space = useMemo(
    () => (spaceId ? (spaces.find(candidate => candidate.id === spaceId) ?? null) : null),
    [spaceId, spaces],
  )
  const [viewMode, setViewMode] = useState<SpaceWorktreeViewMode>(initialViewMode)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [changedFileCount, setChangedFileCount] = useState(0)
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
  const [forceArchiveConfirmed, setForceArchiveConfirmed] = useState(false)

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
  const resolvedInitialViewMode: SpaceWorktreeViewMode = initialViewMode

  const currentWorktree = useMemo(
    () =>
      worktrees.find(entry => normalizeComparablePath(entry.path) === normalizedSpaceDirectory) ??
      null,
    [normalizedSpaceDirectory, worktrees],
  )

  const branchesWithWorktrees = useMemo(() => {
    const candidates = worktrees
      .map(entry => entry.branch?.trim())
      .filter((branch): branch is string => Boolean(branch && branch.length > 0))
    return new Set(candidates)
  }, [worktrees])

  const statusPath = useMemo(
    () =>
      resolveSpaceWorktreeStatusPath({
        workspacePath,
        isSpaceOnWorkspaceRoot,
        currentWorktree,
        spaceDirectoryPath: space?.directoryPath,
      }),
    [currentWorktree, isSpaceOnWorkspaceRoot, space?.directoryPath, workspacePath],
  )

  const spaceTasks = useMemo(() => resolveSpaceTasks(space, nodes), [nodes, space])

  const archiveCounts = useMemo(() => getSpaceArchiveCounts({ space, nodes }), [nodes, space])

  const refresh = useSpaceWorktreeRefresh({
    workspacePath,
    statusPath,
    setIsLoading,
    setError,
    setBranches,
    setCurrentBranch,
    setChangedFileCount,
    setWorktrees,
    setExistingBranchName,
    setStartPoint,
  })

  const spaceIdentity = space?.id ?? null

  useEffect(() => {
    if (!spaceId || !spaceIdentity) {
      return
    }

    setViewMode(resolvedInitialViewMode)
    setBranches([])
    setCurrentBranch(null)
    setChangedFileCount(0)
    setWorktrees([])
    setBranchMode('new')
    setNewBranchName('')
    setStartPoint('HEAD')
    setExistingBranchName('')
    setIsSuggesting(false)
    setIsMutating(false)
    setDeleteBranchOnArchive(false)
    setForceArchiveConfirmed(false)
    setGuard(null)
    setError(null)

    void refresh()
  }, [refresh, resolvedInitialViewMode, spaceId, spaceIdentity])

  useEffect(() => {
    if (changedFileCount === 0) {
      setForceArchiveConfirmed(false)
    }
  }, [changedFileCount])

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
        const createWorktree = getWorktreeApiMethod('create', t)
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

      const nextUpdateOptions =
        pending.archiveSpace || options?.markNodeDirectoryMismatch
          ? {
              ...options,
              archiveSpace: pending.archiveSpace || undefined,
            }
          : options

      let removedWorktreeResult: RemoveGitWorktreeResult | null = null

      if (pending.worktreePath) {
        const removeWorktree = getWorktreeApiMethod('remove', t)
        removedWorktreeResult = await removeWorktree({
          repoPath: workspacePath,
          worktreePath: pending.worktreePath,
          force: pending.force,
          deleteBranch: pending.deleteBranch,
        })
      }

      onUpdateSpaceDirectory(targetSpaceId, workspacePath, nextUpdateOptions)
      setDeleteBranchOnArchive(false)
      await refresh()

      if (removedWorktreeResult) {
        const warningMessage = buildArchiveWarningMessage(removedWorktreeResult, t)
        if (warningMessage) {
          onShowMessage?.(warningMessage, 'warning')
        }
      }
    },
    [onShowMessage, onUpdateSpaceDirectory, refresh, t, workspacePath],
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
        setError(toSpaceWorktreeErrorMessage(operationError, t))
      } finally {
        setIsMutating(false)
      }

      if (shouldClose) {
        onClose()
      }
    },
    [executePendingOperation, onClose, queueGuardIfNeeded, space, t],
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

    const branchValidationError = getBranchNameValidationError(branchModePayload.name, t)
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
      t('worktree.createAndBind'),
    )
  }, [
    branchMode,
    existingBranchName,
    newBranchName,
    resolvedWorktreesRoot,
    runOperation,
    space,
    startPoint,
    t,
  ])

  const handleArchive = useCallback(async () => {
    if (!space) {
      return
    }
    if (!isSpaceOnWorkspaceRoot && changedFileCount > 0 && !forceArchiveConfirmed) {
      return
    }

    const git = await resolveSpaceArchiveGitSnapshot({
      agentSettings,
      workspacePath,
      isSpaceOnWorkspaceRoot,
      spaceDirectoryPath: space.directoryPath,
      currentBranch,
      currentWorktree,
    })

    const snapshot = buildSpaceArchiveRecord({ space, nodes, git })
    setError(null)
    setIsMutating(true)
    try {
      const canContinue = await closeBlockingNodesForArchive(
        space.id,
        getBlockingNodes,
        closeNodesById,
      )
      if (!canContinue) {
        setError(t('worktreeGuard.closeFailed'))
        return
      }
      await executePendingOperation(space.id, {
        kind: 'archive',
        worktreePath: isSpaceOnWorkspaceRoot ? null : space.directoryPath,
        deleteBranch: isSpaceOnWorkspaceRoot ? false : deleteBranchOnArchive,
        archiveSpace: true,
        force: true,
      })
      onAppendSpaceArchiveRecord(snapshot)
      onClose()
    } catch (operationError) {
      setError(toSpaceWorktreeErrorMessage(operationError, t))
    } finally {
      setIsMutating(false)
    }
  }, [
    agentSettings,
    closeNodesById,
    currentBranch,
    currentWorktree,
    changedFileCount,
    deleteBranchOnArchive,
    executePendingOperation,
    forceArchiveConfirmed,
    getBlockingNodes,
    isSpaceOnWorkspaceRoot,
    onClose,
    onAppendSpaceArchiveRecord,
    space,
    t,
    nodes,
    workspacePath,
  ])
  const panelHandlers = useSpaceWorktreePanelHandlers({
    setError,
    setDeleteBranchOnArchive,
    setForceArchiveConfirmed,
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
        branchesWithWorktrees={branchesWithWorktrees}
        currentBranch={currentBranch}
        changedFileCount={changedFileCount}
        branchMode={branchMode}
        newBranchName={newBranchName}
        startPoint={startPoint}
        existingBranchName={existingBranchName}
        deleteBranchOnArchive={deleteBranchOnArchive}
        forceArchiveConfirmed={forceArchiveConfirmed}
        archiveAgentCount={archiveCounts.agentCount}
        archiveTerminalCount={archiveCounts.terminalCount}
        archiveTaskCount={archiveCounts.taskCount}
        archiveNoteCount={archiveCounts.noteCount}
        error={error}
        guardIsBusy={guard?.isBusy === true}
        onBackdropClose={onClose}
        onClose={onClose}
        onBranchModeChange={panelHandlers.onBranchModeChange}
        onNewBranchNameChange={panelHandlers.onNewBranchNameChange}
        onStartPointChange={panelHandlers.onStartPointChange}
        onExistingBranchNameChange={panelHandlers.onExistingBranchNameChange}
        onSuggestNames={panelHandlers.onSuggestNames}
        onCreate={panelHandlers.onCreate}
        onDeleteBranchOnArchiveChange={panelHandlers.onDeleteBranchOnArchiveChange}
        onForceArchiveConfirmedChange={panelHandlers.onForceArchiveConfirmedChange}
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
