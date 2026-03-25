import React from 'react'
import type { NodeProps, Node as ReactFlowNode } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'
import type {
  AgentRuntimeStatus,
  TaskPriority,
  TaskRuntimeStatus,
} from '@contexts/workspace/presentation/renderer/types'
import { providerLabel } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

type AgentSessionTone = 'working' | 'standby' | 'failed'

function resolveAgentSessionTone(status: AgentRuntimeStatus | null): AgentSessionTone {
  if (status === 'running' || status === 'restoring') {
    return 'working'
  }

  if (status === 'failed') {
    return 'failed'
  }

  return 'standby'
}

function stopReactFlowInteraction(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

export type TaskNodeData = {
  kind: 'task'
  title: string
  requirement: string
  status: TaskRuntimeStatus
  priority: TaskPriority
  tags: string[]
  labelColor: LabelColor | null
  linkedAgent: {
    nodeId: string
    title: string
    status: AgentRuntimeStatus | null
    provider: AgentProvider | null
    model: string | null
    effectiveModel: string | null
    resumeSessionId: string | null
    resumeSessionIdVerified: boolean
    startedAt: string | null
  } | null
}

export type ArchivedTaskNodeType = ReactFlowNode<TaskNodeData, 'archivedTask'>

export function ArchivedTaskNode({ data }: NodeProps<ArchivedTaskNodeType>): React.JSX.Element {
  const { t } = useTranslation()

  const agentTone = data.linkedAgent ? resolveAgentSessionTone(data.linkedAgent.status) : 'standby'
  const agentStatusLabel = (() => {
    switch (data.linkedAgent?.status) {
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
      case 'standby':
      default:
        return t('sidebar.status.standby')
    }
  })()

  return (
    <div
      className="task-node nowheel space-archive-replay__task"
      style={{ width: '100%', height: '100%' }}
      data-testid="space-archives-window-replay-node"
      data-node-kind="task"
    >
      <div className="task-node__header" data-node-drag-handle="true">
        <div className="task-node__header-main">
          <div className="task-node__title-row">
            {data.labelColor ? (
              <span
                className="cove-label-dot cove-label-dot--solid"
                data-cove-label-color={data.labelColor}
                aria-hidden="true"
              />
            ) : null}
            <span className="task-node__title">{data.title}</span>
          </div>
        </div>
      </div>

      <div className="task-node__meta">
        <span className={`task-node__priority task-node__priority--${data.priority}`}>
          {getTaskPriorityLabel(t, data.priority).toUpperCase()}
        </span>

        <span className="task-node__tags">
          {data.tags.length > 0 ? (
            data.tags.map(tag => (
              <span key={tag} className="task-node__tag">
                #{tag}
              </span>
            ))
          ) : (
            <span className="task-node__tag task-node__tag--empty">{t('taskNode.noTags')}</span>
          )}
        </span>
      </div>

      <div className="task-node__content">
        <label>{t('taskNode.requirement')}</label>
        <div className="task-node__inline-editor">
          <textarea
            className="task-node__requirement-input nodrag nopan nowheel space-archive-replay__task-requirement space-archive-replay__selectable"
            value={data.requirement}
            readOnly
            spellCheck={false}
            onPointerDownCapture={stopReactFlowInteraction}
            onPointerDown={stopReactFlowInteraction}
            onClick={stopReactFlowInteraction}
            onWheel={stopReactFlowInteraction}
          />
        </div>
      </div>

      {data.linkedAgent ? (
        <div className="task-node__agents nodrag nopan nowheel space-archive-replay__task-sessions">
          <div className="task-node__agents-header">
            <span>{t('taskNode.agents')}</span>
            <span className="task-node__agents-count">1</span>
          </div>

          <div className="task-node__agents-list">
            <div
              className="workspace-agent-item workspace-agent-item--nested task-node__agent-session task-node__agent-session--linked"
              title={[
                data.linkedAgent.provider ? providerLabel(data.linkedAgent.provider) : null,
                data.linkedAgent.effectiveModel ?? data.linkedAgent.model,
                data.linkedAgent.resumeSessionId
                  ? `session: ${data.linkedAgent.resumeSessionId}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <div className="workspace-agent-item__headline">
                <span className="workspace-agent-item__title">{data.linkedAgent.title}</span>
                <span
                  className={`workspace-agent-item__status workspace-agent-item__status--agent workspace-agent-item__status--${agentTone}`}
                >
                  {agentStatusLabel}
                </span>
              </div>
              <div className="workspace-agent-item__meta">
                <span className="workspace-agent-item__meta-text">
                  {data.linkedAgent.provider ? providerLabel(data.linkedAgent.provider) : '—'} ·{' '}
                  {data.linkedAgent.effectiveModel ??
                    data.linkedAgent.model ??
                    t('taskNode.defaultModel')}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
