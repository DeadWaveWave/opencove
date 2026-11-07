import type { AgentRunSnapshot } from '@shared/contracts/dto/agentRunState'
import type { AgentHookInstallState, TerminalSessionStateSource } from '@shared/contracts/dto'
import type { AgentRuntimeStatus, TerminalNodeData } from '../types'

export interface AgentRuntimeObservationInput {
  state: 'working' | 'waiting' | 'standby'
  source?: TerminalSessionStateSource
  hookInstallState?: AgentHookInstallState | null
  degraded?: boolean
  agentRunState?: AgentRunSnapshot
  /** False only when the Worker's decision is unknown but a provider source still reported a state. */
  observationUnavailable?: boolean
}

export function canObserveAgentRunState(data: TerminalNodeData): boolean {
  if (data.kind === 'terminal') {
    return Boolean(data.agentOverlay && data.agentOverlay.activity?.phase !== 'exited')
  }
  return (
    data.kind === 'agent' &&
    data.status !== 'failed' &&
    data.status !== 'stopped' &&
    data.status !== 'exited'
  )
}

export function projectAgentRuntimeObservation(
  data: TerminalNodeData,
  input: AgentRuntimeObservationInput,
): { data: TerminalNodeData; durableDidChange: boolean } | null {
  // An unknown decision with no reporting source keeps the previous label; a degraded source
  // that still reports a state (e.g. session-file fallback after a failed hook install) shows it.
  if (
    !canObserveAgentRunState(data) ||
    (input.agentRunState?.state === 'unknown' && input.observationUnavailable !== false)
  ) {
    return null
  }

  const nextStatus: AgentRuntimeStatus =
    input.agentRunState?.state === 'exited'
      ? 'exited'
      : input.state === 'standby'
        ? 'standby'
        : input.state === 'waiting'
          ? 'waiting'
          : 'running'
  const source = input.source ?? 'session_file'
  const hookInstallState = input.hookInstallState ?? null
  const degraded = input.degraded === true
  const nextObservation = { status: nextStatus, source, hookInstallState, degraded }
  if (
    (data.kind !== 'terminal' || data.agentOverlay?.status === nextStatus) &&
    data.agentRuntimeObservation?.status === nextStatus &&
    data.agentRuntimeObservation.source === source &&
    data.agentRuntimeObservation.hookInstallState === hookInstallState &&
    data.agentRuntimeObservation.degraded === degraded
  ) {
    return null
  }
  return {
    data: {
      ...data,
      ...(data.kind === 'terminal' && data.agentOverlay
        ? {
            agentOverlay: {
              ...data.agentOverlay,
              status: nextStatus,
            },
          }
        : {}),
      agentRuntimeObservation: nextObservation,
    },
    durableDidChange: false,
  }
}
