import type { MutableRefObject, ReactElement } from 'react'
import { useStore, type Node } from '@xyflow/react'
import { TaskNode } from '../TaskNode'
import { resolveTaskExecutionContext } from '@contexts/session/application/resolveTaskExecutionContext'
import type { TerminalNodeData } from '../../types'
import { useReadCanvasDocument } from '../../store/canvasStoreContext'
import type { LabelColor } from '@shared/types/labelColor'
import type { QuickUpdateTaskRequirement, QuickUpdateTaskTitle, UpdateTaskStatus } from './types'
import { resolveAgentDisplayTitle } from '../../utils/agentTitle'
import { useCanvasNodeCommands } from './nodeTypes.context'

export function WorkspaceCanvasTaskNodeType({
  data,
  id,
  nodePosition,
  workspacePath,
  openTaskEditorRef,
  quickUpdateTaskTitleRef,
  quickUpdateTaskRequirementRef,
  runTaskAgentRef,
  resumeTaskAgentSessionRef,
  removeTaskAgentSessionRecordRef,
  updateTaskStatusRef,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: { x: number; y: number }
  workspacePath: string
  openTaskEditorRef: MutableRefObject<(nodeId: string) => void>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: MutableRefObject<(taskNodeId: string, recordId: string) => void>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
}): ReactElement | null {
  const readDocument = useReadCanvasDocument()
  const windowCommands = useCanvasNodeCommands().window
  const linkedAgentNodeId = data.task?.linkedAgentNodeId ?? null
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null

  const linkedAgentNode = useStore(storeState => {
    if (!linkedAgentNodeId) {
      return null
    }

    const state = storeState as unknown as {
      nodeLookup?: { get?: unknown }
      nodeInternals?: { get?: unknown }
      nodes?: Array<Node<TerminalNodeData>>
    }

    const lookup = state.nodeLookup ?? state.nodeInternals
    if (lookup && typeof lookup.get === 'function') {
      return (lookup as Map<string, Node<TerminalNodeData>>).get(linkedAgentNodeId) ?? null
    }

    return state.nodes?.find(node => node.id === linkedAgentNodeId) ?? null
  })

  if (!data.task) {
    return null
  }

  const taskExecutionContext = resolveTaskExecutionContext({
    // Read when this renders, not subscribed: the Spaces of the store as they are now.
    spaces: readDocument().spaces,
    taskNodeId: id,
    workspacePath,
  })
  const currentDirectory = taskExecutionContext.workingDirectory

  const linkedAgentSummary =
    linkedAgentNode && linkedAgentNode.data.kind === 'agent' && linkedAgentNode.data.agent
      ? {
          nodeId: linkedAgentNode.id,
          title: resolveAgentDisplayTitle({
            provider: linkedAgentNode.data.agent.provider,
            linkedTaskTitle: data.title,
            fallbackTitle: linkedAgentNode.data.title,
            preferFallbackTitle: linkedAgentNode.data.titlePinnedByUser === true,
          }),
          provider: linkedAgentNode.data.agent.provider,
          status: linkedAgentNode.data.status,
          startedAt: linkedAgentNode.data.startedAt,
        }
      : null

  return (
    <TaskNode
      title={data.title}
      requirement={data.task.requirement}
      status={data.task.status}
      priority={data.task.priority}
      tags={data.task.tags}
      isEnriching={data.task.isEnriching === true}
      lastError={data.lastError}
      linkedAgentNode={linkedAgentSummary}
      agentSessions={data.task.agentSessions ?? []}
      currentDirectory={currentDirectory}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        windowCommands.requestDelete([id])
      }}
      onOpenEditor={() => {
        openTaskEditorRef.current(id)
      }}
      onQuickTitleSave={title => {
        quickUpdateTaskTitleRef.current(id, title)
      }}
      onQuickRequirementSave={requirement => {
        quickUpdateTaskRequirementRef.current(id, requirement)
      }}
      onRunAgent={() => {
        void runTaskAgentRef.current(id)
      }}
      onResize={frame => windowCommands.resize(id, frame)}
      onStatusChange={status => {
        updateTaskStatusRef.current(id, status)
      }}
      onResumeAgentSession={recordId => {
        void resumeTaskAgentSessionRef.current(id, recordId)
      }}
      onRemoveAgentSessionRecord={recordId => {
        removeTaskAgentSessionRecordRef.current(id, recordId)
      }}
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            windowCommands.select(id, { toggle: true })
            return
          }

          windowCommands.select(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        windowCommands.focusForInteraction(id)
      }}
    />
  )
}
