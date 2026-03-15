import React from 'react'
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
    <div
      className="cove-window-backdrop workspace-space-worktree-guard-backdrop"
      data-testid="space-worktree-guard"
      onClick={() => {
        if (guard.isBusy) {
          return
        }

        onCancel()
      }}
    >
      <section
        className="cove-window workspace-space-worktree-guard"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <div className="workspace-space-worktree__message-block">
          <h3>{guard.pendingLabel}</h3>
          <p className="workspace-space-worktree__lead">
            {t('worktreeGuard.activeWindowsBound', { name: guard.spaceName })}
          </p>
          <p className="workspace-space-worktree__supporting-text">
            {guard.allowMarkMismatch
              ? t('worktreeGuard.closeFirstOrMark')
              : t('worktreeGuard.closeFirstOnly')}
          </p>
          <p className="workspace-space-worktree-guard__summary">{windowSummary}</p>
        </div>

        {guard.error ? (
          <p className="cove-window__error workspace-space-worktree-guard__error">{guard.error}</p>
        ) : null}

        <div className="cove-window__actions workspace-space-worktree-guard__actions">
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
        </div>
      </section>
    </div>
  )
}
