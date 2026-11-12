import type { TaskAuthorityRecord } from '../../../shared/contracts/taskAuthority'
import type { PersistedTaskRuntimeStatus } from '../../../shared/contracts/persistedAppState'
import { createAppError } from '../../../shared/errors/appError'

export const MAX_TASK_TEXT_BYTES = 1024 * 1024
export const MAX_CLAIM_NOTE_BYTES = 4096
export const textBytes = (value: string): number => new TextEncoder().encode(value).byteLength
export const isClosedTask = (record: TaskAuthorityRecord): boolean =>
  record.status === 'ai_done' || record.status === 'done'

export function claimTask(
  record: TaskAuthorityRecord,
  input: {
    holderNodeId: string
    leaseId: string
    acquiredAt: string
    note: string | null
    holderBusy: boolean
  },
): TaskAuthorityRecord {
  if (record.kind !== 'task') {
    throw createAppError('common.invalid_input')
  }
  if (isClosedTask(record)) {
    throw createAppError('task.closed')
  }
  if (record.legacyConflict) {
    throw createAppError('task.legacy_conflict')
  }
  if (record.claim) {
    if (record.claim.holderNodeId !== input.holderNodeId) {
      throw createAppError('task.claimed')
    }
    return record
  }
  if (input.holderBusy) {
    throw createAppError('task.holder_busy')
  }
  if (input.note !== null && textBytes(input.note) > MAX_CLAIM_NOTE_BYTES) {
    throw createAppError('common.invalid_input')
  }
  return {
    ...record,
    status: 'doing',
    linkedAgentNodeId: input.holderNodeId,
    claim: {
      holderNodeId: input.holderNodeId,
      leaseId: input.leaseId,
      acquiredAt: input.acquiredAt,
    },
    claimNote: input.note,
    claimGeneration: record.claimGeneration + 1,
    version: record.version + 1,
  }
}

export function releaseTask(record: TaskAuthorityRecord, leaseId: string): TaskAuthorityRecord {
  if (record.kind !== 'task') {
    throw createAppError('common.invalid_input')
  }
  if (isClosedTask(record)) {
    throw createAppError('task.closed')
  }
  if (!record.claim || record.claim.leaseId !== leaseId) {
    throw createAppError('task.stale')
  }
  return {
    ...record,
    status: 'todo',
    claim: null,
    claimNote: null,
    linkedAgentNodeId: null,
    claimGeneration: record.claimGeneration + 1,
    version: record.version + 1,
  }
}

export function transitionTask(
  record: TaskAuthorityRecord,
  status: PersistedTaskRuntimeStatus,
  leaseId: string | null,
  administrative: boolean,
): TaskAuthorityRecord {
  if (record.kind !== 'task') {
    throw createAppError('common.invalid_input')
  }
  if (record.legacyConflict) {
    throw createAppError('task.legacy_conflict')
  }
  if (status === 'doing' || (status === 'todo' && record.claim)) {
    throw createAppError('common.invalid_input')
  }
  if ((status === 'done' || isClosedTask(record)) && !administrative) {
    throw createAppError('common.forbidden')
  }
  if (status === 'ai_done' && (!record.claim || record.claim.leaseId !== leaseId)) {
    throw createAppError('task.stale')
  }
  if (record.claim && record.claim.leaseId !== leaseId) {
    throw createAppError('task.stale')
  }
  if (status === record.status) {
    return record
  }
  return {
    ...record,
    status,
    claim: null,
    claimNote: null,
    linkedAgentNodeId: status === 'todo' ? null : record.linkedAgentNodeId,
    claimGeneration: record.claimGeneration + (record.claim ? 1 : 0),
    version: record.version + 1,
  }
}

function withText(record: TaskAuthorityRecord, text: string): TaskAuthorityRecord {
  if (record.kind !== 'note') {
    throw createAppError('common.invalid_input')
  }
  if (text === record.text) {
    return record
  }
  const bytes = textBytes(text)
  if (bytes > MAX_TASK_TEXT_BYTES && bytes > textBytes(record.text)) {
    throw createAppError('task.text_too_large')
  }
  return { ...record, text, textVersion: record.textVersion + 1, version: record.version + 1 }
}

export function appendText(record: TaskAuthorityRecord, input: string): TaskAuthorityRecord {
  return withText(
    record,
    !input
      ? record.text
      : record.text + (record.text && !record.text.endsWith('\n') ? '\n' : '') + input,
  )
}

export function replaceText(
  record: TaskAuthorityRecord,
  text: string,
  expectedTextVersion: number,
): TaskAuthorityRecord {
  if (expectedTextVersion !== record.textVersion) {
    throw createAppError('task.text_stale', {
      details: { currentTextVersion: record.textVersion, authorityGeneration: record.generation },
    })
  }
  return withText(record, text)
}
