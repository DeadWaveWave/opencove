import {
  AGENT_TURN_ARCHIVE_LIMITS as limits,
  type AgentTurnArchive,
  type ArchivedAgentTurn,
  type ArchiveMembership,
} from '../../../src/contexts/agent/application/AgentTurnArchive'
import {
  createAgentTurnArchive,
  planArchiveEviction,
  type AgentTurnArchiveStorage,
} from '../../../src/contexts/agent/application/createAgentTurnArchive'

/** Native-free test double; callers can inject a durable membership oracle. */
export class InMemoryAgentTurnArchive implements AgentTurnArchive {
  readonly append: AgentTurnArchive['append']
  readonly getExact: AgentTurnArchive['getExact']
  readonly getExactBySession: AgentTurnArchive['getExactBySession']
  readonly clearNode: AgentTurnArchive['clearNode']
  readonly revokeNodes: AgentTurnArchive['revokeNodes']
  readonly captureWatermark: AgentTurnArchive['captureWatermark']
  readonly sweep: AgentTurnArchive['sweep']
  readonly checkpoint: AgentTurnArchive['checkpoint']
  readonly dispose: AgentTurnArchive['dispose']

  constructor(options: { now?: () => number; membership?: ArchiveMembership } = {}) {
    let rows: ArchivedAgentTurn[] = []
    let seq = 0
    let cursor = 0
    let watermark: number | undefined
    let reserveBytes = 0
    let reserveRecords = 0
    const storage: AgentTurnArchiveStorage = {
      append(record) {
        if (rows.some(row => row.nodeId === record.nodeId && row.turnId === record.turnId)) {
          return 'persisted'
        }
        const victims = planArchiveEviction(
          { records: rows.length, bytes: rows.reduce((sum, row) => sum + row.messageBytes, 0) },
          record.messageBytes,
          rows.filter(row => row.nodeId === record.nodeId),
          rows.slice(0, limits.appendEvictions + 1),
        )
        if (victims === null) {
          reserveBytes = Math.max(reserveBytes, record.messageBytes)
          reserveRecords = 1
          return 'retention_backlog'
        }
        const removed = new Set(victims)
        rows = rows.filter(row => !removed.has(row.seq))
        rows.push({ ...record, seq: ++seq })
        return 'persisted'
      },
      getExact: (nodeId, turnId) =>
        rows.find(row => row.nodeId === nodeId && row.turnId === turnId),
      getExactBySession: (sessionId, turnId) =>
        rows.find(row => row.sessionId === sessionId && row.turnId === turnId),
      clearNode: nodeId => {
        const before = rows.length
        rows = rows.filter(row => row.nodeId !== nodeId)
        return before - rows.length
      },
      revokeNodes: nodeIds => {
        const ids = new Set(nodeIds)
        rows = rows.filter(row => !ids.has(row.nodeId))
      },
      captureWatermark: () => seq,
      sweep(now, existing, through = seq) {
        let remaining = limits.sweepBatch as number
        let bytes = rows.reduce((sum, row) => sum + row.messageBytes, 0)
        while (
          remaining &&
          (rows.length > limits.records - reserveRecords ||
            bytes > limits.messageBytes - reserveBytes)
        ) {
          bytes -= rows.shift()!.messageBytes
          remaining--
        }
        if (
          rows.length > limits.records - reserveRecords ||
          bytes > limits.messageBytes - reserveBytes
        ) {
          return true
        }
        reserveBytes = 0
        reserveRecords = 0
        const expired = new Set(
          rows.filter(row => row.archivedAt < now - limits.ageMs).slice(0, remaining),
        )
        rows = rows.filter(row => !expired.has(row))
        remaining -= expired.size
        if (!remaining) {
          return true
        }
        if (!existing) {
          return false
        }
        if (watermark !== through) {
          watermark = through
          cursor = 0
        }
        const batch = rows.filter(row => row.seq > cursor && row.seq <= through).slice(0, remaining)
        const removed = new Set(batch.filter(row => !existing.has(row.nodeId)))
        rows = rows.filter(row => !removed.has(row))
        cursor = batch.at(-1)?.seq ?? 0
        if (batch.length === remaining) {
          return true
        }
        cursor = 0
        watermark = undefined
        return false
      },
      checkpoint: () => {},
      dispose: () => {
        rows = []
      },
    }
    Object.assign(
      this,
      createAgentTurnArchive(storage, options.now, options.membership ?? (() => 'member')),
    )
  }
}
