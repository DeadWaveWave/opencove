import * as z from 'zod'
import type { AgentRunEvent, AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import { endedSelectedTurn, selectedTurnEnd, type TurnWaitResult } from './agentWaitTurn'
import { CliError } from './errors'

export const agentWaitWatermarkSchema = z.object({
  epoch: z.string().min(1),
  seq: z.number().int().nonnegative().safe(),
})
export type AgentWaitCursor = z.infer<typeof agentWaitWatermarkSchema>

/** Shared cursor barrier for provisional snapshot reads and negative history evidence. */
export class AgentWaitReconciliation {
  private watermark: AgentWaitCursor | null = null
  defer(watermark: AgentWaitCursor): void {
    if (
      !this.watermark ||
      this.watermark.epoch !== watermark.epoch ||
      watermark.seq > this.watermark.seq
    ) {
      this.watermark = watermark
    }
  }
  status(cursor: AgentWaitCursor): 'pending' | 'ready' | 'resync' {
    if (!this.watermark) {
      return 'ready'
    }
    if (cursor.epoch !== this.watermark.epoch) {
      return 'resync'
    }
    return cursor.seq >= this.watermark.seq ? 'ready' : 'pending'
  }
}

/** A negative history read cannot outrank end evidence still queued on the ordered stream. */
export class AgentWaitEvidence {
  result: TurnWaitResult | null = null
  private pending: CliError | null = null
  private readonly reconciliation = new AgentWaitReconciliation()
  constructor(
    private readonly turnId: string,
    private readonly query: (
      id: 'agent.list' | 'agent.finalMessage',
      payload: unknown,
    ) => Promise<unknown>,
  ) {}

  retain(snapshot: AgentRunSnapshot, event?: AgentRunEvent): void {
    this.result ??= selectedTurnEnd(snapshot, this.turnId, event)
  }

  async observe(snapshot: AgentRunSnapshot, event?: AgentRunEvent): Promise<void> {
    this.retain(snapshot, event)
    if (this.result) {
      return
    }
    if (snapshot.turn?.id === this.turnId) {
      this.pending = null
      return
    }
    if (this.pending) {
      return
    }
    try {
      this.result = await endedSelectedTurn(
        snapshot,
        this.turnId,
        payload => this.query('agent.finalMessage', payload),
        event,
      )
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'agent.wait_turn_unavailable') {
        throw error
      }
      this.pending = error
      this.reconciliation.defer(agentWaitWatermarkSchema.parse(await this.query('agent.list', {})))
    }
  }

  /** True requests a new baseline. All global events advance this reconciliation cursor. */
  reconcile(cursor: AgentWaitCursor): boolean {
    if (this.result || !this.pending) {
      return false
    }
    const status = this.reconciliation.status(cursor)
    if (status === 'resync') {
      return true
    }
    if (status === 'ready') {
      throw this.pending
    }
    return false
  }
}
