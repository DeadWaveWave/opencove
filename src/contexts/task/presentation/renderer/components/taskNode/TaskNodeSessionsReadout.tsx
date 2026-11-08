import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { AgentRuntimeStatus } from '@contexts/workspace/presentation/renderer/types'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { getAgentRuntimeLabel, resolveAgentSessionTone } from './helpers'

export interface TaskNodeSessionSnapshot {
  key: string
  provider: AgentProvider | null
  status: AgentRuntimeStatus | null
  description: string
}

/**
 * The sessions row to read only (the space archive's replay): an avatar per session, its light
 * still, and how many there were. Nothing opens or resumes from here.
 */
export function TaskNodeSessionsReadout({
  sessions,
}: {
  sessions: TaskNodeSessionSnapshot[]
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="task-node__sessions task-node__sessions--readout">
      {sessions.map(session => (
        <span
          key={session.key}
          role="img"
          aria-label={`${session.description} · ${getAgentRuntimeLabel(t, session.status)}`}
          className="task-node__session task-node__session--linked task-node__session--readout"
        >
          {session.provider ? (
            <AgentProviderIcon provider={session.provider} />
          ) : (
            <NodeKindIcon kind="agent" />
          )}
          <span
            className={`task-node__session-light task-node__session-light--${resolveAgentSessionTone(session.status)}`}
            aria-hidden="true"
          />
        </span>
      ))}
      <span className="task-node__sessions-hint">
        {sessions.length === 0
          ? t('taskNode.noSessions')
          : t('taskNode.sessionCount', { count: sessions.length })}
      </span>
    </div>
  )
}
