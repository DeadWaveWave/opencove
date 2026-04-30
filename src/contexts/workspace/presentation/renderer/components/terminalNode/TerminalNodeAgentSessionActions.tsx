import { useMemo, useRef, useState, type JSX } from 'react'
import { Check, History, LoaderCircle, RotateCcw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import type { AgentRuntimeStatus } from '../../types'
import type { AgentSessionSummary } from '@shared/contracts/dto'

interface TerminalNodeAgentSessionActionsProps {
  status: AgentRuntimeStatus | null
  currentDirectory: string | null
  currentResumeSessionId: string | null
  currentResumeSessionIdVerified: boolean
  onReloadSession?: () => Promise<void>
  onListSessions?: (limit?: number) => Promise<AgentSessionSummary[]>
  onSwitchSession?: (summary: AgentSessionSummary) => Promise<void>
}

function formatSessionTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return '--'
  }

  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return timestamp
  }

  return parsed.toISOString().replace('T', ' ').slice(0, 16)
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallback
}

export function TerminalNodeAgentSessionActions({
  status,
  currentDirectory,
  currentResumeSessionId,
  currentResumeSessionIdVerified,
  onReloadSession,
  onListSessions,
  onSwitchSession,
}: TerminalNodeAgentSessionActionsProps): JSX.Element | null {
  const { t } = useTranslation()
  const listTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [isReloading, setIsReloading] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null)
  const [sessionMenuPoint, setSessionMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [switchTarget, setSwitchTarget] = useState<AgentSessionSummary | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)

  const canReload = typeof onReloadSession === 'function'
  const canListSessions =
    typeof onListSessions === 'function' && typeof onSwitchSession === 'function'
  const isBusy = status === 'restoring' || isReloading || isSwitching
  const normalizedCurrentDirectory =
    typeof currentDirectory === 'string' ? currentDirectory.trim() : ''

  const switchTargetDirectoryMismatch = useMemo(() => {
    if (!switchTarget) {
      return false
    }

    return normalizedCurrentDirectory.length > 0 && normalizedCurrentDirectory !== switchTarget.cwd
  }, [normalizedCurrentDirectory, switchTarget])

  if (!canReload && !canListSessions) {
    return null
  }

  return (
    <>
      {canReload ? (
        <button
          type="button"
          className="terminal-node__action terminal-node__action--icon nodrag"
          data-testid="terminal-node-reload-session"
          aria-label={t('terminalNodeHeader.reloadSession')}
          title={
            isReloading
              ? t('terminalNodeHeader.reloadingSession')
              : t('terminalNodeHeader.reloadSession')
          }
          disabled={isBusy}
          onClick={async event => {
            event.stopPropagation()
            if (isBusy || !onReloadSession) {
              return
            }

            setIsReloading(true)

            try {
              await onReloadSession()
            } finally {
              setIsReloading(false)
            }
          }}
        >
          {isReloading ? (
            <LoaderCircle className="terminal-node__action-icon terminal-node__action-icon--spinning" />
          ) : (
            <RotateCcw className="terminal-node__action-icon" />
          )}
        </button>
      ) : null}

      {canListSessions ? (
        <button
          ref={listTriggerRef}
          type="button"
          className="terminal-node__action terminal-node__action--icon nodrag"
          data-testid="terminal-node-session-list"
          aria-label={t('terminalNodeHeader.sessionList')}
          title={
            isLoadingSessions
              ? t('terminalNodeHeader.loadingSessions')
              : t('terminalNodeHeader.sessionList')
          }
          disabled={isBusy}
          onClick={async event => {
            event.stopPropagation()
            if (isBusy || !onListSessions) {
              return
            }

            if (sessionMenuPoint) {
              setSessionMenuPoint(null)
              return
            }

            const rect = event.currentTarget.getBoundingClientRect()
            setSessionMenuPoint({
              x: rect.right,
              y: rect.bottom + 6,
            })
            setSessionLoadError(null)
            setIsLoadingSessions(true)

            try {
              const nextSessions = await onListSessions(20)
              setSessions(nextSessions)
            } catch (error) {
              setSessions([])
              setSessionLoadError(toErrorMessage(error, t('common.unknownError')))
            } finally {
              setIsLoadingSessions(false)
            }
          }}
        >
          {isLoadingSessions ? (
            <LoaderCircle className="terminal-node__action-icon terminal-node__action-icon--spinning" />
          ) : (
            <History className="terminal-node__action-icon" />
          )}
        </button>
      ) : null}

      {sessionMenuPoint ? (
        <ViewportMenuSurface
          open={true}
          className="workspace-context-menu terminal-node__session-menu"
          data-testid="terminal-node-session-menu"
          placement={{
            type: 'point',
            point: sessionMenuPoint,
            alignX: 'end',
            estimatedSize: {
              width: 320,
              height: 280,
            },
          }}
          onDismiss={() => {
            setSessionMenuPoint(null)
          }}
          dismissOnPointerDownOutside={true}
          dismissOnEscape={true}
          dismissIgnoreRefs={[listTriggerRef]}
        >
          <div className="workspace-context-menu__section-title">
            {t('terminalNodeHeader.sessionList')}
          </div>

          {isLoadingSessions ? (
            <div
              className="terminal-node__session-menu-state"
              data-testid="terminal-node-session-menu-loading"
            >
              <LoaderCircle className="workspace-context-menu__icon workspace-context-menu__spinner" />
              <span className="workspace-context-menu__label">
                {t('terminalNodeHeader.loadingSessions')}
              </span>
            </div>
          ) : null}

          {!isLoadingSessions && sessionLoadError ? (
            <div className="terminal-node__session-menu-state terminal-node__session-menu-state--error">
              <span className="terminal-node__session-menu-state-title">
                {t('terminalNodeHeader.sessionLoadFailed')}
              </span>
              <span className="terminal-node__session-menu-state-detail">{sessionLoadError}</span>
            </div>
          ) : null}

          {!isLoadingSessions && !sessionLoadError && sessions.length === 0 ? (
            <div
              className="terminal-node__session-menu-state"
              data-testid="terminal-node-session-menu-empty"
            >
              <span className="workspace-context-menu__label">
                {t('terminalNodeHeader.noSessions')}
              </span>
            </div>
          ) : null}

          {!isLoadingSessions && !sessionLoadError
            ? sessions.map(summary => {
                const isCurrentSession =
                  currentResumeSessionIdVerified &&
                  currentResumeSessionId === summary.sessionId &&
                  normalizedCurrentDirectory === summary.cwd

                return (
                  <button
                    key={`${summary.sessionId}:${summary.cwd}`}
                    type="button"
                    className="terminal-node__session-menu-item"
                    data-testid={`terminal-node-session-menu-item-${summary.sessionId}`}
                    disabled={isCurrentSession || isBusy}
                    onClick={() => {
                      if (isCurrentSession) {
                        return
                      }

                      setSessionMenuPoint(null)
                      setSwitchTarget(summary)
                    }}
                  >
                    <span className="workspace-context-menu__mark" aria-hidden="true">
                      {isCurrentSession ? <Check className="workspace-context-menu__icon" /> : null}
                    </span>
                    <span className="terminal-node__session-menu-item-content">
                      <span className="terminal-node__session-menu-item-title">
                        {summary.title ?? summary.sessionId}
                      </span>
                      {summary.title ? (
                        <span className="terminal-node__session-menu-item-subtitle">
                          {summary.sessionId}
                        </span>
                      ) : null}
                      <span className="terminal-node__session-menu-item-meta">
                        {t('terminalNodeHeader.sessionUpdatedAt', {
                          timestamp: formatSessionTimestamp(summary.updatedAt ?? summary.startedAt),
                        })}
                      </span>
                      <span className="terminal-node__session-menu-item-meta">{summary.cwd}</span>
                    </span>
                  </button>
                )
              })
            : null}
        </ViewportMenuSurface>
      ) : null}

      {switchTarget ? (
        <div
          className="cove-window-backdrop terminal-node__session-switch-backdrop"
          data-testid="terminal-node-session-switch-confirm"
          onClick={() => {
            if (isSwitching) {
              return
            }

            setSwitchTarget(null)
          }}
        >
          <section
            className="cove-window terminal-node__session-switch-window"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>{t('terminalNodeHeader.sessionSwitchDialog.title')}</h3>
            <p className="cove-window__meta">
              {t('terminalNodeHeader.sessionSwitchDialog.description')}
            </p>

            <div className="cove-window__field-row">
              <label>{t('terminalNodeHeader.sessionSwitchDialog.targetSession')}</label>
              <input value={switchTarget.sessionId} disabled />
            </div>

            <div className="cove-window__field-row">
              <label>{t('terminalNodeHeader.sessionSwitchDialog.targetDirectory')}</label>
              <input value={switchTarget.cwd} disabled />
            </div>

            <div className="cove-window__field-row">
              <label>{t('terminalNodeHeader.sessionSwitchDialog.currentDirectory')}</label>
              <input value={currentDirectory ?? ''} disabled />
            </div>

            {switchTargetDirectoryMismatch ? (
              <p className="cove-window__error">
                {t('terminalNodeHeader.sessionSwitchDialog.mismatch')}
              </p>
            ) : (
              <p className="cove-window__meta">
                {t('terminalNodeHeader.sessionSwitchDialog.aligned')}
              </p>
            )}

            <div className="cove-window__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                disabled={isSwitching}
                onClick={() => {
                  setSwitchTarget(null)
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="cove-window__action"
                data-testid={`terminal-node-session-switch-confirm-submit-${switchTarget.sessionId}`}
                disabled={isSwitching || !onSwitchSession}
                onClick={async () => {
                  if (!onSwitchSession) {
                    return
                  }

                  setIsSwitching(true)

                  try {
                    await onSwitchSession(switchTarget)
                    setSwitchTarget(null)
                  } finally {
                    setIsSwitching(false)
                  }
                }}
              >
                {isSwitching
                  ? t('terminalNodeHeader.sessionSwitchDialog.switching')
                  : t('terminalNodeHeader.sessionSwitchDialog.switch')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
