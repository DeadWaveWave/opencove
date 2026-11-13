import type { AgentRunObservation } from '../domain/agentRunState'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { ClaudeLiveConversation } from './ClaudeLiveConversation'
import type { ClaudeTurnContinuation } from './ClaudeTurnContinuation'
import { createAppError } from '../../../shared/errors/appError'
import type { AgentTurnHistory, FinalMessageSelector } from './AgentTurnHistory'
import type { AgentRuntimeFilter, AgentRuntimeEvent } from './AgentRunStateRegistry'
import type { AgentRunModel } from '../domain/agentRunState'
import type { RunStateFence } from './ports/PromptDeliveryPorts'
export type AgentRunEntry = {
  conversation?: ClaudeLiveConversation
  conversationSchedule: (callback: () => void, delay: number) => () => void
  continuation: ClaudeTurnContinuation
  history: AgentTurnHistory
  model: AgentRunModel
  token: string
  bindingGeneration: number
  cursor: number
  launchNodeId: string | null
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
    conversationGeneration: entry.conversation?.generation,
    claudeClearReady: entry.conversation?.ready ?? false,
    conversationQuarantined: !!(
      entry.conversation?.input.blocked ||
      (entry.conversation?.active && entry.conversation.quarantined)
    ),
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

/** Queue immutable transition payloads before fences can re-enter the registry. */
export function publishRunTransition(
  entry: AgentRunEntry,
  changed: boolean,
  endedTurn: AgentRuntimeEvent['endedTurn'],
  ports: {
    publish(
      entry: AgentRunEntry,
      type: AgentRuntimeEvent['type'],
      endedTurn?: AgentRuntimeEvent['endedTurn'],
      flush?: boolean,
      previousBinding?: AgentRunBinding,
    ): void
    notify(): void
    flush(): void
  },
): void {
  const captured = {
    ...entry,
    model: { ...entry.model, snapshot: structuredClone(entry.model.snapshot) },
  }
  if (changed) {
    ports.publish(captured, 'agent.state_changed', undefined, false)
  }
  if (endedTurn) {
    ports.publish(captured, 'agent.turn_completed', structuredClone(endedTurn), false)
  }
  ports.notify()
  ports.flush()
}

export function readRunFinalMessage(
  entry: AgentRunEntry | undefined,
  selector: FinalMessageSelector,
) {
  if (!entry || entry.remote) {
    throw createAppError('agent.final_message_unavailable', {
      details: {
        reason:
          entry?.remote && selector.turnId !== undefined
            ? 'remote_history_unavailable'
            : 'no_ended_turn',
      },
    })
  }
  return entry.history.read(entry.model.snapshot, selector)
}

/** Queue the displaced snapshot first; defer its fence callback until the claimant is captured. */
export function claimRunNodeBinding(
  bindings: Map<string, AgentRunEntry>,
  nodeId: string | null,
  entry: AgentRunEntry,
  ports: {
    publish: Parameters<typeof publishRunTransition>[3]['publish']
    notify(entry: AgentRunEntry): void
  },
): () => void {
  if (nodeId === null) {
    return () => {}
  }
  const displaced = bindings.get(nodeId)
  bindings.set(nodeId, entry)
  if (!displaced || displaced === entry) {
    return () => {}
  }
  const previousBinding = { nodeId, projectId: displaced.projectId, spaceId: displaced.spaceId }
  displaced.bindingGeneration++
  displaced.model = { ...displaced.model, snapshot: { ...displaced.model.snapshot, nodeId: null } }
  publishRunTransition(displaced, true, undefined, {
    publish: (captured, type, endedTurn, flush) =>
      ports.publish(captured, type, endedTurn, flush, previousBinding),
    notify: () => {},
    flush: () => {},
  })
  return () => ports.notify(displaced)
}

/** Private identity read: never part of the content-free fence projection. */
export function readRunPromptIdentity(
  entry: AgentRunEntry | undefined,
  fence: RunStateFence,
  epoch: string,
) {
  return entry &&
    entry.token === fence.incarnation &&
    epoch === fence.epoch &&
    entry.conversation?.generation === fence.conversationGeneration
    ? entry.history.identity(
        entry.conversation?.active || entry.conversation?.ready
          ? entry.conversation.clearIdentity
          : undefined,
      )
    : undefined
}

/** Runtime provenance is independent of durable conversation ownership. */
export function setRunRuntimeContext(
  entry: AgentRunEntry,
  context: Pick<AgentRunEntry, 'remote' | 'launchKind' | 'hookCoverage' | 'hookInstallState'>,
): boolean {
  if (
    entry.remote === context.remote &&
    entry.launchKind === context.launchKind &&
    entry.hookInstallState === context.hookInstallState &&
    entry.hookCoverage === context.hookCoverage
  ) {
    return false
  }
  if (
    context.remote ||
    context.launchKind !== 'managed' ||
    context.hookCoverage !== 'lifecycle' ||
    (context.hookInstallState !== undefined && context.hookInstallState !== 'installed')
  ) {
    entry.conversation?.veto()
  }
  Object.assign(entry, context)
  return true
}

export function runBinding(entry: AgentRunEntry): AgentRunBinding {
  return { nodeId: entry.model.snapshot.nodeId, projectId: entry.projectId, spaceId: entry.spaceId }
}

/** The same source fence protects raw ingress and reducer/degradation side effects. */
export function acceptsRunObservation(
  entry: AgentRunEntry | undefined,
  source: AgentRunObservation['source'],
  evidence?: PromptSubmissionEvidence,
): boolean {
  if (
    !entry ||
    (evidence?.invocationId !== undefined && evidence.invocationId !== entry.model.incarnation)
  ) {
    return false
  }
  // The first authenticated clear installs an invocation-lifetime namespace fence.
  if (!entry.conversation) {
    return true
  }
  return (
    (source !== 'claude_hook' &&
      !(source === 'session_file' && entry.model.snapshot.provider === 'claude-code')) ||
    entry.conversation.accepts(evidence?.conversationGeneration, evidence?.providerSessionId)
  )
}
export function listAgentRuns(
  entries: Iterable<AgentRunEntry>,
  epoch: string,
  seq: number,
  archive: boolean,
  filter: AgentRuntimeFilter,
) {
  return {
    epoch,
    seq,
    ...(archive ? { turnArchive: true } : {}),
    agents: [...entries]
      .filter(
        entry =>
          entry.model.snapshot.state !== 'exited' &&
          matchesAgentRunFilter(
            {
              event: { snapshot: entry.model.snapshot } as AgentRuntimeEvent,
              projectId: entry.projectId,
              spaceId: entry.spaceId,
            },
            { ...filter, types: undefined },
          ),
      )
      .map(entry => structuredClone(entry.model.snapshot)),
  }
}
