import type { Node } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { CreateNodeInput } from '../types'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'

export interface TaskActionContext {
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  buildAgentNodeTitle: (
    provider: AgentSettings['defaultProvider'],
    effectiveModel: string | null,
  ) => string
  launchAgentInNode: (nodeId: string, mode: 'new' | 'resume') => Promise<void>
  agentSettings: AgentSettings
  workspacePath: string
  t: TranslateFn
  onRequestPersistFlush?: () => void
}

export type ResumeTaskAgentSessionContext = Omit<TaskActionContext, 'launchAgentInNode'>

export function findTaskNode(
  taskNodeId: string,
  nodesRef: TaskActionContext['nodesRef'] | ResumeTaskAgentSessionContext['nodesRef'],
): Node<TerminalNodeData> | null {
  const taskNode = nodesRef.current.find(node => node.id === taskNodeId)
  if (!taskNode || taskNode.data.kind !== 'task' || !taskNode.data.task) {
    return null
  }

  return taskNode
}

export function findTaskSpace(
  taskNodeId: string,
  spacesRef: TaskActionContext['spacesRef'] | ResumeTaskAgentSessionContext['spacesRef'],
): WorkspaceSpaceState | null {
  return spacesRef.current.find(space => space.nodeIds.includes(taskNodeId)) ?? null
}

export function resolveTaskDirectory(
  taskNodeId: string,
  spacesRef: TaskActionContext['spacesRef'] | ResumeTaskAgentSessionContext['spacesRef'],
  workspacePath: string,
): string {
  const taskSpace = findTaskSpace(taskNodeId, spacesRef)
  return taskSpace && taskSpace.directoryPath.trim().length > 0
    ? taskSpace.directoryPath
    : workspacePath
}

export function assignAgentNodeToTaskSpace({
  taskNodeId,
  assignedNodeId,
  context,
}: {
  taskNodeId: string
  assignedNodeId: string
  context: Pick<
    TaskActionContext | ResumeTaskAgentSessionContext,
    'spacesRef' | 'nodesRef' | 'setNodes' | 'onSpacesChange'
  >
}): void {
  const taskSpaceId = findTaskSpace(taskNodeId, context.spacesRef)?.id
  if (!taskSpaceId) {
    return
  }

  assignNodeToSpaceAndExpand({
    createdNodeId: assignedNodeId,
    targetSpaceId: taskSpaceId,
    spacesRef: context.spacesRef,
    nodesRef: context.nodesRef,
    setNodes: context.setNodes,
    onSpacesChange: context.onSpacesChange,
  })
}

export function setTaskLastError({
  taskNodeId,
  message,
  setNodes,
}: {
  taskNodeId: string
  message: string
  setNodes: TaskActionContext['setNodes'] | ResumeTaskAgentSessionContext['setNodes']
}): void {
  setNodes(prevNodes =>
    prevNodes.map(node => {
      if (node.id !== taskNodeId) {
        return node
      }

      return {
        ...node,
        data: {
          ...node.data,
          lastError: message,
        },
      }
    }),
  )
}

export function clearStaleTaskLinkedAgent({
  taskNodeId,
  setNodes,
}: {
  taskNodeId: string
  setNodes: TaskActionContext['setNodes']
}): void {
  setNodes(prevNodes =>
    prevNodes.map(node => {
      if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
        return node
      }

      return {
        ...node,
        data: {
          ...node.data,
          task: {
            ...node.data.task,
            linkedAgentNodeId: null,
            updatedAt: new Date().toISOString(),
          },
        },
      }
    }),
  )
}

export function createTaskAgentAnchor(taskNode: Node<TerminalNodeData>): { x: number; y: number } {
  return {
    x: taskNode.position.x + taskNode.data.width + 48,
    y: taskNode.position.y,
  }
}
