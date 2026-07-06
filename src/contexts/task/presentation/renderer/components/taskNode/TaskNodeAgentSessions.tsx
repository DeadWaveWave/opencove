import { useMemo, useState, type JSX } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { isResumeSessionBindingVerified } from '@contexts/agent/domain/agentResumeBinding'
import type {
  AgentRuntimeStatus,
  TaskAgentSessionRecord,
} from '@contexts/workspace/presentation/renderer/types'
import { providerLabel } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import { formatTaskTimestamp, resolveAgentSessionTone } from './helpers'

interface LinkedAgentSummary {
  nodeId: string
  title: string
  provider: AgentProvider
  status: AgentRuntimeStatus | null
  startedAt: string | null
}

export function TaskNodeAgentSessions({
  linkedAgentNode,
  agentSessions,
  currentDirectory,
  onResumeAgentSession,
  onRemoveAgentSessionRecord,
}: {
  linkedAgentNode: LinkedAgentSummary | null
  agentSessions: TaskAgentSessionRecord[]
  currentDirectory: string
  onResumeAgentSession: (recordId: string) => void
  onRemoveAgentSessionRecord: (recordId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [agentSessionMenu, setAgentSessionMenu] = useState<{
    recordId: string
    x: number
    y: number
  } | null>(null)
  const [resumeConfirmRecordId, setResumeConfirmRecordId] = useState<string | null>(null)

  const sortedAgentSessions = useMemo(() => {
    return [...agentSessions].sort((left, right) => {
      const leftTime = Date.parse(left.lastRunAt)
      const rightTime = Date.parse(right.lastRunAt)
      return (
        (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
      )
    })
  }, [agentSessions])

  const agentSessionMenuRecord = useMemo(() => {
    if (!agentSessionMenu) {
      return null
    }

    return sortedAgentSessions.find(record => record.id === agentSessionMenu.recordId) ?? null
  }, [agentSessionMenu, sortedAgentSessions])

  const resumeConfirmRecord = useMemo(() => {
    if (!resumeConfirmRecordId) {
      return null
    }

    return sortedAgentSessions.find(record => record.id === resumeConfirmRecordId) ?? null
  }, [resumeConfirmRecordId, sortedAgentSessions])

  const isResumeDirectoryMismatch = useMemo(() => {
    if (!resumeConfirmRecord) {
      return false
    }

    return resumeConfirmRecord.boundDirectory !== currentDirectory
  }, [currentDirectory, resumeConfirmRecord])

  const toRuntimeLabel = (status: AgentRuntimeStatus | null): string => {
    switch (status) {
      case 'running':
        return t('sidebar.status.working')
      case 'restoring':
        return t('common.loading')
      case 'failed':
        return t('agentRuntime.failed')
      case 'stopped':
        return t('agentRuntime.stopped')
      case 'exited':
        return t('agentRuntime.exited')
      default:
        return t('sidebar.status.standby')
    }
  }

  const renderAgentSessionSummary = ({
    provider,
    status,
    timestamp,
    description,
  }: {
    provider: AgentProvider
    status: AgentRuntimeStatus | null
    timestamp: string | null
    description: string
  }): JSX.Element => {
    const formattedTime = formatTaskTimestamp(timestamp)
    const runtimeLabel = toRuntimeLabel(status)
    const summaryLabel = `${description} · ${runtimeLabel} · ${formattedTime}`

    return (
      <div
        className="task-node__agent-session-summary"
        aria-label={summaryLabel}
        title={summaryLabel}
      >
        <span className="task-node__agent-session-identity" aria-hidden="true">
          <AgentProviderIcon provider={provider} className="task-node__agent-provider" />
          <span
            className={`task-node__agent-session-state task-node__agent-session-state--${resolveAgentSessionTone(status)}`}
          />
        </span>
        <time className="task-node__agent-session-time" dateTime={timestamp ?? undefined}>
          {formattedTime}
        </time>
      </div>
    )
  }

  return (
    <>
      <div className="task-node__agents nodrag" data-testid="task-node-agent-sessions">
        <div className="task-node__agents-header">
          <span>{t('taskNode.agents')}</span>
          <span className="task-node__agents-count">
            {(linkedAgentNode ? 1 : 0) + sortedAgentSessions.length}
          </span>
        </div>

        {linkedAgentNode || sortedAgentSessions.length > 0 ? (
          <div className="task-node__agents-list">
            {linkedAgentNode ? (
              <div
                className="workspace-agent-item workspace-agent-item--nested task-node__agent-session task-node__agent-session--linked"
                data-testid={`task-node-agent-session-linked-${linkedAgentNode.nodeId}`}
              >
                {renderAgentSessionSummary({
                  provider: linkedAgentNode.provider,
                  status: linkedAgentNode.status,
                  timestamp: linkedAgentNode.startedAt,
                  description:
                    linkedAgentNode.title.trim().length > 0
                      ? linkedAgentNode.title
                      : providerLabel(linkedAgentNode.provider),
                })}
              </div>
            ) : null}

            {sortedAgentSessions.map(record => (
              <div
                key={record.id}
                className="workspace-agent-item workspace-agent-item--nested task-node__agent-session"
                data-testid={`task-node-agent-session-record-${record.id}`}
                onContextMenu={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  setAgentSessionMenu({
                    recordId: record.id,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
              >
                {renderAgentSessionSummary({
                  provider: record.provider,
                  status: record.status,
                  timestamp: record.lastRunAt,
                  description: `${providerLabel(record.provider)} · ${record.effectiveModel ?? record.model ?? t('taskNode.defaultModel')}`,
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="task-node__agents-empty">{t('taskNode.noAgentSessionsYet')}</div>
        )}
      </div>

      {agentSessionMenu ? (
        <ViewportMenuSurface
          open={true}
          className="workspace-context-menu task-agent-session-menu"
          data-testid="task-node-agent-session-menu"
          placement={{
            type: 'point',
            point: {
              x: agentSessionMenu.x,
              y: agentSessionMenu.y,
            },
            estimatedSize: {
              width: 188,
              height: 96,
            },
          }}
          onDismiss={() => {
            setAgentSessionMenu(null)
          }}
          dismissOnPointerDownOutside={true}
          dismissOnEscape={true}
        >
          {agentSessionMenuRecord && isResumeSessionBindingVerified(agentSessionMenuRecord) ? (
            <button
              type="button"
              data-testid={`task-node-agent-session-menu-resume-${agentSessionMenu.recordId}`}
              onClick={() => {
                setResumeConfirmRecordId(agentSessionMenu.recordId)
                setAgentSessionMenu(null)
              }}
            >
              <RotateCcw className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">{t('taskNode.resume')}</span>
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`task-node-agent-session-menu-remove-${agentSessionMenu.recordId}`}
            onClick={() => {
              onRemoveAgentSessionRecord(agentSessionMenu.recordId)
              setAgentSessionMenu(null)
            }}
          >
            <Trash2 className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('taskNode.removeRecord')}</span>
          </button>
        </ViewportMenuSurface>
      ) : null}

      {resumeConfirmRecord ? (
        <div
          className="cove-window-backdrop task-agent-resume-backdrop"
          data-testid="task-node-agent-session-resume-confirm"
          onClick={() => {
            setResumeConfirmRecordId(null)
          }}
        >
          <section
            className="cove-window task-agent-resume"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>{t('taskNode.resumeDialog.title')}</h3>
            <p className="cove-window__meta">{t('taskNode.resumeDialog.description')}</p>

            <div className="cove-window__field-row">
              <label>{t('taskNode.resumeDialog.boundDirectory')}</label>
              <input value={resumeConfirmRecord.boundDirectory} disabled />
            </div>

            <div className="cove-window__field-row">
              <label>{t('taskNode.resumeDialog.currentDirectory')}</label>
              <input value={currentDirectory} disabled />
            </div>

            {isResumeDirectoryMismatch ? (
              <p className="cove-window__error">{t('taskNode.resumeDialog.mismatch')}</p>
            ) : (
              <p className="cove-window__meta">{t('taskNode.resumeDialog.aligned')}</p>
            )}

            <div className="cove-window__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                onClick={() => {
                  setResumeConfirmRecordId(null)
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`cove-window__action ${isResumeDirectoryMismatch ? 'cove-window__action--danger' : 'cove-window__action--primary'}`}
                data-testid={`task-node-agent-session-resume-confirm-resume-${resumeConfirmRecord.id}`}
                onClick={() => {
                  onResumeAgentSession(resumeConfirmRecord.id)
                  setResumeConfirmRecordId(null)
                }}
              >
                {t('taskNode.resume')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
