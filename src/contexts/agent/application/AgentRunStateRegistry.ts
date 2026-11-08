import { AgentSubmissionEvidence } from './AgentSubmissionEvidence'
import { ClaudeTurnContinuation } from './ClaudeTurnContinuation'
import { commitAgentRunUpdate } from './AgentRunStateUpdate'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { AgentTurnHistory, type FinalMessageSelector } from './AgentTurnHistory'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import {
  projectRunStateFence,
  readRunPromptIdentity,
  claimRunNodeBinding,
  publishRunTransition,
  readRunFinalMessage,
  matchesAgentRunFilter,
  type AgentRunEntry as Entry,
  type AgentRunBinding as Binding,
} from './AgentRunStateEntry'
import { AgentRunStateFences } from './AgentRunStateFences'
import type { RunStateFence, RunStateReceipt } from './ports/PromptDeliveryPorts'
import {
  createAgentRunModel,
  mirrorAgentRunModel,
  type AgentRunObservation,
  type AgentRunSnapshot,
} from '../domain/agentRunState'

import type { AgentRunEvent as AgentRuntimeEvent } from '../../../shared/contracts/dto/agentRunState'
export type { AgentRunEvent as AgentRuntimeEvent } from '../../../shared/contracts/dto/agentRunState'
export interface AgentRuntimeFilter {
  types?: AgentRuntimeEvent['type'][]
  nodeId?: string
  spaceId?: string
  projectId?: string
  state?: AgentRunSnapshot['state']
}
export interface AgentRuntimeResync {
  type: 'resync_required'
  epoch: string
  seq: number
  query: 'agent.list'
}

type RetainedEvent = {
  event: AgentRuntimeEvent
  projectId?: string
  spaceId?: string
  previousBinding?: Binding
}

/** Worker lifetime owner. Uses an injected scheduler; no persistence, transport or renderer dependencies. */
export class AgentRunStateRegistry {
  private readonly disposeListeners = new Set<() => void>()
  onDispose(listener: () => void): void {
    this.disposeListeners.add(listener)
  }
  private readonly submissionEvidence = new AgentSubmissionEvidence()
  private readonly fences = new AgentRunStateFences()
  private tokenSequence = 0
  private readonly entries = new Map<string, Entry>()
  private readonly nodeBindings = new Map<string, Entry>()
  private readonly events: RetainedEvent[] = []
  private readonly subscribers = new Set<(event: RetainedEvent) => void>()
  private readonly deliveryQueue: RetainedEvent[] = []
  private delivering = false
  private sequence = 0
  private readonly retention: number

