import { matchesAgentRunFilter } from './AgentRunStateEntry'
import type {
  AgentRuntimeEvent,
  AgentRuntimeResync,
  AgentRuntimeFilter,
} from './AgentRunStateRegistry'
import type { AgentRunBinding } from './AgentRunStateEntry'
export type RetainedEvent = {
  event: AgentRuntimeEvent
  projectId?: string
  spaceId?: string
  previousBinding?: AgentRunBinding
}
export type ContextualPublication =
  | RetainedEvent
  | (AgentRuntimeResync & {
      reason: 'retention_expired' | 'epoch_changed' | 'cursor_ahead'
      oldestSeq: number
    })
export function subscribeAgentRuns(
  events: RetainedEvent[],
  subscribers: Set<(event: RetainedEvent) => void>,
  epoch: string,
  sequence: number,
  cursor: { epoch: string; afterSeq: number },
  filter: AgentRuntimeFilter,
  listener: (event: AgentRuntimeEvent | AgentRuntimeResync) => void,
  contextual?: (event: ContextualPublication) => void,
): () => void {
  const oldest = events[0]?.event.seq ?? sequence + 1
  if (
    cursor.epoch !== epoch ||
    !Number.isSafeInteger(cursor.afterSeq) ||
    cursor.afterSeq < oldest - 1 ||
    cursor.afterSeq > sequence
  ) {
    const gap = {
      type: 'resync_required',
      epoch: epoch,
      seq: sequence,
      query: 'agent.list',
    } as const
    if (contextual) {
      contextual({
        ...gap,
        oldestSeq: oldest,
        reason:
          cursor.epoch !== epoch
            ? 'epoch_changed'
            : cursor.afterSeq > sequence
              ? 'cursor_ahead'
              : 'retention_expired',
      })
    } else {
      listener(gap)
    }
    return () => undefined
  }
  // Queue live events during replay so reentrant publishers cannot invert sequence order.
  const pending = events.filter(item => item.event.seq > cursor.afterSeq)
  let draining = true
  let deliveredSeq = cursor.afterSeq
  let invalidated = false
  const deliver = (item: RetainedEvent): void => {
    if (invalidated || item.event.seq <= deliveredSeq) {
      return
    }
    deliveredSeq = item.event.seq
    if (contextual) {
      contextual(structuredClone(item))
      return
    }
    const previous = item.previousBinding
    if (
      previous &&
      !matchesAgentRunFilter(item, { ...filter, types: undefined }) &&
      matchesAgentRunFilter(
        {
          ...item,
          ...previous,
          event: { ...item.event, snapshot: { ...item.event.snapshot, nodeId: previous.nodeId } },
        },
        { ...filter, types: undefined },
      )
    ) {
      invalidated = true
      subscribers.delete(subscriber)
      listener({
        type: 'resync_required',
        epoch: epoch,
        seq: item.event.seq,
        query: 'agent.list',
      })
    } else if (matchesAgentRunFilter(item, filter)) {
      listener(structuredClone(item.event))
    }
  }
  const subscriber = (item: RetainedEvent): void => {
    if (draining) {
      pending.push(item)
    } else {
      deliver(item)
    }
  }
  subscribers.add(subscriber)
  try {
    while (pending.length) {
      deliver(pending.shift()!)
    }
    draining = false
  } catch (error) {
    subscribers.delete(subscriber)
    throw error
  }
  return () => {
    subscribers.delete(subscriber)
  }
}
