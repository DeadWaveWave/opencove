import React from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  AnchoredOperationPopover,
  type AnchoredOperationPopoverAnchor,
} from '@app/renderer/components/AnchoredOperationPopover'
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
  anchor = { x: 24, y: 24 },
  guard,
  onCancel,
  onMarkMismatchAndContinue,
  onCloseAllAndContinue,
}: {
  anchor?: AnchoredOperationPopoverAnchor
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
    <AnchoredOperationPopover
      anchor={anchor}
      ariaLabel={guard.pendingLabel}
      className="workspace-space-worktree-guard-popover"
      dismissDisabled={guard.isBusy}
      estimatedHeight={300}
      onDismiss={onCancel}
      testId="space-worktree-guard"
    >
      <section className="workspace-operation-guard">
        <header className="workspace-operation-guard__header">
          <span className="workspace-operation-guard__icon" aria-hidden="true">
            <AlertTriangle size={16} />
          </span>
          <div>
            <h3>{guard.pendingLabel}</h3>
            <p>{windowSummary}</p>
          </div>
        </header>

        <p className="workspace-operation-guard__lead">
          {t('worktreeGuard.activeWindowsBound', { name: guard.spaceName })}
        </p>
        <p className="workspace-operation-guard__supporting">
          {guard.allowMarkMismatch
            ? t('worktreeGuard.closeFirstOrMark')
            : t('worktreeGuard.closeFirstOnly')}
        </p>

        {guard.error ? (
          <p className="cove-window__error workspace-operation-guard__error">{guard.error}</p>
        ) : null}

        <div className="workspace-operation-guard__actions">
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
    </AnchoredOperationPopover>
  )
}
