import type { Node } from '@xyflow/react'
import type { TaskAgentSessionRecord, TerminalNodeData } from '../../../types'

function createAgentSessionRecord(
  target: Node<TerminalNodeData> | undefined,
  now: string,
): TaskAgentSessionRecord | null {
  if (target?.data.kind !== 'agent' || !target.data.agent?.taskId) {
    return null
  }

  const boundDirectory = target.data.agent.executionDirectory
  const startedAt = target.data.startedAt ?? now
  const shouldMarkStopped =
    target.data.status === 'running' ||
    target.data.status === 'standby' ||
    target.data.status === 'restoring'

  return {
    id: crypto.randomUUID(),
    provider: target.data.agent.provider,
    resumeSessionId: target.data.agent.resumeSessionId,
    prompt: target.data.agent.prompt,
    model: target.data.agent.model,
    effectiveModel: target.data.agent.effectiveModel,
    boundDirectory,
    lastDirectory: boundDirectory,
    createdAt: startedAt,
    lastRunAt: startedAt,
    endedAt: target.data.endedAt ?? now,
    exitCode: shouldMarkStopped ? null : target.data.exitCode,
    status: shouldMarkStopped ? 'stopped' : (target.data.status ?? 'exited'),
  }
}

export function removeNodeWithRelations({
  prevNodes,
  nodeId,
  target,
  now,
}: {
  prevNodes: Node<TerminalNodeData>[]
  nodeId: string
  target: Node<TerminalNodeData> | undefined
  now: string
}): Node<TerminalNodeData>[] {
  const agentSessionRecord = createAgentSessionRecord(target, now)

  return prevNodes
    .filter(node => node.id !== nodeId)
    .map(node => {
      if (
        target?.data.kind === 'task' &&
        target.data.task?.linkedAgentNodeId &&
        node.id === target.data.task.linkedAgentNodeId &&
        node.data.kind === 'agent' &&
        node.data.agent
      ) {
        return {
          ...node,
          data: {
            ...node.data,
            agent: {
              ...node.data.agent,
              taskId: null,
            },
          },
        }
      }

      if (
        target?.data.kind === 'agent' &&
        target.data.agent?.taskId &&
        node.id === target.data.agent.taskId &&
        node.data.kind === 'task' &&
        node.data.task
      ) {
        const existingSessions = Array.isArray(node.data.task.agentSessions)
          ? node.data.task.agentSessions
          : []
        const nextSessions = agentSessionRecord
          ? [agentSessionRecord, ...existingSessions].slice(0, 50)
          : existingSessions

        return {
          ...node,
          data: {
            ...node.data,
            task: {
              ...node.data.task,
              linkedAgentNodeId: null,
              agentSessions: nextSessions,
              status: node.data.task.status === 'doing' ? 'todo' : node.data.task.status,
              updatedAt: now,
            },
          },
        }
      }

      return node
    })
}
