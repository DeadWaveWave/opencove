import React, { useCallback, useEffect, useState } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  SpaceArchiveRecord,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { ShowWorkspaceCanvasMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { CreateGitWorktreeBranchMode, GitWorktreeInfo } from '@shared/contracts/dto'
import { isPathInsideOrEqual } from '@contexts/space/application/spaceBoundaryPolicy'
import { SpaceWorktreeGuardWindow, type SpaceWorktreeGuardState } from './SpaceWorktreeGuardWindow'
import { SpaceWorktreeWindowDialog } from './SpaceWorktreeWindowDialog'
import {
  type BlockingNodesSnapshot,
  type BranchMode,
  getBranchNameValidationError,
  getWorktreeApiMethod,
  removeArchiveWorktreesInOrder,
  type PendingOperation,
  type SpaceWorktreeViewMode,
  type UpdateSpaceDirectoryOptions,
} from './spaceWorktree.shared'
import { useSpaceWorktreeGuardActions } from './useSpaceWorktreeGuardActions'
import { useSpaceWorktreeDerivedState } from './useSpaceWorktreeDerivedState'
import { useSpaceWorktreePanelHandlers } from './useSpaceWorktreePanelHandlers'
import { useSpaceWorktreeRefresh } from './useSpaceWorktreeRefresh'
import { useSpaceWorktreeSuggestNames } from './useSpaceWorktreeSuggestNames'
import { buildArchiveWarningMessage } from './spaceWorktreeWarnings'
import { toSpaceWorktreeErrorMessage } from './spaceWorktreeErrorMessage'
import { useSpaceWorktreeArchiveState } from './useSpaceWorktreeArchiveState'
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
  const [deleteWorktreeOnArchive, setDeleteWorktreeOnArchive] = useState(
    agentSettings.archiveSpaceDeleteWorktreeByDefault,
  )
  const [deleteBranchOnArchive, setDeleteBranchOnArchive] = useState(false)
  const [forceArchiveConfirmed, setForceArchiveConfirmed] = useState(false)
  const [guard, setGuard] = useState<
    (SpaceWorktreeGuardState & { pending: PendingOperation; spaceId: string }) | null
  >(null)
  const {
    archiveCounts,
    archiveScope,
    branchesWithWorktrees,
    currentWorktree,
    hasOwnWorktree,
    isSpaceOnWorkspaceRoot,
    ownWorktree,
    resolvedInitialViewMode,
    resolvedWorktreesRoot,
    space,
    spaceTasks,
    statusPath,
    worktreeEligibility,
    worktreeApi,
    worktreeRepoRootPath,
    worktreeSpacesInScope,
  } = useSpaceWorktreeDerivedState({
    spaceId,
    spaces,
    worktrees,
    nodes,
    workspacePath,
    worktreesRoot,
    initialViewMode,
  })

  const refresh = useSpaceWorktreeRefresh({
    worktreeApi,
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
    setDeleteWorktreeOnArchive(agentSettings.archiveSpaceDeleteWorktreeByDefault)
    setDeleteBranchOnArchive(agentSettings.archiveSpaceDeleteBranchByDefault)
    setForceArchiveConfirmed(false)
    setGuard(null)
    setError(null)

    void refresh()
  }, [
    agentSettings.archiveSpaceDeleteBranchByDefault,
    agentSettings.archiveSpaceDeleteWorktreeByDefault,
    refresh,
    resolvedInitialViewMode,
    spaceId,
    spaceIdentity,
  ])

  useEffect(() => {
    if (changedFileCount === 0) {
      setForceArchiveConfirmed(false)
    }
  }, [changedFileCount])

  const getWorktreeEligibilityError = useCallback((): string | null => {
    switch (worktreeEligibility.reason) {
      case 'already_worktree':
        return t('worktree.createBlockedAlreadyWorktree')
      case 'worktree_ancestor':
        return t('worktree.createBlockedAncestorWorktree', {
          name: worktreeEligibility.ancestorWorktree?.space.name ?? t('worktree.workspaceRoot'),
        })
      case 'worktree_descendant':
        return t('worktree.createBlockedDescendantWorktree', {
          name: worktreeEligibility.descendantWorktree?.space.name ?? t('worktree.workspaceRoot'),
        })
      case 'space_not_found':
        return t('worktree.createBlockedSpaceMissing')
      case null:
        return null
      default:
        return null
    }
  }, [t, worktreeEligibility])

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
        const createWorktree = getWorktreeApiMethod(worktreeApi, 'create', t)
        const created = await createWorktree({
          repoPath: worktreeRepoRootPath,
          worktreesRoot: pending.worktreesRoot,
          branchMode: pending.branchMode,
        })

        const resolvedSpaceName =
          created.worktree.branch?.trim() || pending.branchMode.name.trim() || undefined
        const targetMountOptions =
          space?.targetMountId && !isPathInsideOrEqual(worktreeRepoRootPath, created.worktree.path)
            ? { targetMountId: null }
            : {}

        onUpdateSpaceDirectory(targetSpaceId, created.worktree.path, {
          ...options,
          ...targetMountOptions,
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

      const removedWorktreeResults =
        pending.worktreeCleanups.length > 0
          ? await removeArchiveWorktreesInOrder({
              cleanups: pending.worktreeCleanups,
              force: pending.force,
              removeWorktree: getWorktreeApiMethod(worktreeApi, 'remove', t),
              repoPath: worktreeRepoRootPath,
            })
          : []

      onUpdateSpaceDirectory(targetSpaceId, worktreeRepoRootPath, nextUpdateOptions)
      setDeleteBranchOnArchive(false)
      await refresh()

      for (const removedWorktreeResult of removedWorktreeResults) {
        const warningMessage = buildArchiveWarningMessage(removedWorktreeResult, t)
        if (warningMessage) {
          onShowMessage?.(warningMessage, 'warning')
        }
      }
    },
    [
      onShowMessage,
      onUpdateSpaceDirectory,
      refresh,
      space?.targetMountId,
      t,
      worktreeApi,
      worktreeRepoRootPath,
    ],
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
    worktreeApi,
    setIsSuggesting,
    setError,
    setNewBranchName,
  })

  const handleCreate = useCallback(async () => {
    if (!space) {
      return
    }

    if (!worktreeEligibility.canCreate) {
      setError(getWorktreeEligibilityError())
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
    getWorktreeEligibilityError,
    newBranchName,
    resolvedWorktreesRoot,
    runOperation,
    space,
    startPoint,
    t,
    worktreeEligibility.canCreate,
  ])

  const {
    descendantWorktreeCleanups,
    handleArchive,
    handleDescendantDeleteBranchOnArchiveChange,
    handleDescendantDeleteWorktreeOnArchiveChange,
  } = useSpaceWorktreeArchiveState({
    agentSettings,
    archiveScope,
    changedFileCount,
    closeNodesById,
    currentBranch,
    currentWorktree,
    deleteBranchOnArchive,
    deleteWorktreeOnArchive,
    executePendingOperation,
    forceArchiveConfirmed,
    getBlockingNodes,
    hasOwnWorktree,
    isSpaceOnWorkspaceRoot,
    nodes,
    onAppendSpaceArchiveRecord,
    onClose,
    ownWorktree,
    setError,
    setIsMutating,
    space,
    worktreeRepoRootPath,
    worktreeSpacesInScope,
  })
  const panelHandlers = useSpaceWorktreePanelHandlers({
    setError,
    setDeleteWorktreeOnArchive,
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
        deleteWorktreeOnArchive={deleteWorktreeOnArchive}
        deleteBranchOnArchive={deleteBranchOnArchive}
        forceArchiveConfirmed={forceArchiveConfirmed}
        archiveAgentCount={archiveCounts.agentCount}
        archiveTerminalCount={archiveCounts.terminalCount}
        archiveTaskCount={archiveCounts.taskCount}
        archiveNoteCount={archiveCounts.noteCount}
        archiveHasOwnWorktree={hasOwnWorktree}
        archiveDescendantWorktrees={descendantWorktreeCleanups}
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
        onDeleteWorktreeOnArchiveChange={panelHandlers.onDeleteWorktreeOnArchiveChange}
        onDeleteBranchOnArchiveChange={panelHandlers.onDeleteBranchOnArchiveChange}
        onDescendantDeleteWorktreeOnArchiveChange={handleDescendantDeleteWorktreeOnArchiveChange}
        onDescendantDeleteBranchOnArchiveChange={handleDescendantDeleteBranchOnArchiveChange}
        onForceArchiveConfirmedChange={panelHandlers.onForceArchiveConfirmedChange}
        onArchive={panelHandlers.onArchive}
        onCloseOnly={panelHandlers.onCloseOnly}
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
