import type { AgentWaitProjection, WaitSnapshot, WaitCompletion } from './agentWaitProjection'
import type { AgentRunEvent } from '../../../shared/contracts/dto/agentRunState'
import type { WaitOptions } from './agentWait'
import { CliError } from './errors'

type Fulfillment = {
  nodeId: string
  sessionId: string
  completion?: WaitCompletion
  endedTurn?: WaitSnapshot['endedTurn']
  endedTurnOutcome?: WaitSnapshot['endedTurnOutcome']
}

/** Invocation-local progress and stop policy; never writes to the Worker or a PTY. */
export class AgentWaitPolicy {
  private readonly fulfilled = new Map<string, Fulfillment>()
  private readonly provisional = new Map<string, Fulfillment>()
  private readonly bindings = new Map<string, string | undefined>()
  private bindingKey(nodeId: string, sessionId: string | undefined): string {
    return JSON.stringify([nodeId, sessionId])
  }

  /** The sole invalidation rule: progress belongs to one observed node/session binding. */
  bind(nodeId: string, sessionId: string | undefined): void {
    if (this.options.turnId !== undefined) {
      return
    }
    const previous = this.bindings.get(nodeId)
    if (previous !== sessionId) {
      const key = this.bindingKey(nodeId, previous)
      this.fulfilled.delete(key)
      this.provisional.delete(key)
    }
    this.bindings.set(nodeId, sessionId)
  }

  private record(nodeId: string) {
    return this.fulfilled.get(this.bindingKey(nodeId, this.bindings.get(nodeId)))
  }
  private readonly exactTurnSessions = new Set<string>()
  constructor(
    private readonly options: Pick<
      WaitOptions,
      'nodeIds' | 'until' | 'turnId' | 'any' | 'throughWaiting'
    >,
  ) {}

  /** Replay can advance snapshots many turns before its watermark; retain only the first end. */
  retainCompletion(event: AgentRunEvent): void {
    const { nodeId, sessionId } = event.snapshot
    if (
      this.options.until !== 'turn-end' ||
      this.options.turnId !== undefined ||
      event.type !== 'agent.turn_completed' ||
      !event.endedTurn ||
      nodeId === null ||
      this.bindings.get(nodeId) !== sessionId
    ) {
      return
    }
    const key = this.bindingKey(nodeId, sessionId)
    if (this.fulfilled.has(key) || this.provisional.has(key)) {
      return
    }
    this.provisional.set(key, {
      nodeId,
      sessionId,
      endedTurn: event.endedTurn,
      endedTurnOutcome: event.snapshot.turnOutcome,
      completion: {
        nodeId,
        sessionId,
        turnId: event.endedTurn.id,
        outcome: event.snapshot.turnOutcome ?? 'unknown',
      },
    })
  }

  /** Call only after both reconciliation barriers are ready; no provisional result is exposed. */
  promoteCompletions(): void {
    for (const [key, completion] of this.provisional) {
      this.fulfilled.set(key, completion)
      this.provisional.delete(key)
    }
  }

  /** Only call at a reconciled cursor. Completion progress survives stream resyncs. */
  satisfied(projection: AgentWaitProjection, exactEnded: boolean, retain = true): boolean {
    if (this.options.turnId !== undefined) {
      const snapshot = projection.snapshot(this.options.nodeIds[0])
      if (snapshot?.turn?.id === this.options.turnId) {
        // A binding or negative history read alone never attributes a turn to this session.
        this.exactTurnSessions.add(snapshot.sessionId)
      }
      return exactEnded
    }
    const observed = new Set(this.options.nodeIds.filter(nodeId => this.isFulfilled(nodeId)))
    for (const nodeId of this.options.nodeIds) {
      const snapshot = projection.snapshot(nodeId)
      const matches =
        this.options.until !== 'turn-end' &&
        snapshot?.state === this.options.until &&
        (this.options.until !== 'waiting' || snapshot?.quality !== 'degraded') &&
        (this.options.until !== 'idle' ||
          (snapshot?.turn === null && snapshot?.quality !== 'degraded'))
      if (matches && snapshot) {
        observed.add(nodeId)
        if (retain && !this.isFulfilled(nodeId)) {
          this.fulfilled.set(this.bindingKey(nodeId, snapshot.sessionId), {
            nodeId,
            sessionId: snapshot.sessionId,
          })
        }
      }
    }
    return this.options.any
      ? this.options.nodeIds.some(id => observed.has(id))
      : this.options.nodeIds.every(id => observed.has(id))
  }

  /** Return the completion that first fulfilled this target, independent of later snapshots. */
  completion(
    nodeId: string,
  ): Pick<WaitSnapshot, 'completion' | 'endedTurn' | 'endedTurnOutcome'> | undefined {
    const record = this.record(nodeId)
    return record && this.options.until === 'turn-end'
      ? {
          completion: record.completion,
          endedTurn: record.endedTurn,
          endedTurnOutcome: record.endedTurnOutcome,
        }
      : undefined
  }

  isFulfilled(nodeId: string): boolean {
    return !!this.record(nodeId)
  }

  /** Success and identity-specific history errors are evaluated before attention. */
  attention(projection: AgentWaitProjection): void {
    const targets = this.options.nodeIds.map(nodeId => {
      const snapshot = projection.snapshot(nodeId)
      const fulfilled = this.isFulfilled(nodeId)
      const attributed =
        this.options.turnId === undefined || snapshot?.turn?.id === this.options.turnId
      const waiting = snapshot?.state === 'waiting' && snapshot.quality !== 'degraded' && attributed
      const exited =
        snapshot?.state === 'exited' &&
        (this.options.turnId === undefined || this.exactTurnSessions.has(snapshot.sessionId))
      const status = fulfilled ? 'fulfilled' : exited ? 'exited' : waiting ? 'waiting' : 'pending'
      return {
        nodeId,
        sessionId: snapshot?.sessionId ?? null,
        status,
        state: snapshot?.state ?? 'unknown',
        ...(snapshot ? { blockedReason: snapshot.blockedReason } : {}),
        ...(snapshot?.turn ? { turnId: snapshot.turn.id } : {}),
      }
    })
    const exited = this.options.until !== 'exited' && targets.some(t => t.status === 'exited')
    const waiting =
      !this.options.throughWaiting &&
      this.options.until !== 'waiting' &&
      targets.some(t => t.status === 'waiting')
    if (!exited && !waiting) {
      return
    }
    const nodes = targets
      .filter(t => t.status === (exited ? 'exited' : 'waiting'))
      .map(t => t.nodeId)
      .join(', ')
    throw new CliError(
      exited ? 'agent.wait_exited' : 'agent.wait_attention',
      exited ? 11 : 10,
      exited
        ? `Agent exited: ${nodes}.`
        : `Waiting observed for ${nodes}; the agent may need the user — inspect before acting.`,
      "Ask the user to resolve it in OpenCove (Desktop or this Worker's Web UI). Inspect with opencove agent read --node <id> --screen using the same connection options, and check the session/turn IDs match. Then run the same wait again; for exact turns reuse the same --turn. Event waits (--until turn-end) cannot resume a completion already observed: prefer --turn.",
      {
        mode: this.options.any ? 'any' : 'all',
        ...(this.options.until ? { until: this.options.until } : {}),
        ...(this.options.turnId ? { turnId: this.options.turnId } : {}),
        targets: exited
          ? targets
          : targets.map(target => ({
              ...target,
              blockedSummary: projection.snapshot(target.nodeId)?.blockedSummary ?? null,
            })),
      },
    )
  }
}
