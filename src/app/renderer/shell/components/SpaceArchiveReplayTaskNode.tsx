import React from 'react'
import type { NodeProps, Node as ReactFlowNode } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'
import type {
  AgentRuntimeStatus,
  TaskPriority,
  TaskRuntimeStatus,
} from '@contexts/workspace/presentation/renderer/types'
import { providerLabel } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { WindowPlate } from '@contexts/workspace/presentation/renderer/components/shared/WindowPlate'
import { TaskNodeLabels } from '@contexts/task/presentation/renderer/components/taskNode/TaskNodeLabels'
import { TaskNodeSessionsReadout } from '@contexts/task/presentation/renderer/components/taskNode/TaskNodeSessionsReadout'
import { TaskNodeStatusReadout } from '@contexts/task/presentation/renderer/components/taskNode/TaskNodeStatusSteps'

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

/**
 * An archived task, replayed as the task card it was (TASK_UI_STANDARD 2.2) to read only: its
 * progress, labels, requirement and session, with nothing to run, edit or resume.
 */
export function ArchivedTaskNode({ data }: NodeProps<ArchivedTaskNodeType>): React.JSX.Element {
  const { t } = useTranslation()
  const linkedAgent = data.linkedAgent

  return (
    <div
      data-cove-part="window"
      data-cove-kind="task"
      data-task-status={data.status}
      className="task-node nowheel space-archive-replay__task"
      style={{ width: '100%', height: '100%' }}
      data-testid="space-archives-window-replay-node"
      data-node-kind="task"
    >
      <div
        className="cove-window-header task-node__header"
        data-cove-part="window-header"
        data-cove-kind="plan"
        data-node-drag-handle="true"
      >
        {data.labelColor ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={data.labelColor}
            aria-hidden="true"
          />
        ) : null}
        <KindTile kind="plan" className="cove-window-header__tile">
          <NodeKindIcon kind="task" />
        </KindTile>
        <span className="task-node__title" data-cove-part="window-title">
          {data.title}
        </span>
      </div>

      <WindowPlate kind="plan" />
      <div className="task-node__plate" data-cove-part="window-body">
        <div className="task-node__meta">
          <TaskNodeStatusReadout status={data.status} />
          <TaskNodeLabels priority={data.priority} tags={data.tags} />
        </div>

        <div className="task-node__content">
          <div className="task-node__inline-editor">
            <textarea
              className="task-node__requirement-input nodrag nopan nowheel space-archive-replay__task-requirement space-archive-replay__selectable"
              aria-label={t('taskNode.requirement')}
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

        <div className="task-node__footer">
          <TaskNodeSessionsReadout
            sessions={
              linkedAgent
                ? [
                    {
                      key: linkedAgent.nodeId,
                      provider: linkedAgent.provider,
                      status: linkedAgent.status,
                      description:
                        linkedAgent.title.trim().length > 0
                          ? linkedAgent.title
                          : linkedAgent.provider
                            ? providerLabel(linkedAgent.provider)
                            : t('taskNode.agents'),
                    },
                  ]
                : []
            }
          />
        </div>
      </div>
    </div>
  )
}
