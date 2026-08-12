import type { Node } from '@xyflow/react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalAgentSessionBinding, TerminalNodeData } from '../types'

export interface AgentTreatedActionContext {
  provider: AgentProvider
  cwd: string
  startedAt: string
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
}

export function isTerminalAgentBinding(value: unknown): value is TerminalAgentSessionBinding {
  if (!value || typeof value !== 'object') {
    return false
  }

  const binding = value as Partial<TerminalAgentSessionBinding>
  return (
    (binding.provider === 'claude-code' ||
      binding.provider === 'codex' ||
      binding.provider === 'opencode' ||
      binding.provider === 'gemini') &&
    (binding.resumeSessionId === null || typeof binding.resumeSessionId === 'string') &&
    (binding.resumeSessionIdVerified === undefined ||
      typeof binding.resumeSessionIdVerified === 'boolean')
  )
}

export function isAgentTreatedNode(node: Pick<Node<TerminalNodeData>, 'data'>): boolean {
  return (
    node.data.kind === 'agent' ||
    (node.data.kind === 'terminal' &&
      Boolean(node.data.agentOverlay || node.data.terminalAgentBinding))
  )
}

export function activateTerminalAgentOverlay(
  node: Node<TerminalNodeData>,
  options: {
    provider: AgentProvider
    startedAtMs: number
    resumeSessionId?: string | null
    resumeSessionIdVerified?: boolean
  },
): Node<TerminalNodeData> {
  if (node.data.kind !== 'terminal' || isAgentTreatedNode(node)) {
    return node
  }

  return {
    ...node,
    data: {
      ...node.data,
      terminalAgentBinding: {
        provider: options.provider,
        resumeSessionId: options.resumeSessionId ?? null,
        resumeSessionIdVerified: options.resumeSessionIdVerified === true,
      },
      agentOverlay: {
        provider: options.provider,
        status: 'running',
        startedAtMs: options.startedAtMs,
      },
    },
  }
}

export function clearTerminalAgentOverlay(node: Node<TerminalNodeData>): Node<TerminalNodeData> {
  if (
    node.data.kind !== 'terminal' ||
    (!node.data.agentOverlay && !node.data.terminalAgentBinding)
  ) {
    return node
  }

  return {
    ...node,
    data: {
      ...node.data,
      terminalAgentBinding: null,
      agentOverlay: null,
      terminalProviderHint: null,
    },
  }
}

export function reactivateTerminalAgentOverlayAfterReexec(
  node: Node<TerminalNodeData>,
  options: {
    expectedSessionId: string
    provider: AgentProvider
    startedAtMs: number
    resumeSessionId: string | null
    resumeSessionIdVerified: boolean
  },
): Node<TerminalNodeData> {
  if (
    node.data.kind !== 'terminal' ||
    node.data.sessionId !== options.expectedSessionId ||
    isAgentTreatedNode(node)
  ) {
    return node
  }

  return activateTerminalAgentOverlay(node, options)
}

export function resolveAgentTreatedProvider(node: Node<TerminalNodeData>): AgentProvider | null {
  if (node.data.kind === 'agent') {
    return node.data.agent?.provider ?? null
  }

  return node.data.agentOverlay?.provider ?? node.data.terminalAgentBinding?.provider ?? null
}

export function resolveAgentTreatedActionContext(
  node: Pick<Node<TerminalNodeData>, 'data'>,
): AgentTreatedActionContext | null {
  if (!isAgentTreatedNode(node)) {
    return null
  }

  if (node.data.kind === 'agent') {
    const agent = node.data.agent
    const startedAt = node.data.startedAt?.trim() ?? ''
    if (!agent || startedAt.length === 0) {
      return null
    }

    return {
      provider: agent.provider,
      cwd: agent.executionDirectory,
      startedAt,
      resumeSessionId: agent.resumeSessionId,
      resumeSessionIdVerified: agent.resumeSessionIdVerified === true,
    }
  }

  const binding = node.data.terminalAgentBinding
  const overlay = node.data.agentOverlay
  const cwd = node.data.executionDirectory?.trim() ?? ''
  if (!binding || !overlay || cwd.length === 0 || !Number.isFinite(overlay.startedAtMs)) {
    return null
  }

  return {
    provider: binding.provider,
    cwd,
    startedAt: new Date(overlay.startedAtMs).toISOString(),
    resumeSessionId: binding.resumeSessionId,
    resumeSessionIdVerified: binding.resumeSessionIdVerified === true,
  }
}
