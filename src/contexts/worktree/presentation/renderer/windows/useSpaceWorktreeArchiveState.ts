import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { SpaceArchiveScope } from '@contexts/space/application/spaceArchiveScope'
import type { SpaceWorktreeBinding } from '@contexts/space/application/spaceWorktreeEligibility'
import type {
  SpaceArchiveRecord,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { buildSpaceArchiveRecord } from '@contexts/workspace/presentation/renderer/utils/spaceArchiveRecords'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import { closeBlockingNodesForArchive } from './closeBlockingNodesForArchive'
import { resolveSpaceArchiveGitSnapshot } from './resolveSpaceArchiveGitSnapshot'
import type {
  BlockingNodesSnapshot,
  PendingOperation,
  UpdateSpaceDirectoryOptions,
} from './spaceWorktree.shared'
import { toSpaceWorktreeErrorMessage } from './spaceWorktreeErrorMessage'

export interface SpaceArchiveDescendantWorktreeCleanup {
  spaceId: string
  spaceName: string
  worktreePath: string
  branchName: string | null
  deleteWorktree: boolean
  deleteBranch: boolean
}

export function useSpaceWorktreeArchiveState({
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
  onOperationPhaseChange,
  ownWorktree,
  setError,
  setIsMutating,
  space,
  worktreeRepoRootPath,
  worktreeSpacesInScope,
}: {
  agentSettings: AgentSettings
  archiveScope: SpaceArchiveScope<WorkspaceSpaceState> | null
  changedFileCount: number
  closeNodesById: (nodeIds: string[]) => Promise<void>
  currentBranch: string | null
  currentWorktree: GitWorktreeInfo | null
  deleteBranchOnArchive: boolean
  deleteWorktreeOnArchive: boolean
  executePendingOperation: (
    targetSpaceId: string,
    pending: PendingOperation,
    options?: UpdateSpaceDirectoryOptions,
  ) => Promise<void>
  forceArchiveConfirmed: boolean
  getBlockingNodes: (spaceId: string) => BlockingNodesSnapshot
  hasOwnWorktree: boolean
  isSpaceOnWorkspaceRoot: boolean
  nodes: Node<TerminalNodeData>[]
  onAppendSpaceArchiveRecord: (record: SpaceArchiveRecord) => void
  onClose: () => void
  onOperationPhaseChange?: (phase: 'running' | 'error') => void
  ownWorktree: GitWorktreeInfo | null
  setError: Dispatch<SetStateAction<string | null>>
  setIsMutating: Dispatch<SetStateAction<boolean>>
  space: WorkspaceSpaceState | null
  worktreeRepoRootPath: string
  worktreeSpacesInScope: SpaceWorktreeBinding<WorkspaceSpaceState>[]
}) {
  const { t } = useTranslation()
  const [descendantCleanupBySpaceId, setDescendantCleanupBySpaceId] = useState<
    Record<string, { deleteWorktree: boolean; deleteBranch: boolean }>
  >({})

  useEffect(() => {
    setDescendantCleanupBySpaceId({})
  }, [space?.id])

  useEffect(() => {
    const descendantIds = new Set(
      worktreeSpacesInScope
        .map(binding => binding.space.id)
        .filter(scopedSpaceId => scopedSpaceId !== space?.id),
    )

    setDescendantCleanupBySpaceId(previous => {
      let changed = false
      const next: Record<string, { deleteWorktree: boolean; deleteBranch: boolean }> = {}
      for (const spaceId of descendantIds) {
        const current = previous[spaceId]
        next[spaceId] = current ?? { deleteWorktree: false, deleteBranch: false }
        if (!current) {
          changed = true
        }
      }

      if (Object.keys(previous).some(spaceId => !descendantIds.has(spaceId))) {
        changed = true
      }

      return changed ? next : previous
    })
  }, [space?.id, worktreeSpacesInScope])

  const descendantWorktreeCleanups = useMemo(
    () =>
      worktreeSpacesInScope
        .filter(binding => binding.space.id !== space?.id)
        .map(binding => {
          const cleanup = descendantCleanupBySpaceId[binding.space.id] ?? {
            deleteWorktree: false,
            deleteBranch: false,
          }

          return {
            spaceId: binding.space.id,
            spaceName: binding.space.name,
            worktreePath: binding.worktree.path,
            branchName: binding.worktree.branch ?? null,
            deleteWorktree: cleanup.deleteWorktree,
            deleteBranch: cleanup.deleteWorktree ? cleanup.deleteBranch : false,
          }
        }),
    [descendantCleanupBySpaceId, space?.id, worktreeSpacesInScope],
  )

  const archiveWorktreeCleanups = useMemo(() => {
    const cleanups: Array<{ spaceId: string; worktreePath: string; deleteBranch: boolean }> = []

    if (space && ownWorktree && deleteWorktreeOnArchive) {
      cleanups.push({
        spaceId: space.id,
        worktreePath: ownWorktree.path,
        deleteBranch: deleteBranchOnArchive,
      })
    }

    for (const cleanup of descendantWorktreeCleanups) {
      if (cleanup.deleteWorktree) {
        cleanups.push({
          spaceId: cleanup.spaceId,
          worktreePath: cleanup.worktreePath,
          deleteBranch: cleanup.deleteBranch,
        })
      }
    }

    return cleanups
  }, [
    deleteBranchOnArchive,
    deleteWorktreeOnArchive,
    descendantWorktreeCleanups,
    ownWorktree,
    space,
  ])

  const handleArchive = useCallback(
    async (saveArchiveRecord: boolean) => {
      if (!space || !archiveScope) {
        return
      }
      if (
        hasOwnWorktree &&
        deleteWorktreeOnArchive &&
        changedFileCount > 0 &&
        !forceArchiveConfirmed
      ) {
        return
      }

      setError(null)
      setIsMutating(true)
      onOperationPhaseChange?.('running')
      try {
        const git = saveArchiveRecord
          ? await resolveSpaceArchiveGitSnapshot({
              agentSettings,
              workspacePath: worktreeRepoRootPath,
              isSpaceOnWorkspaceRoot,
              spaceDirectoryPath: space.directoryPath,
              currentBranch,
              currentWorktree,
            })
          : null
        const snapshot = saveArchiveRecord
          ? buildSpaceArchiveRecord({ space, spaces: archiveScope.spaces, nodes, git })
          : null

        const canContinue = await closeBlockingNodesForArchive(
          archiveScope.archivedSpaceIds,
          getBlockingNodes,
          closeNodesById,
        )
        if (!canContinue) {
          setError(t('worktreeGuard.closeFailed'))
          onOperationPhaseChange?.('error')
          return
        }
        await executePendingOperation(space.id, {
          kind: 'archive',
          worktreeCleanups: archiveWorktreeCleanups,
          archiveSpace: true,
          force: true,
        })
        if (snapshot) {
          onAppendSpaceArchiveRecord(snapshot)
        }
        onClose()
      } catch (operationError) {
        setError(toSpaceWorktreeErrorMessage(operationError, t))
        onOperationPhaseChange?.('error')
      } finally {
        setIsMutating(false)
      }
    },
    [
      agentSettings,
      archiveScope,
      archiveWorktreeCleanups,
      changedFileCount,
      closeNodesById,
      currentBranch,
      currentWorktree,
      deleteWorktreeOnArchive,
      executePendingOperation,
      forceArchiveConfirmed,
      getBlockingNodes,
      hasOwnWorktree,
      isSpaceOnWorkspaceRoot,
      nodes,
      onAppendSpaceArchiveRecord,
      onClose,
      onOperationPhaseChange,
      setError,
      setIsMutating,
      space,
      t,
      worktreeRepoRootPath,
    ],
  )

  const handleDescendantDeleteWorktreeOnArchiveChange = useCallback(
    (targetSpaceId: string, checked: boolean) => {
      setDescendantCleanupBySpaceId(previous => ({
        ...previous,
        [targetSpaceId]: {
          deleteWorktree: checked,
          deleteBranch: checked ? (previous[targetSpaceId]?.deleteBranch ?? false) : false,
        },
      }))
    },
    [],
  )

  const handleDescendantDeleteBranchOnArchiveChange = useCallback(
    (targetSpaceId: string, checked: boolean) => {
      setDescendantCleanupBySpaceId(previous => ({
        ...previous,
        [targetSpaceId]: {
          deleteWorktree: previous[targetSpaceId]?.deleteWorktree ?? false,
          deleteBranch: checked,
        },
      }))
    },
    [],
  )

  return {
    descendantWorktreeCleanups,
    handleArchive,
    handleDescendantDeleteBranchOnArchiveChange,
    handleDescendantDeleteWorktreeOnArchiveChange,
  }
}
