import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import type { BranchMode, SpaceWorktreeViewMode } from './spaceWorktree.shared'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function SpaceWorktreePanels({
  viewMode,
  isBusy,
  isMutating,
  isSuggesting,
  isSpaceOnWorkspaceRoot,
  changedFileCount,
  forceArchiveConfirmed,
  branches,
  branchesWithWorktrees,
  currentBranch,
  branchMode,
  newBranchName,
  startPoint,
  existingBranchName,
  deleteWorktreeOnArchive,
  deleteBranchOnArchive,
  onClose,
  onBranchModeChange,
  onNewBranchNameChange,
  onStartPointChange,
  onExistingBranchNameChange,
  onSuggestNames,
  onCreate,
  onDeleteWorktreeOnArchiveChange,
  onDeleteBranchOnArchiveChange,
  onForceArchiveConfirmedChange,
  onArchive,
  onCloseOnly,
}: {
  viewMode: SpaceWorktreeViewMode
  isBusy: boolean
  isMutating: boolean
  isSuggesting: boolean
  isSpaceOnWorkspaceRoot: boolean
  changedFileCount: number
  forceArchiveConfirmed: boolean
  branches: string[]
  branchesWithWorktrees: ReadonlySet<string>
  currentBranch: string | null
  branchMode: BranchMode
  newBranchName: string
  startPoint: string
  existingBranchName: string
  deleteWorktreeOnArchive: boolean
  deleteBranchOnArchive: boolean
  onClose: () => void
  onBranchModeChange: (mode: BranchMode) => void
  onNewBranchNameChange: (value: string) => void
  onStartPointChange: (value: string) => void
  onExistingBranchNameChange: (value: string) => void
  onSuggestNames: () => void
  onCreate: () => void
  onDeleteWorktreeOnArchiveChange: (checked: boolean) => void
  onDeleteBranchOnArchiveChange: (checked: boolean) => void
  onForceArchiveConfirmedChange: (checked: boolean) => void
  onArchive: () => void
  onCloseOnly: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const requiresForceArchiveConfirmation = !isSpaceOnWorkspaceRoot && changedFileCount > 0

  return (
    <>
      {viewMode === 'create' ? (
        <div className="workspace-space-worktree__view" data-testid="space-worktree-create-view">
          <div className="workspace-space-worktree__view-header">
            <h4>{t('worktree.createWorktree')}</h4>
          </div>

          <section className="workspace-space-worktree__surface workspace-space-worktree__surface--minimal">
            <div
              className="workspace-space-worktree__segment-control"
              role="tablist"
              aria-label={t('worktree.branchMode')}
            >
              <button
                type="button"
                className={
                  branchMode === 'new'
                    ? 'workspace-space-worktree__segment workspace-space-worktree__segment--active'
                    : 'workspace-space-worktree__segment'
                }
                data-testid="space-worktree-mode-new"
                role="tab"
                aria-selected={branchMode === 'new'}
                disabled={isBusy}
                onClick={() => {
                  onBranchModeChange('new')
                }}
              >
                {t('worktree.newBranch')}
              </button>
              <button
                type="button"
                className={
                  branchMode === 'existing'
                    ? 'workspace-space-worktree__segment workspace-space-worktree__segment--active'
                    : 'workspace-space-worktree__segment'
                }
                data-testid="space-worktree-mode-existing"
                role="tab"
                aria-selected={branchMode === 'existing'}
                disabled={isBusy}
                onClick={() => {
                  onBranchModeChange('existing')
                }}
              >
                {t('worktree.existingBranch')}
              </button>
            </div>

            <div className="workspace-space-worktree__content-block">
              {branchMode === 'new' ? (
                <div
                  className="workspace-space-worktree__create-grid"
                  data-testid="space-worktree-create-grid"
                >
                  <div className="cove-window__field-row">
                    <label htmlFor="space-worktree-start-point">{t('worktree.startPoint')}</label>
                    <CoveSelect
                      id="space-worktree-start-point"
                      testId="space-worktree-start-point"
                      value={startPoint}
                      disabled={isBusy}
                      options={[
                        { value: 'HEAD', label: 'HEAD' },
                        ...(currentBranch ? [{ value: currentBranch, label: currentBranch }] : []),
                        ...branches
                          .filter(branch => branch !== currentBranch)
                          .map(branch => ({
                            value: branch,
                            label: branch,
                          })),
                      ]}
                      onChange={nextValue => {
                        onStartPointChange(nextValue)
                      }}
                    />
                  </div>

                  <div className="cove-window__field-row workspace-space-worktree__create-grid-span-two">
                    <label htmlFor="space-worktree-branch-name">{t('worktree.branchName')}</label>
                    <input
                      id="space-worktree-branch-name"
                      data-testid="space-worktree-branch-name"
                      value={newBranchName}
                      disabled={isBusy}
                      placeholder={t('worktree.branchPlaceholder')}
                      onChange={event => {
                        onNewBranchNameChange(event.target.value)
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="workspace-space-worktree__create-grid workspace-space-worktree__create-grid--single"
                  data-testid="space-worktree-create-grid"
                >
                  <div className="cove-window__field-row">
                    <label htmlFor="space-worktree-existing-branch">{t('worktree.branch')}</label>
                    <CoveSelect
                      id="space-worktree-existing-branch"
                      testId="space-worktree-existing-branch"
                      value={existingBranchName}
                      disabled={isBusy}
                      options={branches.map(branch => ({
                        value: branch,
                        label: branch,
                        badge: branchesWithWorktrees.has(branch)
                          ? t('worktree.branchHasWorktree')
                          : undefined,
                      }))}
                      onChange={nextValue => {
                        onExistingBranchNameChange(nextValue)
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="workspace-space-worktree__inline-actions workspace-space-worktree__inline-actions--footer">
                {AI_NAMING_FEATURES.worktreeNameSuggestion ? (
                  <button
                    type="button"
                    className="cove-window__action cove-window__action--secondary"
                    data-testid="space-worktree-suggest-ai"
                    disabled={isBusy}
                    onClick={onSuggestNames}
                  >
                    {isSuggesting ? t('common.generating') : t('common.generateByAi')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cove-window__action cove-window__action--primary"
                  data-testid="space-worktree-create"
                  disabled={isBusy}
                  onClick={onCreate}
                >
                  {isMutating ? t('common.generating') : t('worktree.createAndBind')}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {viewMode === 'archive' ? (
        <div className="workspace-space-worktree__view" data-testid="space-worktree-archive-view">
          <section className="workspace-space-worktree__surface workspace-space-worktree__surface--minimal">
            {isSpaceOnWorkspaceRoot ? null : (
              <div className="workspace-space-worktree__message-block">
                {changedFileCount > 0 ? (
                  <p
                    className="workspace-space-worktree__supporting-text"
                    data-testid="space-worktree-archive-uncommitted-warning"
                  >
                    {t('worktree.archiveUncommittedChangesWarning')}
                  </p>
                ) : null}
              </div>
            )}

            <div className="workspace-space-worktree__option-list">
              {requiresForceArchiveConfirmation ? (
                <label className="cove-window__checkbox workspace-space-worktree__option-row">
                  <input
                    type="checkbox"
                    data-testid="space-worktree-archive-force-confirm"
                    checked={forceArchiveConfirmed}
                    disabled={isBusy}
                    onChange={event => {
                      onForceArchiveConfirmedChange(event.target.checked)
                    }}
                  />
                  <span className="workspace-space-worktree__option-copy workspace-space-worktree__option-copy--inline">
                    <strong>{t('worktree.forceArchiveConfirm')}</strong>
                    <span>{t('worktree.forceArchiveConfirmHelp')}</span>
                  </span>
                </label>
              ) : null}

              {!isSpaceOnWorkspaceRoot ? (
                <label className="cove-window__checkbox workspace-space-worktree__option-row">
                  <input
                    type="checkbox"
                    data-testid="space-worktree-archive-delete-worktree"
                    checked={deleteWorktreeOnArchive}
                    disabled={isBusy}
                    onChange={event => {
                      onDeleteWorktreeOnArchiveChange(event.target.checked)
                    }}
                  />
                  <span className="workspace-space-worktree__option-copy workspace-space-worktree__option-copy--inline">
                    <strong>{t('worktree.deleteWorktree')}</strong>
                    <span>{t('worktree.deleteWorktreeHelp')}</span>
                  </span>
                </label>
              ) : null}

              {!isSpaceOnWorkspaceRoot ? (
                <label className="cove-window__checkbox workspace-space-worktree__option-row">
                  <input
                    type="checkbox"
                    data-testid="space-worktree-archive-delete-branch"
                    checked={deleteBranchOnArchive}
                    disabled={isBusy || !deleteWorktreeOnArchive}
                    onChange={event => {
                      onDeleteBranchOnArchiveChange(event.target.checked)
                    }}
                  />
                  <span className="workspace-space-worktree__option-copy workspace-space-worktree__option-copy--inline">
                    <strong>{t('worktree.deleteBranch')}</strong>
                    <span>{t('worktree.deleteBranchHelp')}</span>
                  </span>
                </label>
              ) : null}
            </div>

            <div className="workspace-space-worktree__inline-actions workspace-space-worktree__inline-actions--footer">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                data-testid="space-worktree-archive-cancel"
                disabled={isBusy}
                onClick={onClose}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                data-testid="space-worktree-archive-close-only"
                disabled={isBusy || (requiresForceArchiveConfirmation && !forceArchiveConfirmed)}
                onClick={onCloseOnly}
              >
                {isMutating ? t('common.loading') : t('worktree.executeAndClose')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--danger"
                data-testid="space-worktree-archive-submit"
                disabled={isBusy || (requiresForceArchiveConfirmation && !forceArchiveConfirmed)}
                onClick={onArchive}
              >
                {isMutating ? t('common.loading') : t('worktree.executeAndArchive')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
