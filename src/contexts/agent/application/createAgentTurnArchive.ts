import { claudeFinalMessage } from '../../../shared/runtime/agentHook/claudeFinalMessage'
import {
  AGENT_TURN_ARCHIVE_LIMITS as limits,
  type AgentTurnArchive,
  type AgentTurnArchiveInput,
  type ArchivedAgentTurn,
  type AgentTurnArchiveReadResult,
  type ArchiveMembership,
} from './AgentTurnArchive'

export type StoredAgentTurnInput = Omit<ArchivedAgentTurn, 'seq'>
/** Internal storage boundary; exceptions are caught by the public port. */
export interface AgentTurnArchiveStorage {
  append(record: StoredAgentTurnInput): 'persisted' | 'retention_backlog'
  getExact(nodeId: string, turnId: string): ArchivedAgentTurn | undefined
  getExactBySession(sessionId: string, turnId: string): ArchivedAgentTurn | undefined
  revokeNodes(nodeIds: readonly string[]): void
  captureWatermark(): number
  sweep(now: number, existingNodeIds?: ReadonlySet<string>, throughSeq?: number): boolean
  checkpoint(): void
  dispose(): void
}

export function createAgentTurnArchive(
  storage: AgentTurnArchiveStorage | null,
  now: () => number = Date.now,
  membership: ArchiveMembership = () => 'unknown',
): AgentTurnArchive {
  let enabled = storage !== null
  let entered = false
  // UUID node IDs are never reused. Never evict a revocation and allow a late end to resurrect it:
  // exhausting this bounded run-local fence disables all archive access for this Worker run.
  const revoked = new Set<string>()
  const dispose = (): void => {
    enabled = false
    try {
      storage?.dispose()
    } catch {
      /* Optional storage must not interrupt shutdown. */
    }
  }
  const read = (get: () => ArchivedAgentTurn | undefined): AgentTurnArchiveReadResult => {
    if (!enabled || entered) {
      return { status: 'unavailable' }
    }
    entered = true
    try {
      const authority = membership()
      if (authority === 'unknown') {
        return { status: 'unavailable' }
      }
      const record = get()
      return record &&
        membership(record.nodeId) === 'member' &&
        !revoked.has(record.nodeId) &&
        record.archivedAt >= now() - limits.ageMs
        ? { status: 'found', record: { ...record } }
        : { status: 'absent' }
    } catch {
      dispose()
      return { status: 'unavailable' }
    } finally {
      entered = false
    }
  }
  return {
    append(input: AgentTurnArchiveInput) {
      if (input.nodeId && revoked.has(input.nodeId)) {
        return { status: 'memory_only', reason: 'deleted' }
      }
      if (input.remote) {
        return { status: 'memory_only', reason: 'remote' }
      }
      if (!input.nodeId) {
        return { status: 'memory_only', reason: 'unbound' }
      }
      if (!enabled || entered) {
        return { status: 'memory_only', reason: 'unavailable' }
      }
      entered = true
      try {
        const content =
          input.message === null ? null : claudeFinalMessage(input.message, input.truncated)
        if (content === undefined) {
          throw new Error('invalid message')
        }
        // Explicit projection prevents accidental storage of extra private caller fields.
        const status = storage!.append({
          nodeId: input.nodeId,
          turnId: input.turnId,
          sessionId: input.sessionId,
          provider: input.provider,
          providerSessionId: input.providerSessionId,
          promptId: input.promptId,
          outcome: input.outcome,
          endedAt: input.endedAt,
          archivedAt: now(),
          message: content?.message ?? null,
          messageBytes: Buffer.byteLength(content?.message ?? '', 'utf8'),
          truncated: content?.truncated ?? input.truncated,
          superseded: input.superseded,
        })
        return status === 'persisted'
          ? { status }
          : { status: 'memory_only', reason: 'retention_backlog' }
      } catch {
        dispose()
        return { status: 'memory_only', reason: 'write_failed' }
      } finally {
        entered = false
      }
    },
    getExact: input => read(() => storage!.getExact(input.nodeId, input.turnId)),
    getExactBySession: input =>
      read(() => storage!.getExactBySession(input.sessionId, input.turnId)),
    revokeNodes(nodeIds) {
      let overflow = false
      try {
        for (const id of nodeIds) {
          if (revoked.size < limits.revokedNodes) {
            revoked.add(id)
          } else if (!revoked.has(id)) {
            overflow = true
          }
        }
        if (!enabled || entered) {
          dispose()
          return
        }
        entered = true
        // Even an exhausted run-local fence must perform durable deletion first.
        storage!.revokeNodes(nodeIds)
        if (overflow) {
          dispose()
        }
      } catch {
        dispose()
      } finally {
        entered = false
      }
    },
    captureWatermark() {
      if (!enabled || entered) {
        return null
      }
      entered = true
      try {
        return storage!.captureWatermark()
      } catch {
        dispose()
        return null
      } finally {
        entered = false
      }
    },
    sweep(time, existingNodeIds, throughSeq) {
      if (!enabled || entered) {
        return { status: 'unavailable' }
      }
      entered = true
      try {
        return { status: storage!.sweep(time, existingNodeIds, throughSeq) ? 'more' : 'complete' }
      } catch {
        dispose()
        return { status: 'unavailable' }
      } finally {
        entered = false
      }
    },
    checkpoint() {
      if (!enabled || entered) {
        return
      }
      entered = true
      try {
        storage!.checkpoint()
      } catch {
        dispose()
      } finally {
        entered = false
      }
    },
    dispose,
  }
}

export type ArchiveBudgetRow = { seq: number; messageBytes: number }
/** Reads only small candidate sets. Null means no safe eviction plan fits the append budget. */
export function planArchiveEviction(
  totals: { records: number; bytes: number },
  messageBytes: number,
  nodeRows: ArchiveBudgetRow[],
  oldest: ArchiveBudgetRow[],
): number[] | null {
  const victims = new Map<number, number>()
  let records = totals.records + 1
  let bytes = totals.bytes + messageBytes
  const remove = (row: ArchiveBudgetRow) => {
    if (victims.has(row.seq)) {
      return
    }
    victims.set(row.seq, row.messageBytes)
    records--
    bytes -= row.messageBytes
  }
  for (const row of nodeRows.slice(0, Math.max(0, nodeRows.length + 1 - limits.perNode))) {
    remove(row)
  }
  for (const row of oldest) {
    if (records <= limits.records && bytes <= limits.messageBytes) {
      break
    }
    remove(row)
  }
  return records > limits.records ||
    bytes > limits.messageBytes ||
    victims.size > limits.appendEvictions
    ? null
    : [...victims.keys()]
}
