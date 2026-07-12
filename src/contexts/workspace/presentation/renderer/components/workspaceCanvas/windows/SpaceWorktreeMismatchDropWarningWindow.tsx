import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AnchoredOperationPopover } from '@app/renderer/components/AnchoredOperationPopover'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { SpaceWorktreeMismatchDropWarningState } from '../types'

export function SpaceWorktreeMismatchDropWarningWindow({
  warning,
  onCancel,
  onContinue,
}: {
  warning: SpaceWorktreeMismatchDropWarningState | null
  onCancel: () => void
  onContinue: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    setDontShowAgain(false)
  }, [warning?.spaceId])

  const windowSummary = useMemo(() => {
    if (!warning) {
      return ''
    }

    return [
      t('worktree.archiveAgents', { count: warning.agentCount }),
      t('worktree.archiveTerminals', { count: warning.terminalCount }),
    ].join(' · ')
  }, [t, warning])

  if (!warning) {
    return null
  }

  return (
    <AnchoredOperationPopover
      anchor={warning.anchor}
      ariaLabel={t('spaceDropGuard.title', { name: warning.spaceName })}
      className="workspace-space-drop-guard-popover"
      estimatedHeight={280}
      onDismiss={onCancel}
      testId="space-worktree-mismatch-drop-warning"
    >
      <section className="workspace-operation-guard">
        <header className="workspace-operation-guard__header">
          <span className="workspace-operation-guard__icon" aria-hidden="true">
            <AlertTriangle size={16} />
          </span>
          <div>
            <h3>{t('spaceDropGuard.title', { name: warning.spaceName })}</h3>
            <p>{windowSummary}</p>
          </div>
        </header>
        <p className="workspace-operation-guard__lead">
          {t('spaceDropGuard.description', {
            badge: t('terminalNodeHeader.directoryMismatch'),
          })}
        </p>

        <label className="cove-window__checkbox workspace-operation-guard__checkbox">
          <input
            type="checkbox"
            data-testid="space-worktree-mismatch-drop-warning-dont-show-again"
            checked={dontShowAgain}
            onChange={event => {
              setDontShowAgain(event.target.checked)
            }}
          />
          <span>
            <strong>{t('spaceDropGuard.dontShowAgain')}</strong>
          </span>
        </label>

        <div className="workspace-operation-guard__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            data-testid="space-worktree-mismatch-drop-warning-cancel"
            onClick={() => {
              onCancel()
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            autoFocus
            className="cove-window__action cove-window__action--primary"
            data-testid="space-worktree-mismatch-drop-warning-continue"
            onClick={() => {
              if (dontShowAgain) {
                useAppStore.getState().setAgentSettings(prev => ({
                  ...prev,
                  hideWorktreeMismatchDropWarning: true,
                }))
              }

              onContinue()
            }}
          >
            {t('spaceDropGuard.move')}
          </button>
        </div>
      </section>
    </AnchoredOperationPopover>
  )
}
