import React from 'react'
import { WarningDialog } from '@app/renderer/components/WarningDialog'
import { useTranslation } from '@app/renderer/i18n'

export interface SpaceWorktreeGuardState {
  spaceName: string
  agentCount: number
  terminalCount: number
  pendingLabel: string
  allowMarkMismatch: boolean
  isBusy: boolean
  error: string | null
}

export function SpaceWorktreeGuardWindow({
  guard,
  onCancel,
  onMarkMismatchAndContinue,
  onCloseAllAndContinue,
}: {
  guard: SpaceWorktreeGuardState | null
  onCancel: () => void
  onMarkMismatchAndContinue: () => void
  onCloseAllAndContinue: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!guard) {
    return null
  }

  const windowSummary = [
    t('worktree.archiveAgents', { count: guard.agentCount }),
    t('worktree.archiveTerminals', { count: guard.terminalCount }),
  ].join(' · ')

  return (
    <WarningDialog
      dataTestId="space-worktree-guard"
      title={guard.pendingLabel}
      summary={windowSummary}
      lead={t('worktreeGuard.activeWindowsBound', { name: guard.spaceName })}
      onBackdropClick={onCancel}
      disableBackdropDismiss={guard.isBusy}
      backdropClassName="workspace-space-worktree-guard-backdrop"
      actions={
        <>
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            data-testid="space-worktree-guard-cancel"
            disabled={guard.isBusy}
            onClick={() => {
              onCancel()
            }}
          >
            {t('common.cancel')}
          </button>

          {guard.allowMarkMismatch ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              data-testid="space-worktree-guard-mark-mismatch"
              disabled={guard.isBusy}
              onClick={() => {
                onMarkMismatchAndContinue()
              }}
            >
              {t('worktreeGuard.markMismatchAndContinue')}
            </button>
          ) : null}

          <button
            type="button"
            className="cove-window__action cove-window__action--danger"
            data-testid="space-worktree-guard-close-all"
            disabled={guard.isBusy}
            onClick={() => {
              onCloseAllAndContinue()
            }}
          >
            {t('worktreeGuard.closeAllAndContinue')}
          </button>
        </>
      }
    >
      <p className="workspace-warning-dialog__supporting-text">
        {guard.allowMarkMismatch
          ? t('worktreeGuard.closeFirstOrMark')
          : t('worktreeGuard.closeFirstOnly')}
      </p>

      {guard.error ? (
        <p className="cove-window__error workspace-warning-dialog__error">{guard.error}</p>
      ) : null}
    </WarningDialog>
  )
}
