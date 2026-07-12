import React from 'react'
import { GitBranch, X } from 'lucide-react'
import {
  AnchoredOperationPopover,
  type AnchoredOperationPopoverAnchor,
} from '@app/renderer/components/AnchoredOperationPopover'
import { useTranslation } from '@app/renderer/i18n'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { SpaceWorktreePanels } from './SpaceWorktreePanels'
import type { BranchMode, SpaceWorktreeViewMode } from './spaceWorktree.shared'

export function SpaceWorktreeWindowDialog({
  anchor,
  space,
  isSpaceOnWorkspaceRoot,
  currentWorktree,
  viewMode,
  isBusy,
  isMutating,
  isSuggesting,
  branches,
  branchesWithWorktrees,
  currentBranch,
  changedFileCount,
  branchMode,
  newBranchName,
  startPoint,
  existingBranchName,
  deleteWorktreeOnArchive,
  deleteBranchOnArchive,
  forceArchiveConfirmed,
  archiveAgentCount,
  archiveTerminalCount,
  archiveTaskCount,
  archiveNoteCount,
  archiveHasOwnWorktree,
  archiveDescendantWorktrees,
  error,
  guardIsBusy,
  onBackdropClose,
  onClose,
  onBranchModeChange,
  onNewBranchNameChange,
  onStartPointChange,
  onExistingBranchNameChange,
  onSuggestNames,
  onCreate,
  onDeleteWorktreeOnArchiveChange,
  onDeleteBranchOnArchiveChange,
  onDescendantDeleteWorktreeOnArchiveChange,
  onDescendantDeleteBranchOnArchiveChange,
  onForceArchiveConfirmedChange,
  onArchive,
  onCloseOnly,
}: {
  anchor: AnchoredOperationPopoverAnchor
  space: WorkspaceSpaceState
  isSpaceOnWorkspaceRoot: boolean
  currentWorktree: GitWorktreeInfo | null
  viewMode: SpaceWorktreeViewMode
  isBusy: boolean
  isMutating: boolean
  isSuggesting: boolean
  branches: string[]
  branchesWithWorktrees: ReadonlySet<string>
  currentBranch: string | null
  changedFileCount: number
  branchMode: BranchMode
  newBranchName: string
  startPoint: string
  existingBranchName: string
  deleteWorktreeOnArchive: boolean
  deleteBranchOnArchive: boolean
  forceArchiveConfirmed: boolean
  archiveAgentCount: number
  archiveTerminalCount: number
  archiveTaskCount: number
  archiveNoteCount: number
  archiveHasOwnWorktree: boolean
  archiveDescendantWorktrees: Array<{
    spaceId: string
    spaceName: string
    worktreePath: string
    branchName: string | null
    deleteWorktree: boolean
    deleteBranch: boolean
  }>
  error: string | null
  guardIsBusy: boolean
  onBackdropClose: () => void
  onClose: () => void
  onBranchModeChange: (mode: BranchMode) => void
  onNewBranchNameChange: (value: string) => void
  onStartPointChange: (value: string) => void
  onExistingBranchNameChange: (value: string) => void
  onSuggestNames: () => void
  onCreate: () => void
  onDeleteWorktreeOnArchiveChange: (checked: boolean) => void
  onDeleteBranchOnArchiveChange: (checked: boolean) => void
  onDescendantDeleteWorktreeOnArchiveChange: (spaceId: string, checked: boolean) => void
  onDescendantDeleteBranchOnArchiveChange: (spaceId: string, checked: boolean) => void
  onForceArchiveConfirmedChange: (checked: boolean) => void
  onArchive: () => void
  onCloseOnly: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const statusLabel = currentWorktree?.branch?.trim()
    ? currentWorktree.branch
    : isSpaceOnWorkspaceRoot
      ? t('worktree.workspaceRoot')
      : currentWorktree?.head?.trim()
        ? currentWorktree.head.slice(0, 7)
        : t('worktree.detachedHead')
  const headerTitle =
    viewMode === 'archive'
      ? isSpaceOnWorkspaceRoot
        ? t('worktree.archiveSpace')
        : t('worktree.archiveWorktreeSpace')
      : space.name
  const archiveSummary = [
    archiveAgentCount > 0 ? t('worktree.archiveAgents', { count: archiveAgentCount }) : null,
    archiveTerminalCount > 0
      ? t('worktree.archiveTerminals', { count: archiveTerminalCount })
      : null,
    archiveTaskCount > 0 ? t('worktree.archiveTasks', { count: archiveTaskCount }) : null,
    archiveNoteCount > 0 ? t('worktree.archiveNotes', { count: archiveNoteCount }) : null,
  ]
    .filter(part => part !== null)
    .join(' · ')

  return (
    <AnchoredOperationPopover
      anchor={anchor}
      ariaLabel={headerTitle}
      className={
        viewMode === 'archive'
          ? 'workspace-space-worktree-popover workspace-space-worktree-popover--archive'
          : 'workspace-space-worktree-popover'
      }
      dismissDisabled={isBusy || guardIsBusy}
      estimatedHeight={viewMode === 'archive' ? 500 : 420}
      onDismiss={onBackdropClose}
      testId="space-worktree-popover"
    >
      <section
        className={
          viewMode === 'archive'
            ? 'cove-window workspace-space-worktree workspace-space-worktree--archive'
            : 'cove-window workspace-space-worktree'
        }
        data-testid="space-worktree-window"
      >
        <header className="workspace-space-worktree__header">
          <div className="workspace-space-worktree__header-main">
            <div className="workspace-space-worktree__title-group">
              <div className="workspace-space-worktree__title-line">
                <h3>{headerTitle}</h3>
                {viewMode === 'archive' && archiveSummary.length > 0 ? (
                  <p
                    className="workspace-space-worktree__header-summary"
                    data-testid="space-worktree-archive-summary"
                  >
                    {archiveSummary}
                  </p>
                ) : null}
              </div>
            </div>
            <div
              className="workspace-space-worktree__status-line"
              data-testid="space-worktree-status"
            >
              <GitBranch size={14} aria-hidden="true" />
              <span>{statusLabel}</span>
              <span className="workspace-space-worktree__status-divider" aria-hidden="true">
                ·
              </span>
              <span className="workspace-space-worktree__status-count">
                {changedFileCount === 0
                  ? t('worktree.clean')
                  : t('worktree.changedFiles', { count: changedFileCount })}
              </span>
            </div>
            {viewMode === 'create' ? (
              <button
                type="button"
                className="workspace-space-worktree__close"
                data-testid="space-worktree-close"
                aria-label={t('worktree.closeWorktreeWindow')}
                disabled={isBusy || guardIsBusy}
                onClick={onClose}
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </header>

        <SpaceWorktreePanels
          viewMode={viewMode}
          isBusy={isBusy}
          isMutating={isMutating}
          isSuggesting={isSuggesting}
          archiveHasOwnWorktree={archiveHasOwnWorktree}
          archiveDescendantWorktrees={archiveDescendantWorktrees}
          changedFileCount={changedFileCount}
          branches={branches}
          branchesWithWorktrees={branchesWithWorktrees}
          currentBranch={currentBranch}
          branchMode={branchMode}
          newBranchName={newBranchName}
          startPoint={startPoint}
          existingBranchName={existingBranchName}
          deleteWorktreeOnArchive={deleteWorktreeOnArchive}
          deleteBranchOnArchive={deleteBranchOnArchive}
          forceArchiveConfirmed={forceArchiveConfirmed}
          onClose={onClose}
          onBranchModeChange={onBranchModeChange}
          onNewBranchNameChange={onNewBranchNameChange}
          onStartPointChange={onStartPointChange}
          onExistingBranchNameChange={onExistingBranchNameChange}
          onSuggestNames={onSuggestNames}
          onCreate={onCreate}
          onDeleteWorktreeOnArchiveChange={onDeleteWorktreeOnArchiveChange}
          onDeleteBranchOnArchiveChange={onDeleteBranchOnArchiveChange}
          onDescendantDeleteWorktreeOnArchiveChange={onDescendantDeleteWorktreeOnArchiveChange}
          onDescendantDeleteBranchOnArchiveChange={onDescendantDeleteBranchOnArchiveChange}
          onForceArchiveConfirmedChange={onForceArchiveConfirmedChange}
          onArchive={onArchive}
          onCloseOnly={onCloseOnly}
        />

        {error ? (
          <p className="cove-window__error workspace-space-worktree__error">{error}</p>
        ) : null}
      </section>
    </AnchoredOperationPopover>
  )
}
