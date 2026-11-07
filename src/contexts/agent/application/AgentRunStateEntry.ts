import type { AgentTurnHistory } from './AgentTurnHistory'
import type { AgentRuntimeFilter, AgentRuntimeEvent } from './AgentRunStateRegistry'
import type { AgentRunModel } from '../domain/agentRunState'
import type { RunStateFence } from './ports/PromptDeliveryPorts'
export type AgentRunEntry = {
  history: AgentTurnHistory
  model: AgentRunModel
  token: string
  bindingGeneration: number
  cursor: number
  remote: boolean
  launchKind?: RunStateFence['launchKind']
  hookCoverage?: RunStateFence['hookCoverage']
  hookInstallState?: RunStateFence['hookInstallState']
  projectId?: string
  spaceId?: string
  cancelExpiry?: () => void
}
export type AgentRunBinding = { nodeId: string | null; projectId?: string; spaceId?: string }

export function projectRunStateFence(entry: AgentRunEntry, epoch: string): RunStateFence {
  const { model } = entry
  return structuredClone({
    epoch: epoch,
    incarnation: entry.token,
    bindingGeneration: entry.bindingGeneration,
    cursor: entry.cursor,
    snapshot: model.snapshot,
    lastTurnEnd: model.lastTurnEnd,
    watermarks: Object.fromEntries(
      Object.entries(model.observations).map(([source, value]) => [source, value.sourceSequence]),
    ),
    remote: entry.remote,
    launchKind: entry.launchKind,
    hookCoverage: entry.hookCoverage,
    hookInstallState: entry.hookInstallState,
  })
}

export function matchesAgentRunFilter(
  item: {
    event: Pick<AgentRuntimeEvent, 'type' | 'snapshot'>
    projectId?: string
    spaceId?: string
  },
  filter: AgentRuntimeFilter,
): boolean {
  return (
    (!filter.types || filter.types.includes(item.event.type)) &&
    (!filter.nodeId || filter.nodeId === item.event.snapshot.nodeId) &&
    (!filter.spaceId || filter.spaceId === item.spaceId) &&
    (!filter.projectId || filter.projectId === item.projectId) &&
    (!filter.state || filter.state === item.event.snapshot.state)
  )
}

export function scheduleRunExpiry(
  entry: AgentRunEntry,
  schedule: (callback: () => void, delay: number) => () => void,
  now: number,
  update: () => void,
): void {
  entry.cancelExpiry?.()
  entry.cancelExpiry = undefined
  const deadline = entry.model.nextTransitionAtMs
  if (deadline === null) {
    return
  }
  let active = true
  const cancel = schedule(
    () => {
      if (!active) {
        return
      }
      active = false
      entry.cancelExpiry = undefined
      update()
    },
    Math.max(0, deadline - now),
  )
  entry.cancelExpiry = () => {
    active = false
    cancel()
  }
}
