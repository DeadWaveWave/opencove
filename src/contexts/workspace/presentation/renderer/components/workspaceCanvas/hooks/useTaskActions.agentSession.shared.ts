import type { Node } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalPtyGeometryDisplayMetrics } from '@contexts/workspace/domain/terminalPtyGeometry'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { CreateNodeInput } from '../types'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import type { AgentNodeLaunchOverrides } from './useAgentNodeLifecycle.support'
import type { CanvasDocumentCommands } from '../../../store/canvasStoreContext'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

type TaskRuntimeNode = Node<TerminalNodeData> & {
  data: TerminalNodeData & {
    kind: 'task'
    task: NonNullable<TerminalNodeData['task']>
  }
}

export interface TaskActionContext {
  /**
   * The document reader of the render that started the action: it keeps reading the workspace
   * that started it, however long the action awaits and whichever workspace is shown by then.
   */
  readDocument: () => WorkspaceDocument
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  updateSpaces: CanvasDocumentCommands['updateSpaces']
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  buildAgentNodeTitle: (provider: AgentSettings['defaultProvider'], label: string | null) => string
  launchAgentInNode: (
    nodeId: string,
    mode: 'new' | 'resume',
    overrides?: AgentNodeLaunchOverrides,
  ) => Promise<void>
  agentSettings: AgentSettings
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  terminalDisplayMetrics: TerminalPtyGeometryDisplayMetrics
  t: TranslateFn
}

export type ResumeTaskAgentSessionContext = Omit<TaskActionContext, 'launchAgentInNode'>

export function findTaskNode(
  taskNodeId: string,
  readDocument: TaskActionContext['readDocument'],
): TaskRuntimeNode | null {
  const taskNode = readDocument().nodes.find(node => node.id === taskNodeId)
  if (!taskNode || taskNode.data.kind !== 'task' || !taskNode.data.task) {
    return null
  }

  return taskNode as TaskRuntimeNode
}

export function findTaskSpace(
  taskNodeId: string,
  readDocument: TaskActionContext['readDocument'],
): WorkspaceSpaceState | null {
  return readDocument().spaces.find(space => space.nodeIds.includes(taskNodeId)) ?? null
}

export function assignAgentNodeToTaskSpace({
  taskNodeId,
  assignedNodeId,
  assignedNode,
  context,
}: {
  taskNodeId: string
  assignedNodeId: string
  assignedNode: Node<TerminalNodeData>
  context: Pick<
    TaskActionContext | ResumeTaskAgentSessionContext,
    'workspaceId' | 'readDocument' | 'updateCanvasDocument'
  >
}): void {
  const taskSpaceId = findTaskSpace(taskNodeId, context.readDocument)?.id
  if (!taskSpaceId) {
    return
  }

  assignNodeToSpaceAndExpand({
    workspaceId: context.workspaceId,
    createdNodeId: assignedNodeId,
    createdNode: assignedNode,
    targetSpaceId: taskSpaceId,
    updateCanvasDocument: context.updateCanvasDocument,
  })
}

/** `flush` requests the persistence flush on the write itself, for a caller that persists it. */
export function setTaskLastError({
  taskNodeId,
  message,
  setNodes,
  flush,
}: {
  taskNodeId: string
  message: string
  setNodes: TaskActionContext['setNodes']
  flush?: boolean
}): void {
  setNodes(
    prevNodes =>
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
    flush ? { flush: true } : undefined,
  )
}

/** `flush` requests the persistence flush on the write itself, for a caller that persists it. */
export function clearStaleTaskLinkedAgent({
  taskNodeId,
  setNodes,
  flush,
}: {
  taskNodeId: string
  setNodes: TaskActionContext['setNodes']
  flush?: boolean
}): void {
  setNodes(
    prevNodes =>
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
    flush ? { flush: true } : undefined,
  )
}

export function createTaskAgentAnchor(taskNode: Node<TerminalNodeData>): { x: number; y: number } {
  return {
    x: taskNode.position.x + taskNode.data.width + 48,
    y: taskNode.position.y,
  }
}
