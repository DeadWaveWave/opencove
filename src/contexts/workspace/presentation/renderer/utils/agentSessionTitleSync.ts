import type { Node } from '@xyflow/react'
import { isResumeSessionBindingVerified } from '@contexts/agent/domain/agentResumeBinding'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { AgentSessionSummary, TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../types'
import { buildAgentNodeTitle } from './agentTitle'

export const AGENT_SESSION_TITLE_RETRY_DELAYS_MS = [0, 200, 600, 1_200, 2_500] as const

export interface AgentSessionTitleSyncTarget {
  nodeId: string
  runtimeSessionId: string
  resumeSessionId: string
  provider: AgentProvider
}

interface LoadAgentSessionTitleInput {
  resumeSessionId: string
  listSessions: () => Promise<AgentSessionSummary[]>
  isCurrent: () => boolean
  retryDelaysMs?: readonly number[]
  signal?: AbortSignal
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)
    const handleAbort = (): void => {
      window.clearTimeout(timeout)
      resolve()
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function isDirectAgentTitleTarget(node: Node<TerminalNodeData>, runtimeSessionId: string): boolean {
  return (
    node.data.kind === 'agent' &&
    node.data.agent !== null &&
    node.data.sessionId === runtimeSessionId &&
    node.data.agent.launchMode === 'new' &&
    node.data.agent.taskId === null &&
    node.data.titlePinnedByUser !== true
  )
}

export function isAgentNodeAwaitingSessionTitle(node: Node<TerminalNodeData>): boolean {
  if (
    node.data.kind !== 'agent' ||
    !node.data.agent ||
    node.data.agent.launchMode !== 'new' ||
    node.data.agent.taskId !== null ||
    node.data.titlePinnedByUser === true
  ) {
    return false
  }

  return (
    node.data.title ===
    buildAgentNodeTitle(
      node.data.agent.provider,
      node.data.agent.effectiveModel ?? node.data.agent.model,
    )
  )
}

export function resolveAgentSessionTitleSyncTarget(
  nodes: readonly Node<TerminalNodeData>[],
  event: TerminalSessionMetadataEvent,
): AgentSessionTitleSyncTarget | null {
  const runtimeSessionId = normalizeOptionalString(event.sessionId)
  const resumeSessionId = normalizeOptionalString(event.resumeSessionId)
  if (!runtimeSessionId || !resumeSessionId) {
    return null
  }

  const node = nodes.find(candidate => candidate.data.sessionId === runtimeSessionId)
  if (!node || !isDirectAgentTitleTarget(node, runtimeSessionId) || !node.data.agent) {
    return null
  }

  if (
    isResumeSessionBindingVerified(node.data.agent) &&
    node.data.agent.resumeSessionId !== resumeSessionId
  ) {
    return null
  }

  return {
    nodeId: node.id,
    runtimeSessionId,
    resumeSessionId,
    provider: node.data.agent.provider,
  }
}

export function isAgentSessionTitleSyncTargetCurrent(
  nodes: readonly Node<TerminalNodeData>[],
  target: AgentSessionTitleSyncTarget,
): boolean {
  const node = nodes.find(candidate => candidate.id === target.nodeId)
  if (!node || !isDirectAgentTitleTarget(node, target.runtimeSessionId) || !node.data.agent) {
    return false
  }

  return (
    node.data.agent.provider === target.provider &&
    (!isResumeSessionBindingVerified(node.data.agent) ||
      node.data.agent.resumeSessionId === target.resumeSessionId)
  )
}

export function applyAgentSessionTitleToNodes(
  prevNodes: Node<TerminalNodeData>[],
  target: AgentSessionTitleSyncTarget,
  sessionTitle: string,
): { nextNodes: Node<TerminalNodeData>[]; didChange: boolean } {
  const normalizedTitle = normalizeOptionalString(sessionTitle)
  if (!normalizedTitle) {
    return { nextNodes: prevNodes, didChange: false }
  }

  let didChange = false
  const nextNodes = prevNodes.map(node => {
    if (
      node.id !== target.nodeId ||
      !isDirectAgentTitleTarget(node, target.runtimeSessionId) ||
      !node.data.agent ||
      node.data.agent.provider !== target.provider ||
      !isResumeSessionBindingVerified(node.data.agent) ||
      node.data.agent.resumeSessionId !== target.resumeSessionId
    ) {
      return node
    }

    const title = buildAgentNodeTitle(target.provider, normalizedTitle)
    if (node.data.title === title) {
      return node
    }

    didChange = true
    return {
      ...node,
      data: {
        ...node.data,
        title,
      },
    }
  })

  return { nextNodes: didChange ? nextNodes : prevNodes, didChange }
}

export async function loadAgentSessionTitle({
  resumeSessionId,
  listSessions,
  isCurrent,
  retryDelaysMs = AGENT_SESSION_TITLE_RETRY_DELAYS_MS,
  signal,
  sleep = waitForRetry,
}: LoadAgentSessionTitleInput): Promise<string | null> {
  for (const delayMs of retryDelaysMs) {
    if (signal?.aborted) {
      return null
    }

    if (delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop -- title availability retries must stay ordered
      await sleep(delayMs, signal)
    }

    if (signal?.aborted || !isCurrent()) {
      return null
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- stop as soon as the exact session title exists
      const sessions = await listSessions()
      if (signal?.aborted || !isCurrent()) {
        return null
      }

      const summary = sessions.find(candidate => candidate.sessionId === resumeSessionId)
      const title = normalizeOptionalString(summary?.title)
      if (title) {
        return title
      }
    } catch {
      // Title resolution is best effort and retries without affecting the Agent runtime.
    }
  }

  return null
}
