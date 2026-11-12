import type {
  TaskAuthorityCommand,
  TaskAuthorityRecord,
  TaskCommandReceipt,
  TaskPrincipal,
} from '../../../shared/contracts/taskAuthority'
import { taskAuthorityCommandSchema } from '../../../shared/contracts/taskAuthoritySchemas'
import { createAppError } from '../../../shared/errors/appError'
import { canonicalContent } from '../../../shared/sync/mergeValue'
import {
  appendText,
  claimTask,
  isClosedTask,
  releaseTask,
  replaceText,
  textBytes,
  transitionTask,
} from '../domain/taskAuthority'
import type {
  TaskHolderIdentity,
  TaskMutationRepository,
  TaskMutationTransaction,
} from './TaskMutationRepository'

export interface TaskAuthorizationEvidence {
  observedAgent?: { nodeId: string; projectId: string; sessionId: string; degraded: boolean }
}
export type TaskAuthorization = (input: {
  principal: TaskPrincipal
  command: TaskAuthorityCommand
  record: TaskAuthorityRecord
  holder: TaskHolderIdentity | null
  replay: boolean
}) => TaskAuthorizationEvidence | void

export function taskPrincipalKey(principal: TaskPrincipal): string {
  return principal.kind === 'session'
    ? JSON.stringify(['session', principal.projectId, principal.nodeId, principal.sessionId])
    : JSON.stringify([principal.kind, principal.identityId])
}

/** Policy is synchronous; the repository owns the durable linearization point. */
export class TaskMutationOwner {
  constructor(
    private readonly repository: TaskMutationRepository,
    private readonly identifiers: { uuid(): string; now(): string },
  ) {}

