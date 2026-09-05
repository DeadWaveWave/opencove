import type { Node } from '@xyflow/react'
import { isValidProvider, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import { isResumeSessionBindingVerified } from '@contexts/agent/domain/agentResumeBinding'
import type { TerminalAgentActivityFence } from '@shared/contracts/dto'
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
    isValidProvider(binding.provider) &&
    (binding.resumeSessionId === null || typeof binding.resumeSessionId === 'string') &&
    (binding.resumeSessionIdVerified === undefined ||
      typeof binding.resumeSessionIdVerified === 'boolean')
  )
}

export function isAgentTreatedNode(node: Pick<Node<TerminalNodeData>, 'data'>): boolean {
  const liveOverlay = node.data.agentOverlay && node.data.agentOverlay.activity?.phase !== 'exited'
  return (
    node.data.kind === 'agent' ||
    (node.data.kind === 'terminal' && Boolean(liveOverlay || node.data.terminalAgentBinding))
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

  const resumableBinding = {
    provider: options.provider,
    resumeSessionId: options.resumeSessionId ?? null,
    resumeSessionIdVerified: options.resumeSessionIdVerified === true,
  }

  return {
    ...node,
    data: {
      ...node.data,
      terminalProviderHint: options.provider,
      agentRuntimeObservation: null,
      terminalAgentBinding: isResumeSessionBindingVerified(resumableBinding)
        ? resumableBinding
        : null,
      agentOverlay: {
        provider: options.provider,
        status: 'standby',
        startedAtMs: options.startedAtMs,
      },
    },
  }
}

export function clearTerminalAgentOverlay(
  node: Node<TerminalNodeData>,
  options: { expectedStartedAtMs?: number } = {},
): Node<TerminalNodeData> {
  if (
    node.data.kind !== 'terminal' ||
    (!node.data.agentOverlay && !node.data.terminalAgentBinding) ||
    (options.expectedStartedAtMs !== undefined &&
      node.data.agentOverlay?.startedAtMs !== options.expectedStartedAtMs)
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
      agentRuntimeObservation: null,
    },
  }
}

export function reactivateTerminalAgentOverlayAfterReexec(
  node: Node<TerminalNodeData>,
  options: {
    expectedSessionId: string
    expectedStartedAtMs: number
    expectedActivity: TerminalAgentActivityFence | null
    provider: AgentProvider
    startedAtMs: number
    resumeSessionId: string | null
    resumeSessionIdVerified: boolean
  },
): Node<TerminalNodeData> {
  if (node.data.kind !== 'terminal' || node.data.sessionId !== options.expectedSessionId) {
    return node
  }
  const overlay = node.data.agentOverlay
  const currentActivity = overlay?.activity
  if (options.expectedActivity) {
    if (options.expectedActivity.phase === 'active' && currentActivity?.phase === 'active') {
      return node
    }
    if (
      currentActivity &&
      (currentActivity.invocationId !== options.expectedActivity.invocationId ||
        currentActivity.generation !== options.expectedActivity.generation ||
        (currentActivity.phase !== options.expectedActivity.phase &&
          currentActivity.phase !== 'exited'))
    ) {
      return node
    }
  } else if (currentActivity) {
    return node
  }
  if (!currentActivity && overlay && overlay.startedAtMs !== options.expectedStartedAtMs) {
    return node
  }

  const binding = {
    provider: options.provider,
    resumeSessionId: options.resumeSessionId,
    resumeSessionIdVerified: options.resumeSessionIdVerified,
  }
  return {
    ...node,
    data: {
      ...node.data,
      terminalProviderHint: options.provider,
      agentRuntimeObservation: null,
      terminalAgentBinding: isResumeSessionBindingVerified(binding) ? binding : null,
      agentOverlay: {
        provider: options.provider,
        status: 'standby',
        startedAtMs: options.startedAtMs,
      },
    },
  }
}

export function resolveAgentTreatedProvider(node: Node<TerminalNodeData>): AgentProvider | null {
  if (node.data.kind === 'agent') {
    return node.data.agent?.provider ?? null
  }

  const liveOverlayProvider =
    node.data.agentOverlay?.activity?.phase === 'exited'
      ? null
      : (node.data.agentOverlay?.provider ?? null)
  return liveOverlayProvider ?? node.data.terminalAgentBinding?.provider ?? null
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
  const activeProvider = overlay?.activity?.phase === 'active' ? overlay.provider : null
  const provider = activeProvider ?? binding?.provider ?? overlay?.provider ?? null
  if (!provider || !overlay || cwd.length === 0 || !Number.isFinite(overlay.startedAtMs)) {
    return null
  }
  const providerBinding = binding?.provider === provider ? binding : null

  return {
    provider,
    cwd,
    startedAt: new Date(overlay.startedAtMs).toISOString(),
    resumeSessionId: providerBinding?.resumeSessionId ?? null,
    resumeSessionIdVerified: providerBinding
      ? isResumeSessionBindingVerified(providerBinding)
      : false,
  }
}
