import type { Node } from '@xyflow/react'
import type {
  AgentNodeData,
  TerminalNodeData,
} from '@contexts/workspace/presentation/renderer/types'
import { translate } from '@app/renderer/i18n'
import { toAgentNodeTitle, toErrorMessage } from '@app/renderer/shell/utils/format'
import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
} from '@contexts/agent/domain/agentResumeBinding'
import { resolveInitialAgentRuntimeStatus } from '@contexts/agent/domain/agentRuntimeStatus'

interface HydrateAgentNodeInput {
  node: Node<TerminalNodeData>
  workspacePath: string
  agentFullAccess: boolean
}

interface FailedAgentFallbackInput {
  node: Node<TerminalNodeData>
  cwd: string
  agent: AgentNodeData
  errorMessage: string
}

async function fallbackToFailedAgentTerminal({
  node,
  cwd,
  agent,
  errorMessage,
}: FailedAgentFallbackInput): Promise<Node<TerminalNodeData>> {
  const now = new Date().toISOString()

  try {
    const fallback = await window.opencoveApi.pty.spawn({
      cwd,
      cols: 80,
      rows: 24,
    })

    return {
      ...node,
      data: {
        ...node.data,
        sessionId: fallback.sessionId,
        status: 'failed' as const,
        endedAt: now,
        exitCode: null,
        lastError: errorMessage,
        scrollback: node.data.scrollback,
        agent,
      },
    }
  } catch (fallbackError) {
    return {
      ...node,
      data: {
        ...node.data,
        sessionId: '',
        status: 'failed' as const,
        endedAt: now,
        exitCode: null,
        lastError: [
          errorMessage,
          translate('messages.fallbackTerminalFailed', { message: toErrorMessage(fallbackError) }),
        ].join(' '),
        scrollback: node.data.scrollback,
        agent,
      },
    }
  }
}

async function resolvePendingResumeSessionId(node: Node<TerminalNodeData>): Promise<string | null> {
  if (node.data.kind !== 'agent' || !node.data.agent) {
    return null
  }

  if (typeof node.data.startedAt !== 'string' || node.data.startedAt.trim().length === 0) {
    return null
  }

  const resolveResumeSessionId = window.opencoveApi.agent.resolveResumeSessionId
  if (typeof resolveResumeSessionId !== 'function') {
    return null
  }

  try {
    const result = await resolveResumeSessionId({
      provider: node.data.agent.provider,
      cwd: node.data.agent.executionDirectory,
      startedAt: node.data.startedAt,
    })

    return typeof result.resumeSessionId === 'string' && result.resumeSessionId.trim().length > 0
      ? result.resumeSessionId
      : null
  } catch {
    return null
  }
}

export async function hydrateAgentNode({
  node,
  workspacePath,
  agentFullAccess,
}: HydrateAgentNodeInput): Promise<Node<TerminalNodeData>> {
  if (node.data.kind !== 'agent' || !node.data.agent) {
    return node
  }

  const hasActiveAgentStatus =
    node.data.status === 'running' ||
    node.data.status === 'standby' ||
    node.data.status === 'restoring'

  const resolvedPendingResumeSessionId =
    hasActiveAgentStatus && !isResumeSessionBindingVerified(node.data.agent)
      ? await resolvePendingResumeSessionId(node)
      : null

  const sanitizedAgent = resolvedPendingResumeSessionId
    ? {
        ...node.data.agent,
        resumeSessionId: resolvedPendingResumeSessionId,
        resumeSessionIdVerified: true,
      }
    : isResumeSessionBindingVerified(node.data.agent)
      ? node.data.agent
      : {
          ...node.data.agent,
          ...clearResumeSessionBinding(),
        }

  const shouldAutoResumeAgent =
    hasActiveAgentStatus && isResumeSessionBindingVerified(sanitizedAgent)
  const shouldRelaunchBlankAgent =
    hasActiveAgentStatus &&
    !isResumeSessionBindingVerified(sanitizedAgent) &&
    sanitizedAgent.prompt.trim().length === 0

  if (shouldAutoResumeAgent) {
    try {
      const restoredAgent = await window.opencoveApi.agent.launch({
        provider: sanitizedAgent.provider,
        cwd: sanitizedAgent.executionDirectory,
        prompt: sanitizedAgent.prompt,
        mode: 'resume',
        model: sanitizedAgent.model,
        resumeSessionId: sanitizedAgent.resumeSessionId,
        agentFullAccess,
        cols: 80,
        rows: 24,
      })

      return {
        ...node,
        data: {
          ...node.data,
          sessionId: restoredAgent.sessionId,
          title: toAgentNodeTitle(sanitizedAgent.provider, restoredAgent.effectiveModel),
          status: resolveInitialAgentRuntimeStatus(sanitizedAgent.prompt),
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: node.data.scrollback,
          startedAt: node.data.startedAt ?? new Date().toISOString(),
          agent: {
            ...sanitizedAgent,
            effectiveModel: restoredAgent.effectiveModel,
            launchMode: restoredAgent.launchMode,
            resumeSessionId: restoredAgent.resumeSessionId ?? sanitizedAgent.resumeSessionId,
            resumeSessionIdVerified: true,
          },
        },
      }
    } catch (error) {
      return fallbackToFailedAgentTerminal({
        node,
        cwd: workspacePath,
        agent: sanitizedAgent,
        errorMessage: translate('messages.agentResumeFailed', { message: toErrorMessage(error) }),
      })
    }
  }

  if (shouldRelaunchBlankAgent) {
    try {
      const relaunchedAgent = await window.opencoveApi.agent.launch({
        provider: sanitizedAgent.provider,
        cwd: sanitizedAgent.executionDirectory,
        prompt: sanitizedAgent.prompt,
        mode: 'new',
        model: sanitizedAgent.model,
        agentFullAccess,
        cols: 80,
        rows: 24,
      })

      return {
        ...node,
        data: {
          ...node.data,
          sessionId: relaunchedAgent.sessionId,
          title: toAgentNodeTitle(sanitizedAgent.provider, relaunchedAgent.effectiveModel),
          status: resolveInitialAgentRuntimeStatus(sanitizedAgent.prompt),
          startedAt: new Date().toISOString(),
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: {
            ...sanitizedAgent,
            effectiveModel: relaunchedAgent.effectiveModel,
            launchMode: relaunchedAgent.launchMode,
            ...clearResumeSessionBinding(),
          },
        },
      }
    } catch (error) {
      return fallbackToFailedAgentTerminal({
        node,
        cwd: sanitizedAgent.executionDirectory,
        agent: sanitizedAgent,
        errorMessage: translate('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
      })
    }
  }

  try {
    const spawned = await window.opencoveApi.pty.spawn({
      cwd: sanitizedAgent.executionDirectory,
      cols: 80,
      rows: 24,
    })

    return {
      ...node,
      data: {
        ...node.data,
        sessionId: spawned.sessionId,
        status: hasActiveAgentStatus ? ('stopped' as const) : node.data.status,
        endedAt: hasActiveAgentStatus
          ? (node.data.endedAt ?? new Date().toISOString())
          : node.data.endedAt,
        lastError: null,
        agent: sanitizedAgent,
      },
    }
  } catch (error) {
    return fallbackToFailedAgentTerminal({
      node,
      cwd: workspacePath,
      agent: sanitizedAgent,
      errorMessage: translate('messages.terminalLaunchFailed', { message: toErrorMessage(error) }),
    })
  }
}
