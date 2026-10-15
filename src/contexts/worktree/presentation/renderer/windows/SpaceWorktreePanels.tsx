import React from 'react'
import { Checkbox } from '@app/renderer/components/ui/Checkbox'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { useTranslation } from '@app/renderer/i18n'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import type { BranchMode, SpaceWorktreeViewMode } from './spaceWorktree.shared'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function SpaceWorktreePanels({
  viewMode,
  isBusy,
  isMutating,
  isSuggesting,
  archiveHasOwnWorktree,
  archiveDescendantWorktrees,
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
  onDescendantDeleteWorktreeOnArchiveChange,
  onDescendantDeleteBranchOnArchiveChange,
  onForceArchiveConfirmedChange,
  onArchive,
  onCloseOnly,
}: {
  viewMode: SpaceWorktreeViewMode
  isBusy: boolean
  isMutating: boolean
  isSuggesting: boolean
  archiveHasOwnWorktree: boolean
  archiveDescendantWorktrees: Array<{
    spaceId: string
    spaceName: string
    worktreePath: string
    branchName: string | null
    deleteWorktree: boolean
    deleteBranch: boolean
  }>
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
  onDescendantDeleteWorktreeOnArchiveChange: (spaceId: string, checked: boolean) => void
  onDescendantDeleteBranchOnArchiveChange: (spaceId: string, checked: boolean) => void
  onForceArchiveConfirmedChange: (checked: boolean) => void
  onArchive: () => void
  onCloseOnly: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const requiresForceArchiveConfirmation =
    archiveHasOwnWorktree && deleteWorktreeOnArchive && changedFileCount > 0

  return (
    <>
      {viewMode === 'create' ? (
        <div className="workspace-space-worktree__view" data-testid="space-worktree-create-view">
          <div className="workspace-space-worktree__view-header">
            <h4>{t('worktree.createWorktree')}</h4>
          </div>

          <section className="workspace-space-worktree__surface workspace-space-worktree__surface--minimal">
            <SegmentedControl
              className="workspace-space-worktree__segment-control"
              label={t('worktree.branchMode')}
              value={branchMode}
              disabled={isBusy}
              options={[
                {
                  value: 'new',
                  label: t('worktree.newBranch'),
                  testId: 'space-worktree-mode-new',
                },
                {
                  value: 'existing',
                  label: t('worktree.existingBranch'),
                  testId: 'space-worktree-mode-existing',
                },
              ]}
              onValueChange={onBranchModeChange}
            />

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
                      menuLayer="dialog-popover"
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
                      menuLayer="dialog-popover"
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
            {!archiveHasOwnWorktree && archiveDescendantWorktrees.length === 0 ? null : (
              <div className="workspace-space-worktree__message-block">
                {archiveHasOwnWorktree && changedFileCount > 0 ? (
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
                <Checkbox
                  className="workspace-space-worktree__option-row"
                  data-testid="space-worktree-archive-force-confirm"
                  checked={forceArchiveConfirmed}
                  disabled={isBusy}
                  description={t('worktree.forceArchiveConfirmHelp')}
                  onCheckedChange={checked => {
                    onForceArchiveConfirmedChange(checked)
                  }}
                >
                  {t('worktree.forceArchiveConfirm')}
                </Checkbox>
              ) : null}

              {archiveHasOwnWorktree ? (
                <Checkbox
                  className="workspace-space-worktree__option-row"
                  data-testid="space-worktree-archive-delete-worktree"
                  checked={deleteWorktreeOnArchive}
                  disabled={isBusy}
                  description={t('worktree.deleteWorktreeHelp')}
                  onCheckedChange={checked => {
                    onDeleteWorktreeOnArchiveChange(checked)
                  }}
                >
                  {t('worktree.deleteWorktree')}
                </Checkbox>
              ) : null}

              {archiveHasOwnWorktree ? (
                <Checkbox
                  className="workspace-space-worktree__option-row"
                  data-testid="space-worktree-archive-delete-branch"
                  checked={deleteBranchOnArchive}
                  disabled={isBusy || !deleteWorktreeOnArchive}
                  description={t('worktree.deleteBranchHelp')}
                  onCheckedChange={checked => {
                    onDeleteBranchOnArchiveChange(checked)
                  }}
                >
                  {t('worktree.deleteBranch')}
                </Checkbox>
              ) : null}

              {archiveDescendantWorktrees.length > 0 ? (
                <div
                  className="workspace-space-worktree__descendant-cleanups"
                  data-testid="space-worktree-archive-descendant-cleanups"
                >
                  <p className="workspace-space-worktree__supporting-text">
                    {t('worktree.descendantCleanupIntro')}
                  </p>
                  {archiveDescendantWorktrees.map(cleanup => (
                    <div
                      key={cleanup.spaceId}
                      className="workspace-space-worktree__option-group"
                      data-testid={`space-worktree-archive-descendant-cleanup-${cleanup.spaceId}`}
                    >
                      <div className="workspace-space-worktree__option-heading">
                        <strong>{cleanup.spaceName}</strong>
                        <span>{cleanup.branchName ?? cleanup.worktreePath}</span>
                      </div>
                      <Checkbox
                        className="workspace-space-worktree__option-row"
                        data-testid={`space-worktree-archive-descendant-delete-worktree-${cleanup.spaceId}`}
                        checked={cleanup.deleteWorktree}
                        disabled={isBusy}
                        description={t('worktree.deleteContainedWorktreeHelp')}
                        onCheckedChange={checked => {
                          onDescendantDeleteWorktreeOnArchiveChange(cleanup.spaceId, checked)
                        }}
                      >
                        {t('worktree.deleteContainedWorktree')}
                      </Checkbox>
                      <Checkbox
                        className="workspace-space-worktree__option-row"
                        data-testid={`space-worktree-archive-descendant-delete-branch-${cleanup.spaceId}`}
                        checked={cleanup.deleteBranch}
                        disabled={isBusy || !cleanup.deleteWorktree}
                        description={t('worktree.deleteContainedBranchHelp')}
                        onCheckedChange={checked => {
                          onDescendantDeleteBranchOnArchiveChange(cleanup.spaceId, checked)
                        }}
                      >
                        {t('worktree.deleteContainedBranch')}
                      </Checkbox>
                    </div>
                  ))}
                </div>
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
