import type { Node } from '@xyflow/react'
import type { TaskAgentSessionRecord, TerminalNodeData } from '../types'
import { clearResumeSessionBinding, isResumeSessionBindingVerified } from './agentResumeBinding'

export function createTaskAgentSessionRecord(
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
  const resumeBinding = isResumeSessionBindingVerified(target.data.agent)
    ? {
        resumeSessionId: target.data.agent.resumeSessionId,
        resumeSessionIdVerified: true,
      }
    : clearResumeSessionBinding()

  return {
    id: crypto.randomUUID(),
    provider: target.data.agent.provider,
    ...resumeBinding,
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

export function appendAgentSessionRecordToTaskHistory({
  prevNodes,
  agentNodeId,
  now,
}: {
  prevNodes: Node<TerminalNodeData>[]
  agentNodeId: string
  now: string
}): Node<TerminalNodeData>[] {
  const target = prevNodes.find(node => node.id === agentNodeId)
  const agentSessionRecord = createTaskAgentSessionRecord(target, now)
  const taskNodeId = target?.data.kind === 'agent' ? (target.data.agent?.taskId ?? null) : null

  if (!agentSessionRecord || !taskNodeId) {
    return prevNodes
  }

  let didChange = false
  const nextNodes = prevNodes.map(node => {
    if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
      return node
    }

    const existingSessions = Array.isArray(node.data.task.agentSessions)
      ? node.data.task.agentSessions
      : []

    didChange = true
    return {
      ...node,
      data: {
        ...node.data,
        task: {
          ...node.data.task,
          agentSessions: [agentSessionRecord, ...existingSessions].slice(0, 50),
          updatedAt: now,
        },
      },
    }
  })

  return didChange ? nextNodes : prevNodes
}
