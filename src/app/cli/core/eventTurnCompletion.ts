import type { CommandContext } from './command'
import type { EventRecord } from '../../../shared/contracts/dto/eventStream'

/** Per invocation only. The stream's ready/cursor ordering establishes the baseline. */
export function eachTurnCompletion(ctx: CommandContext) {
  const nodes = ctx.options['until-each-turn'] ? (ctx.options.resolvedEventNodes as string[]) : []
  const completed = new Map<
    string,
    { nodeId: string; sessionId: string; turnId: string; outcome: string }
  >()
  return {
    includes(record: EventRecord) {
      return !nodes.length || !('snapshot' in record) || nodes.includes(record.snapshot.nodeId!)
    },
    observe(record: EventRecord): boolean {
      if (!nodes.length || record.type !== 'agent.turn_completed') {
        return false
      }
      const { nodeId, sessionId, lastEndedTurn, turnOutcome } = record.snapshot
      if (!nodeId || !nodes.includes(nodeId) || completed.has(nodeId)) {
        return false
      }
      const turnId = record.endedTurn!.id
      completed.set(nodeId, {
        nodeId,
        sessionId,
        turnId,
        outcome: lastEndedTurn?.id === turnId ? lastEndedTurn.outcome : (turnOutcome ?? 'unknown'),
      })
      if (completed.size !== nodes.length) {
        return false
      }
      for (const id of nodes) {
        // JSON lines on stderr preserve the stdout event protocol and are safe to parse.
        ctx.io.stderr.write(
          JSON.stringify({ type: 'events.turn_summary', ...completed.get(id)! }) + '\n',
        )
      }
      return true
    },
  }
}
