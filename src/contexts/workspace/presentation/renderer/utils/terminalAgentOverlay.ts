import type { Node } from '@xyflow/react'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalAgentSessionBinding, TerminalNodeData } from '../types'

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

export function isAgentTreatedNode(node: Node<TerminalNodeData>): boolean {
  return (
    node.data.kind === 'agent' ||
    (node.data.kind === 'terminal' &&
      Boolean(node.data.agentOverlay || node.data.terminalAgentBinding))
  )
}

export function activateTerminalAgentOverlay(
  node: Node<TerminalNodeData>,
  options: { provider: AgentProvider; startedAtMs: number },
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
        resumeSessionId: null,
        resumeSessionIdVerified: false,
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

export function resolveAgentTreatedProvider(node: Node<TerminalNodeData>): AgentProvider | null {
  if (node.data.kind === 'agent') {
    return node.data.agent?.provider ?? null
  }

  return node.data.agentOverlay?.provider ?? node.data.terminalAgentBinding?.provider ?? null
}
