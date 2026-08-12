import type { AgentHookInstallState, TerminalSessionStateSource } from '@shared/contracts/dto'
import type { AgentRuntimeStatus, TerminalNodeData } from '../types'

export interface AgentRuntimeObservationInput {
  state: 'working' | 'waiting' | 'standby'
  source?: TerminalSessionStateSource
  hookInstallState?: AgentHookInstallState | null
}

export function projectAgentRuntimeObservation(
  data: TerminalNodeData,
  input: AgentRuntimeObservationInput,
): { data: TerminalNodeData; durableDidChange: boolean } | null {
  if (data.status === 'failed' || data.status === 'stopped' || data.status === 'exited') {
    return null
  }

  const nextStatus: AgentRuntimeStatus =
    input.state === 'standby' ? 'standby' : input.state === 'waiting' ? 'waiting' : 'running'
  const source = input.source ?? 'session_file'
  const hookInstallState = input.hookInstallState ?? null
  const nextObservation = { status: nextStatus, source, hookInstallState }
  const observationMatches = hookInstallState
    ? data.agentRuntimeObservation?.status === nextStatus &&
      data.agentRuntimeObservation.source === source &&
      data.agentRuntimeObservation.hookInstallState === hookInstallState
    : !data.agentRuntimeObservation

  if (source === 'claude_hook') {
    if (
      data.agentRuntimeObservation?.status === nextStatus &&
      data.agentRuntimeObservation.source === source &&
      data.agentRuntimeObservation.hookInstallState === hookInstallState
    ) {
      return null
    }
    return {
      data: { ...data, agentRuntimeObservation: nextObservation },
      durableDidChange: false,
    }
  }

  if (data.status === nextStatus && observationMatches) {
    return null
  }
  return {
    data: {
      ...data,
      status: nextStatus,
      agentRuntimeObservation: hookInstallState ? nextObservation : null,
    },
    durableDidChange: data.status !== nextStatus,
  }
}