  execute(
    principal: TaskPrincipal,
    input: TaskAuthorityCommand,
    authorize: TaskAuthorization,
  ): TaskCommandReceipt {
    const parsed = taskAuthorityCommandSchema.safeParse(input)
    if (!parsed.success) {
      throw createAppError('common.invalid_input')
    }
    const command = parsed.data
    const key = taskPrincipalKey(principal)
    const normalized = canonicalContent(command)
    if (normalized === undefined) {
      throw createAppError('common.invalid_input')
    }
    const fingerprint = this.repository.fingerprint(normalized)
    const result = this.repository.transaction(tx => {
      const receipt = tx.receipt(key, command.operation, command.requestId)
      const record = tx.read(command.nodeId)
      if (!record) {
        throw createAppError('node.not_found')
      }
      const holderId =
        command.operation === 'task.claim' ? command.holderNodeId : record.claim?.holderNodeId
      const holder = holderId ? tx.holder(holderId) : null
      this.authorizePrincipal(tx, principal, record)
      const evidence = authorize({ principal, command, record, holder, replay: !!receipt })
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          throw createAppError('task.request_mismatch')
        }
        return { ...receipt.result, replayed: true }
      }
      if (record.retired) {
        throw createAppError('node.not_found')
      }
      if (record.generation !== command.expectedAuthorityGeneration) {
        throw createAppError('task.stale')
      }
      if ('expectedVersion' in command && command.expectedVersion !== record.version) {
        throw createAppError('task.stale')
      }
      if (
        command.operation.startsWith('task.note.')
          ? record.kind !== 'note'
          : record.kind !== 'task' && command.operation !== 'task.retire'
      ) {
        throw createAppError('common.invalid_input')
      }
      if (
        (command.operation === 'task.claim' || command.operation === 'task.release') &&
        isClosedTask(record)
      ) {
        throw createAppError('task.closed')
      }
      const next = this.apply(tx, principal, command, record, holder, evidence)
      const changed = next !== record
      if (changed) {
        tx.save(next)
      }
      const outcome: TaskCommandReceipt = {
        requestId: command.requestId,
        operation: command.operation,
        nodeId: record.nodeId,
        authorityGeneration: record.generation,
        changed,
        replayed: false,
        revision: changed ? tx.advanceRevision() : tx.revision(),
        version: next.version,
        textVersion: next.textVersion,
        lease: next.claim,
        claimNote: next.claimNote,
        totalBytes: textBytes(next.text),
        ...(command.operation === 'task.note.append'
          ? { appendedBytes: textBytes(next.text) - textBytes(record.text) }
          : {}),
      }
      tx.saveReceipt(key, fingerprint, outcome)
      return outcome
    })
    if (result.changed && !result.replayed) {
      try {
        this.repository.committed(result)
      } catch {
        /* A subscriber cannot roll back durable truth. */
      }
    }
    return result
  }

  private authorizePrincipal(
    tx: TaskMutationTransaction,
    principal: TaskPrincipal,
    record: TaskAuthorityRecord,
  ): void {
    if (principal.kind !== 'session') {
      return
    }
    const caller = tx.holder(principal.nodeId)
    if (
      principal.projectId !== record.projectId ||
      caller?.projectId !== principal.projectId ||
      caller.sessionId !== principal.sessionId
    ) {
      throw createAppError('common.forbidden')
    }
  }

  private apply(
    tx: TaskMutationTransaction,
    principal: TaskPrincipal,
    command: TaskAuthorityCommand,
    record: TaskAuthorityRecord,
    holder: TaskHolderIdentity | null,
    evidence: TaskAuthorizationEvidence | void,
  ): TaskAuthorityRecord {
    switch (command.operation) {
      case 'task.claim': {
        if (principal.kind === 'session' && command.holderNodeId !== principal.nodeId) {
          throw createAppError('common.forbidden')
        }
        if (
          !holder ||
          holder.projectId !== record.projectId ||
          !['agent', 'terminal'].includes(holder.kind) ||
          !holder.sessionId
        ) {
          throw createAppError('common.invalid_input')
        }
        if (holder.kind === 'terminal' && record.claim?.holderNodeId !== holder.nodeId) {
          const observed = evidence?.observedAgent
          if (
            !observed ||
            observed.degraded ||
            observed.nodeId !== holder.nodeId ||
            observed.projectId !== holder.projectId ||
            observed.sessionId !== holder.sessionId
          ) {
            throw createAppError('common.forbidden')
          }
        }
        return claimTask(record, {
          holderNodeId: command.holderNodeId,
          note: command.note,
          leaseId: this.identifiers.uuid(),
          acquiredAt: this.identifiers.now(),
          holderBusy: tx
            .list()
            .some(
              other =>
                !other.retired &&
                other.nodeId !== record.nodeId &&
                (other.claim?.holderNodeId === holder.nodeId ||
                  other.legacyConflict?.holderNodeId === holder.nodeId),
            ),
        })
      }
      case 'task.release':
      case 'task.status':
        if (principal.kind === 'session' && record.claim?.holderNodeId !== principal.nodeId) {
          throw createAppError('common.forbidden')
        }
        return command.operation === 'task.release'
          ? releaseTask(record, command.leaseId)
          : transitionTask(record, command.status, command.leaseId, principal.kind !== 'session')
      case 'task.note.append':
        return appendText(record, command.text)
      case 'task.note.replace':
        return replaceText(record, command.text, command.expectedTextVersion)
      case 'task.conflict.resolve':
        if (principal.kind === 'session') {
          throw createAppError('common.forbidden')
        }
        if (!record.legacyConflict) {
          return record
        }
        return {
          ...record,
          legacyConflict: null,
          linkedAgentNodeId: null,
          status: 'todo',
          version: record.version + 1,
        }
      case 'task.retire':
        if (principal.kind === 'session') {
          throw createAppError('common.forbidden')
        }
        return {
          ...record,
          retired: true,
          claim: null,
          claimNote: null,
          linkedAgentNodeId: null,
          claimGeneration: record.claimGeneration + (record.claim ? 1 : 0),
          version: record.version + 1,
        }
    }
  }
}
