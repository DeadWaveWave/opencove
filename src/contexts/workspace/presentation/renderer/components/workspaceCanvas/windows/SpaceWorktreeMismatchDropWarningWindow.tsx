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
      className="cove-window-backdrop workspace-space-worktree-backdrop workspace-space-worktree-backdrop--archive"
      data-testid="space-worktree-mismatch-drop-warning"
      onClick={() => {
        onCancel()
      }}
    >
      <section
        className="cove-window workspace-space-worktree workspace-space-worktree--archive"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <header className="workspace-space-worktree__header">
          <div className="workspace-space-worktree__header-main">
            <div className="workspace-space-worktree__title-group">
              <div className="workspace-space-worktree__title-line">
                <h3>{t('spaceDropGuard.title', { name: warning.spaceName })}</h3>
                {windowSummary.length > 0 ? (
                  <p className="workspace-space-worktree__header-summary">{windowSummary}</p>
                ) : null}
              </div>
            </div>
            <div className="workspace-space-worktree__status-line">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{t('terminalNodeHeader.directoryMismatch')}</span>
            </div>
          </div>
        </header>

        <div className="workspace-space-worktree__view">
          <section className="workspace-space-worktree__surface workspace-space-worktree__surface--minimal">
            <div className="workspace-space-worktree__message-block">
              <p className="workspace-space-worktree__lead">
                {t('spaceDropGuard.description', {
                  badge: t('terminalNodeHeader.directoryMismatch'),
                })}
              </p>

              <div className="workspace-space-worktree__option-list">
                <label className="cove-window__checkbox workspace-space-worktree__option-row">
                  <input
                    type="checkbox"
                    data-testid="space-worktree-mismatch-drop-warning-dont-show-again"
                    checked={dontShowAgain}
                    onChange={event => {
                      setDontShowAgain(event.target.checked)
                    }}
                  />
                  <span className="workspace-space-worktree__option-copy workspace-space-worktree__option-copy--inline">
                    <strong>{t('spaceDropGuard.dontShowAgain')}</strong>
                  </span>
                </label>
              </div>
            </div>

            <div className="workspace-space-worktree__inline-actions workspace-space-worktree__inline-actions--footer">
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
      </section>
    </div>
  )
}
