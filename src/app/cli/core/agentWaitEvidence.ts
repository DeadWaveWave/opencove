import * as z from 'zod'
import type { AgentRunEvent, AgentRunSnapshot } from '../../../shared/contracts/dto/agentRunState'
import {
  archivedSelectedTurn,
  endedSelectedTurn,
  selectedTurnEnd,
  type TurnWaitResult,
} from './agentWaitTurn'
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
/** Local Control Surface lookups answer in milliseconds; past this the identifiers are omitted. */
export const IDENTIFIER_LOOKUP_BUDGET_MS = 1_000
const identifiersSchema = z.object({
  nodeId: z.string().nullable().optional(),
  sessionId: z.string(),
  turnId: z.string(),
  deliveryIds: z.array(z.string()).optional(),
  promptIds: z.array(z.string()).optional(),
})

export class AgentWaitEvidence {
  result: TurnWaitResult | null = null
  private pending: CliError | null = null
  private snapshotResult = false
  private identifiersAttempted = false
  private sawRetainedEnd = false
  private sawCompletion = false
  private readonly reconciliation = new AgentWaitReconciliation()
  constructor(
    private readonly turnId: string,
    private readonly query: (
      id: 'agent.list' | 'agent.finalMessage',
      payload: unknown,
    ) => Promise<unknown>,
    private readonly exactArchive = false,
  ) {}

  retain(snapshot: AgentRunSnapshot, event?: AgentRunEvent): void {
    const end = selectedTurnEnd(snapshot, this.turnId, event)
    if (!this.exactArchive) {
      if (!this.result && end) {
        this.result = end
        this.snapshotResult = true
      }
    } else if (end) {
      const completion =
        event?.type === 'agent.turn_completed' && event.endedTurn?.id === this.turnId
      if (!this.sawRetainedEnd || (completion && !this.sawCompletion)) {
        this.pending = null
      }
      this.sawRetainedEnd = true
      this.sawCompletion ||= completion
    }
  }

  async observe(
    snapshot: AgentRunSnapshot | undefined,
    event?: AgentRunEvent,
    nodeId?: string,
  ): Promise<void> {
    if (snapshot) {
      this.retain(snapshot, event)
    }
    if (this.result) {
      return
    }
    if (snapshot?.turn?.id === this.turnId) {
      this.pending = null
      return
    }
    if (this.pending) {
      return
    }
    try {
      this.result =
        this.exactArchive || !snapshot
          ? await archivedSelectedTurn(nodeId ?? snapshot!.nodeId!, this.turnId, payload =>
              this.query('agent.finalMessage', payload),
            )
          : await endedSelectedTurn(
              snapshot,
              this.turnId,
              payload => this.query('agent.finalMessage', payload),
              event,
            )
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'agent.wait_turn_unavailable') {
        throw error
      }
      if (
        snapshot &&
        (error.details as { reason?: string } | undefined)?.reason === 'remote_history_unavailable'
      ) {
        const retained = selectedTurnEnd(snapshot, this.turnId, event)
        if (retained) {
          this.result = { ...retained, memoryOnlyReason: 'remote' }
          this.snapshotResult = true
          return
        }
      }
      this.pending = error
      this.reconciliation.defer(agentWaitWatermarkSchema.parse(await this.query('agent.list', {})))
    }
  }

  /** Optional correlation never changes completion authority, outcome or durability. */
  async enrichIdentifiers(budgetMs = IDENTIFIER_LOOKUP_BUDGET_MS): Promise<void> {
    const result = this.result
    if (!result || !this.snapshotResult || this.identifiersAttempted) {
      return
    }
    this.identifiersAttempted = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const lookup = this.query('agent.finalMessage', {
      nodeId: result.nodeId,
      turnId: result.turnId,
    }).then(
      value => ({ value }),
      (error: unknown) => {
        // A message-free end still reports its identity and correlations in the error details.
        if (
          error instanceof CliError &&
          error.code === 'agent.final_message_unavailable' &&
          (error.details as { reason?: string } | undefined)?.reason === 'provider_sent_no_message'
        ) {
          return { value: error.details }
        }
        return null
      },
    )
    // A completed wait must not spend its remaining budget on optional metadata. The wait's
    // cleanup aborts a lookup still in flight after this returns.
    const outcome = await Promise.race([
      lookup,
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), budgetMs)
      }),
    ])
    clearTimeout(timer)
    const parsed = identifiersSchema.safeParse(outcome?.value)
    if (!parsed.success) {
      return
    }
    const value = parsed.data
    if (
      value.sessionId === result.sessionId &&
      value.turnId === result.turnId &&
      (value.nodeId === undefined || value.nodeId === result.nodeId)
    ) {
      this.result = {
        ...result,
        ...(value.deliveryIds ? { deliveryIds: value.deliveryIds } : {}),
        ...(value.promptIds ? { promptIds: value.promptIds } : {}),
      }
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
