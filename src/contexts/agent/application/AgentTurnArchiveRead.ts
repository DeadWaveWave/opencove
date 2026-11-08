import { createAppError } from '../../../shared/errors/appError'
import type { AgentRunEntry } from './AgentRunStateEntry'
import type { AgentTurnArchive, ArchiveMembership } from './AgentTurnArchive'
import { finalTurnMessage } from './AgentTurnRecord'

export function readExactArchivedTurn(
  input: ({ nodeId: string } | { sessionId: string }) & { turnId: string },
  entries: AgentRunEntry[],
  ports: {
    archive?: AgentTurnArchive
    membership?: ArchiveMembership
    isRemote?: (locator: { nodeId: string } | { sessionId: string }) => boolean
  },
) {
  const unavailable = (reason: string): never => {
    throw createAppError('agent.final_message_unavailable', { details: { reason } })
  }
  if (ports.membership?.() === 'unknown') {
    return unavailable('archive_unavailable')
  }
  const selected = entries.filter(
    entry => !('sessionId' in input) || entry.model.snapshot.sessionId === input.sessionId,
  )
  for (const entry of selected) {
    const record = entry.history.exact(input.turnId, 'nodeId' in input ? input.nodeId : undefined)
    if (record?.persistence.status === 'memory_only' && record.persistence.reason === 'remote') {
      continue
    }
    if (
      record &&
      (record.nodeId === null || !ports.membership || ports.membership(record.nodeId) === 'member')
    ) {
      if (record.persistence.status === 'persisted' && ports.archive) {
        // Enforce archive eviction/global budgets even while a persisted copy is cached.
        try {
          const result = ports.archive.getExact({ nodeId: record.nodeId!, turnId: record.turnId })
          if (result.status === 'absent') {
            continue
          }
        } catch {
          /* Keep a previously committed memory record readable during a storage outage. */
        }
      }
      return finalTurnMessage(record)
    }
  }
  try {
    const result =
      'nodeId' in input ? ports.archive?.getExact(input) : ports.archive?.getExactBySession(input)
    if (result?.status === 'found') {
      return finalTurnMessage({ ...result.record, persistence: { status: 'persisted' } })
    }
    if (
      selected.some(
        entry =>
          entry.model.snapshot.turn?.id === input.turnId &&
          (!('nodeId' in input) ||
            (entry.launchNodeId ?? entry.model.snapshot.nodeId) === input.nodeId),
      )
    ) {
      return unavailable('turn_not_ended')
    }
    if (
      selected.some(
        entry =>
          entry.remote && ('sessionId' in input || entry.model.snapshot.nodeId === input.nodeId),
      )
    ) {
      return unavailable('remote_history_unavailable')
    }
    if (ports.isRemote?.(input)) {
      return unavailable('remote_history_unavailable')
    }
    if (result?.status === 'unavailable') {
      return unavailable('archive_unavailable')
    }
    return unavailable('turn_not_found')
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'agent.final_message_unavailable'
    ) {
      throw error
    }
    return unavailable('archive_unavailable')
  }
}
