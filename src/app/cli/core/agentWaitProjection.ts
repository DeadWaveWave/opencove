import type { AgentRunEvent, AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import { agentRunSnapshotSchema } from '../../../shared/contracts/dto/agentRunStateSchema'
import { AgentWaitReconciliation } from './agentWaitEvidence'
import { CliError } from './errors'

export type WaitCompletion = {
  nodeId: string
  sessionId: string
  turnId: string
  outcome: NonNullable<AgentRunSnapshot['turnOutcome']>
}
export type WaitSnapshot = AgentRunSnapshot & {
  completion?: WaitCompletion
  endedTurn?: AgentRunEvent['endedTurn']
  endedTurnOutcome?: AgentRunSnapshot['turnOutcome']
}

/** Each node/session binding owns its projection; list ordering never establishes ownership. */
export class AgentWaitProjection {
  readonly reconciliation = new AgentWaitReconciliation()
  private readonly owners = new Map<string, string>()
  private readonly ownerDisplaced = new Set<string>()
  private readonly snapshots = new Map<string, WaitSnapshot>()
  constructor(
    readonly nodeIds: string[],
    private readonly turnId?: string,
    private readonly conflicts = new Map<string, Set<string>>(),
    private readonly onBinding: (nodeId: string, sessionId: string | undefined) => void = () => {},
  ) {}

  snapshot(nodeId: string): WaitSnapshot | undefined {
    return this.owners.has(nodeId) ? this.snapshots.get(nodeId) : undefined
  }
  owner(nodeId: string): string | undefined {
    return this.owners.get(nodeId)
  }

  async initialize(get: (nodeId: string) => Promise<unknown>): Promise<void> {
    for (const nodeId of this.nodeIds) {
      // List omits exited owners and older Workers retain displaced node IDs.
      await this.resolve(nodeId, get)
    }
  }

  async resolve(nodeId: string, get: (nodeId: string) => Promise<unknown>): Promise<void> {
    const value = await get(nodeId)
    if (value === null) {
      this.owners.delete(nodeId)
      this.snapshots.delete(nodeId)
      this.onBinding(nodeId, undefined)
      return
    }
    const snapshot = agentRunSnapshotSchema.parse(value)
    this.selectOwner(nodeId, snapshot)
  }

  /** Missing state targets are errors only after all owners reconcile and attention is checked. */
  assertTargetsPresent(): void {
    if (this.turnId !== undefined) {
      return
    }
    const nodeId = this.nodeIds.find(id => !this.owners.has(id))
    if (nodeId !== undefined) {
      throw new CliError(
        'agent.not_running',
        1,
        `No agent run state for node ${nodeId}.`,
        'Run opencove node get --node <selector> and start or resume its agent session.',
      )
    }
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
        // A loss followed by a quick reclaim is still a new binding interval.
        this.snapshots.delete(nodeId)
        this.onBinding(nodeId, undefined)
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
    this.store(nodeId, event.snapshot, event)
    return true
  }
  private selectOwner(nodeId: string, snapshot: AgentRunSnapshot): void {
    const previous = this.owners.get(nodeId)
    this.owners.set(nodeId, snapshot.sessionId)
    if (previous !== snapshot.sessionId) {
      this.ownerDisplaced.delete(nodeId)
    }
    this.onBinding(nodeId, snapshot.sessionId)
    this.store(nodeId, snapshot)
  }
  private store(nodeId: string, snapshot: AgentRunSnapshot, event?: AgentRunEvent): void {
    const previous = this.snapshots.get(nodeId)
    this.snapshots.set(nodeId, {
      ...snapshot,
      ...(event?.type === 'agent.turn_completed'
        ? { endedTurn: event.endedTurn, endedTurnOutcome: snapshot.turnOutcome }
        : previous?.sessionId === snapshot.sessionId && previous.endedTurn
          ? { endedTurn: previous.endedTurn, endedTurnOutcome: previous.endedTurnOutcome }
          : {}),
    })
  }
}
