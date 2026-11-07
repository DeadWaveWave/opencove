import type { AgentRunEvent, AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import { agentRunSnapshotSchema } from '../../../shared/contracts/dto/agentRunStateSchema'
import { AgentWaitReconciliation } from './agentWaitEvidence'
import { CliError } from './errors'
import { turnUnavailable } from './agentWaitTurn'

export type WaitSnapshot = AgentRunSnapshot & {
  endedTurn?: AgentRunEvent['endedTurn']
  endedTurnOutcome?: AgentRunSnapshot['turnOutcome']
}

/** Session identity is the projection key; list ordering never establishes node ownership. */
export class AgentWaitProjection {
  readonly reconciliation = new AgentWaitReconciliation()
  private readonly owners = new Map<string, string>()
  private readonly ownerDisplaced = new Set<string>()
  private readonly sessions = new Map<string, WaitSnapshot>()
  constructor(
    readonly nodeIds: string[],
    private readonly turnId?: string,
    private readonly conflicts = new Map<string, Set<string>>(),
  ) {}

  snapshot(nodeId: string): WaitSnapshot | undefined {
    const owner = this.owners.get(nodeId)
    return owner === undefined ? undefined : this.sessions.get(owner)
  }
  owner(nodeId: string): string | undefined {
    return this.owners.get(nodeId)
  }

  async initialize(get: (nodeId: string) => Promise<unknown>): Promise<void> {
    for (const nodeId of this.nodeIds) {
      // List omits exited owners and older Workers retain displaced node IDs.
      // eslint-disable-next-line no-await-in-loop
      await this.resolve(nodeId, get)
    }
  }

  async resolve(nodeId: string, get: (nodeId: string) => Promise<unknown>): Promise<void> {
    const value = await get(nodeId)
    if (value === null) {
      this.owners.delete(nodeId)
      if (this.turnId !== undefined) {
        throw turnUnavailable(this.turnId, false, { nodeId })
      }
      throw new CliError(
        'agent.not_running',
        1,
        `No agent run state for node ${nodeId}.`,
        'Run opencove node get --node <selector> and start or resume its agent session.',
      )
    }
    const snapshot = agentRunSnapshotSchema.parse(value)
    this.selectOwner(nodeId, snapshot)
  }

  resolutions(event: AgentRunEvent): string[] {
    return this.nodeIds.filter(nodeId => {
      if (event.snapshot.nodeId !== nodeId) {
        // A move/unbind ends suppression for this session's observed binding interval.
        this.conflicts.get(nodeId)?.delete(event.snapshot.sessionId)
      }
      const owner = this.owners.get(nodeId)
      if (event.snapshot.sessionId === owner) {
        if (event.snapshot.nodeId === nodeId || this.ownerDisplaced.has(nodeId)) {
          return false
        }
        this.ownerDisplaced.add(nodeId)
        return true
      }
      if (event.snapshot.nodeId !== nodeId) {
        return false
      }
      const checked = this.conflicts.get(nodeId) ?? new Set<string>()
      if (checked.has(event.snapshot.sessionId)) {
        return false
      }
      checked.add(event.snapshot.sessionId)
      this.conflicts.set(nodeId, checked)
      return true
    })
  }
  apply(event: AgentRunEvent): boolean {
    const nodeId = event.snapshot.nodeId
    if (nodeId === null || this.owners.get(nodeId) !== event.snapshot.sessionId) {
      return false
    }
    this.ownerDisplaced.delete(nodeId)
    this.store(event.snapshot, event)
    return true
  }
  private selectOwner(nodeId: string, snapshot: AgentRunSnapshot): void {
    const previous = this.owners.get(nodeId)
    this.owners.set(nodeId, snapshot.sessionId)
    if (previous !== snapshot.sessionId) {
      this.ownerDisplaced.delete(nodeId)
    }
    if (
      previous !== undefined &&
      previous !== snapshot.sessionId &&
      ![...this.owners.values()].includes(previous)
    ) {
      this.sessions.delete(previous)
    }
    this.store(snapshot)
  }
  private store(snapshot: AgentRunSnapshot, event?: AgentRunEvent): void {
    const previous = this.sessions.get(snapshot.sessionId)
    this.sessions.set(snapshot.sessionId, {
      ...snapshot,
      ...(event?.type === 'agent.turn_completed'
        ? { endedTurn: event.endedTurn, endedTurnOutcome: snapshot.turnOutcome }
        : previous?.endedTurn
          ? { endedTurn: previous.endedTurn, endedTurnOutcome: previous.endedTurnOutcome }
          : {}),
    })
  }
}
