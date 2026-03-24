import React, { useEffect, useMemo, useState } from 'react'
import { WarningDialog } from '@app/renderer/components/WarningDialog'
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
    <WarningDialog
      dataTestId="space-worktree-mismatch-drop-warning"
      title={t('spaceDropGuard.title', { name: warning.spaceName })}
      summary={windowSummary}
      statusLabel={t('terminalNodeHeader.directoryMismatch')}
      statusAriaLabel="directory mismatch warning"
      lead={t('spaceDropGuard.description', {
        badge: t('terminalNodeHeader.directoryMismatch'),
      })}
      onBackdropClick={onCancel}
      backdropClassName="workspace-space-drop-guard-backdrop"
      actions={
        <>
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
        </>
      }
    >
      <label className="cove-window__checkbox">
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
    </WarningDialog>
  )
}
