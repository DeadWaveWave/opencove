import { claudeFinalMessage } from '../../../shared/runtime/agentHook/claudeFinalMessage'
import { createAppError } from '../../../shared/errors/appError'
import type {
  AgentTurnArchive,
  AgentTurnArchiveAppendResult,
  AgentTurnArchiveInput,
  ArchiveMembership,
} from './AgentTurnArchive'

export type RetainedAgentTurn = AgentTurnArchiveInput & {
  archivedAt: number
  persistence: AgentTurnArchiveAppendResult
  promptIds?: string[]
}
export type TurnArchiveContext = {
  archive?: AgentTurnArchive
  membership?: ArchiveMembership
  now: () => number
  nodeId: () => string | null
  remote: () => boolean
}
export function captureTurn(
  input: AgentTurnArchiveInput,
  context: TurnArchiveContext,
): RetainedAgentTurn {
  const content =
    input.message === null ? undefined : claudeFinalMessage(input.message, input.truncated)
  input = {
    ...input,
    message: content?.message ?? null,
    truncated: content?.truncated ?? input.truncated,
  }
  const nodeId = context.nodeId()
  let persistence: AgentTurnArchiveAppendResult
  if (context.remote()) {
    persistence = { status: 'memory_only', reason: 'remote' }
  } else if (nodeId === null || (context.membership && context.membership(nodeId) !== 'member')) {
    persistence = { status: 'memory_only', reason: 'unbound' }
  } else {
    try {
      persistence = context.archive?.append({ ...input, nodeId }) ?? {
        status: 'memory_only',
        reason: 'unavailable',
      }
    } catch {
      persistence = { status: 'memory_only', reason: 'write_failed' }
    }
  }
  return { ...input, nodeId, archivedAt: context.now(), persistence }
}
export function turnDurability(persistence: AgentTurnArchiveAppendResult) {
  return persistence.status === 'persisted'
    ? { persisted: true }
    : { persisted: false, memoryOnlyReason: persistence.reason }
}
export function finalTurnMessage(record: RetainedAgentTurn) {
  const details = {
    nodeId: record.nodeId,
    sessionId: record.sessionId,
    turnId: record.turnId,
    outcome: record.outcome,
    endedAt: record.endedAt,
    ...turnDurability(record.persistence),
  }
  if (record.message === null) {
    throw createAppError('agent.final_message_unavailable', {
      details: { ...details, reason: 'provider_sent_no_message' },
    })
  }
  return {
    ...details,
    ...(record.promptId !== null ? { promptId: record.promptId } : {}),
    message: record.message,
    truncated: record.truncated,
    ...(record.messageKind ? { messageKind: record.messageKind } : {}),
    source: 'hook' as const,
  }
}