  constructor(
    private readonly ports: {
      epoch: string
      now: () => number
      createTurnId: () => string
      /** Asynchronous callback; returns cancellation. Owned by the Worker, not a listener. */
      schedule: (callback: () => void, delayMs: number) => () => void
      retention?: number
      onSubscriberError?: (error: unknown) => void
    },
  ) {
    this.retention = ports.retention ?? 1024
    if (!Number.isSafeInteger(this.retention) || this.retention < 1) {
      throw new Error('Agent event retention must be a positive integer')
    }
  }
  register(
    input: Omit<Parameters<typeof createAgentRunModel>[0], 'now'> & {
      projectId?: string
      spaceId?: string
    },
  ): void {
    const existing = this.entries.get(input.sessionId)
    if (
      existing?.model.incarnation === input.incarnation &&
      existing.model.snapshot.provider === input.provider
    ) {
      return
    }
    existing?.cancelExpiry?.()
    if (existing) {
      this.releaseNodeBinding(existing)
    }
    const entry: Entry = {
      history: new AgentTurnHistory(),
      continuation: new ClaudeTurnContinuation(),
      token: `${input.incarnation}:${++this.tokenSequence}`,
      bindingGeneration: 0,
      cursor: this.fences.nextCursor(),
      remote: false,
      model: createAgentRunModel({ ...input, now: this.ports.now() }),
      projectId: input.projectId,
      spaceId: input.spaceId,
    }
    this.entries.set(input.sessionId, entry)
    const notifyDisplaced = this.claimNodeBinding(entry.model.snapshot.nodeId, entry)
    this.publish(
      entry,
      'agent.state_changed',
      undefined,
      false,
      existing ? this.binding(existing) : undefined,
    )
    notifyDisplaced()
    this.notifyFence(entry)
    this.flushDelivery()
  }
  private binding(entry: Entry): Binding {
    return {
      nodeId: entry.model.snapshot.nodeId,
      projectId: entry.projectId,
      spaceId: entry.spaceId,
    }
  }
  bind(
    sessionId: string,
    binding: { nodeId: string | null; projectId?: string; spaceId?: string },
  ): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    if (
      entry.model.snapshot.nodeId === binding.nodeId &&
      entry.projectId === binding.projectId &&
      entry.spaceId === binding.spaceId
    ) {
      return
    }
    entry.bindingGeneration++
    const previousBinding = this.binding(entry)
    this.releaseNodeBinding(entry)
    entry.model.snapshot = { ...entry.model.snapshot, nodeId: binding.nodeId }
    entry.projectId = binding.projectId
    entry.spaceId = binding.spaceId
    const notifyDisplaced = this.claimNodeBinding(binding.nodeId, entry)
    this.publish(entry, 'agent.state_changed', undefined, false, previousBinding)
    notifyDisplaced()
    this.notifyFence(entry)
    this.flushDelivery()
  }
  mirror(
    sessionId: string,
    snapshot: AgentRunSnapshot,
    endedTurn?: AgentRuntimeEvent['endedTurn'],
  ): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    entry.cancelExpiry?.()
    entry.cancelExpiry = undefined
    const next = { ...structuredClone(snapshot), sessionId, nodeId: entry.model.snapshot.nodeId }
    const changed = JSON.stringify(next) !== JSON.stringify(entry.model.snapshot)
    entry.model = mirrorAgentRunModel(entry.model, next)
    publishRunTransition(entry, changed, endedTurn, {
      publish: (...args) => this.publish(...args),
      notify: () => {
        if (changed) {
          this.notifyFence(entry)
        }
      },
      flush: () => this.flushDelivery(),
    })
  }
  observe(
    sessionId: string,
    observation: AgentRunObservation,
    evidence?: PromptSubmissionEvidence,
  ): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    this.update(entry, observation, evidence)
  }
  observeClaudeTranscript(
    sessionId: string,
    incarnation: string,
    record: ClaudeTranscriptObservation,
  ): void {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.model.incarnation !== incarnation) {
      return
    }
    entry.continuation.transcript(record, entry.history, this.ports.now())
    this.update(entry, null)
  }
  private update(
    entry: Entry,
    observation: AgentRunObservation | null,
    evidence?: PromptSubmissionEvidence,
  ): void {
    commitAgentRunUpdate(entry, observation, evidence, {
      now: this.ports.now(),
      createTurnId: this.ports.createTurnId,
      schedule: this.ports.schedule,
      update: () => this.update(entry, null),
      publish: (...args) => this.publish(...args),
      notify: receipt => this.notifyFence(entry, receipt),
      notifyEvidence: receipt =>
        this.submissionEvidence.emit(entry.model.snapshot.sessionId, {
          ...receipt,
          fence: this.readFence({ sessionId: entry.model.snapshot.sessionId }),
        }),
      flush: () => this.flushDelivery(),
    })
  }
  finalMessage(input: ({ sessionId: string } | { nodeId: string }) & FinalMessageSelector) {
    const entry =
      'sessionId' in input ? this.entries.get(input.sessionId) : this.nodeBindings.get(input.nodeId)
    return readRunFinalMessage(entry, input)
  }

  get(locator: { sessionId: string } | { nodeId: string }): AgentRunSnapshot | null {
    const entry =
      'sessionId' in locator
        ? this.entries.get(locator.sessionId)
        : this.nodeBindings.get(locator.nodeId)
    return entry ? structuredClone(entry.model.snapshot) : null
  }

  readFence(locator: { sessionId: string } | { nodeId: string }): RunStateFence | null {
    const entry =
      'sessionId' in locator
        ? this.entries.get(locator.sessionId)
        : this.nodeBindings.get(locator.nodeId)
    if (!entry) {
      return null
    }
    return projectRunStateFence(entry, this.ports.epoch)
  }
  watchFence(fence: RunStateFence, listener: (receipt: RunStateReceipt) => void): () => void {
    return this.fences.watch(
      fence,
      () => this.readFence({ sessionId: fence.snapshot.sessionId }),
      listener,
    )
  }
  promptIdentity(fence: RunStateFence) {
    return readRunPromptIdentity(
      this.entries.get(fence.snapshot.sessionId),
      fence,
      this.ports.epoch,
    )
  }
  watchSubmissionEvidence(
    fence: RunStateFence,
    listener: (receipt: RunStateReceipt) => void,
  ): () => void {
    return this.submissionEvidence.watch(fence, listener)
  }

  setRuntimeContext(
    sessionId: string,
    context: Pick<Entry, 'remote' | 'launchKind' | 'hookCoverage' | 'hookInstallState'>,
  ): void {
    const entry = this.entries.get(sessionId)
    if (
      !entry ||
      (entry.remote === context.remote &&
        entry.launchKind === context.launchKind &&
        entry.hookInstallState === context.hookInstallState &&
        entry.hookCoverage === context.hookCoverage)
    ) {
      return
    }
    Object.assign(entry, context)
    this.notifyFence(entry)
  }
  private notifyFence(entry: Entry, receipt: Omit<RunStateReceipt, 'fence'> = {}): void {
    entry.cursor = this.fences.nextCursor()
    this.fences.emit(entry.model.snapshot.sessionId, {
      ...receipt,
      fence: this.readFence({ sessionId: entry.model.snapshot.sessionId }),
    })
  }

  /** Remove an exited incarnation only; late cleanup cannot remove its replacement. */
  retire(input: { sessionId: string; incarnation: string }): boolean {
    const entry = this.entries.get(input.sessionId)
    if (
      !entry ||
      entry.model.incarnation !== input.incarnation ||
      entry.model.snapshot.state !== 'exited'
    ) {
      return false
    }
    entry.cancelExpiry?.()
    this.entries.delete(input.sessionId)
    this.fences.emit(input.sessionId, { fence: null })
    this.releaseNodeBinding(entry)
    return true
  }

  private claimNodeBinding(nodeId: string | null, entry: Entry): () => void {
    return claimRunNodeBinding(this.nodeBindings, nodeId, entry, {
      publish: (...args) => this.publish(...args),
      notify: displaced => this.notifyFence(displaced),
    })
  }
  private releaseNodeBinding(entry: Entry): void {
    const nodeId = entry.model.snapshot.nodeId
    if (nodeId !== null && this.nodeBindings.get(nodeId) === entry) {
      this.nodeBindings.delete(nodeId)
    }
  }

  list(filter: AgentRuntimeFilter = {}) {
    return {
      epoch: this.ports.epoch,
      seq: this.sequence,
      agents: [...this.entries.values()]
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

  /** Subscribe with the query watermark; replay and registration are synchronous and gap-free. */
  subscribe(
    cursor: { epoch: string; afterSeq: number },
    filter: AgentRuntimeFilter,
    listener: (event: AgentRuntimeEvent | AgentRuntimeResync) => void,
  ): () => void {
    const oldest = this.events[0]?.event.seq ?? this.sequence + 1
    if (
      cursor.epoch !== this.ports.epoch ||
      !Number.isSafeInteger(cursor.afterSeq) ||
      cursor.afterSeq < oldest - 1 ||
      cursor.afterSeq > this.sequence
    ) {
      listener({
        type: 'resync_required',
        epoch: this.ports.epoch,
        seq: this.sequence,
        query: 'agent.list',
      })
      return () => undefined
    }
    // Queue live events during replay so reentrant publishers cannot invert sequence order.
    const pending = this.events.filter(item => item.event.seq > cursor.afterSeq)
    let draining = true
    let deliveredSeq = cursor.afterSeq
    let invalidated = false
    const deliver = (item: RetainedEvent): void => {
      if (invalidated || item.event.seq <= deliveredSeq) {
        return
      }
      deliveredSeq = item.event.seq
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
        this.subscribers.delete(subscriber)
        listener({
          type: 'resync_required',
          epoch: this.ports.epoch,
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
    this.subscribers.add(subscriber)
    try {
      while (pending.length) {
        deliver(pending.shift()!)
      }
      draining = false
    } catch (error) {
      this.subscribers.delete(subscriber)
      throw error
    }
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  dispose(): void {
    for (const listener of this.disposeListeners) {
      listener()
    }
    this.disposeListeners.clear()
    this.fences.dispose()
    this.submissionEvidence.dispose()
    this.subscribers.clear()
    for (const entry of this.entries.values()) {
      entry.cancelExpiry?.()
    }
    this.entries.clear()
    this.nodeBindings.clear()
    this.events.length = 0
    this.deliveryQueue.length = 0
  }

  private publish(
    entry: Entry,
    type: AgentRuntimeEvent['type'],
    endedTurn?: AgentRuntimeEvent['endedTurn'],
    flush = true,
    previousBinding?: Binding,
  ): void {
    const item: RetainedEvent = {
      previousBinding,
      projectId: entry.projectId,
      spaceId: entry.spaceId,
      event: {
        type,
        epoch: this.ports.epoch,
        seq: ++this.sequence,
        snapshot: structuredClone(entry.model.snapshot),
        ...(endedTurn ? { endedTurn } : {}),
      },
    }
    this.events.push(item)
    if (this.events.length > this.retention) {
      this.events.shift()
    }
    this.deliveryQueue.push(item)
    if (flush) {
      this.flushDelivery()
    }
  }

  private flushDelivery(): void {
    if (this.delivering) {
      return
    }
    this.delivering = true
    try {
      while (this.deliveryQueue.length) {
        const item = this.deliveryQueue.shift()!
        for (const subscriber of [...this.subscribers]) {
          if (!this.subscribers.has(subscriber)) {
            continue
          }
          try {
            subscriber(item)
          } catch (error) {
            try {
              this.ports.onSubscriberError?.(error)
            } catch {
              /* diagnostics cannot stop delivery */
            }
          }
        }
      }
    } finally {
      this.delivering = false
    }
  }
}
