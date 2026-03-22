import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { AlertTriangle } from 'lucide-react'
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
    <div
      className="cove-window-backdrop workspace-space-drop-guard-backdrop"
      data-testid="space-worktree-mismatch-drop-warning"
      onClick={() => {
        onCancel()
      }}
    >
      <section
        className="cove-window workspace-space-drop-guard space-drop-guard-window"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <div className="space-drop-guard-window__header">
          <div className="space-drop-guard-window__topline">
            <div className="space-drop-guard-window__title-group">
              <h3>{t('spaceDropGuard.title', { name: warning.spaceName })}</h3>
              {windowSummary.length > 0 ? (
                <p className="workspace-space-worktree-guard__summary">{windowSummary}</p>
              ) : null}
            </div>
            <div
              className="space-drop-guard-window__status"
              aria-label="directory mismatch warning"
            >
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{t('terminalNodeHeader.directoryMismatch')}</span>
            </div>
          </div>
        </div>

        <p className="space-drop-guard-window__lead">
          {t('spaceDropGuard.description', {
            badge: t('terminalNodeHeader.directoryMismatch'),
          })}
        </p>

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

        <div className="cove-window__actions workspace-space-worktree-guard__actions">
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
    </div>
  )
}
