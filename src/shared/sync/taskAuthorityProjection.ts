import type { TaskAuthorityMarker, TaskAuthorityRecord } from '../contracts/taskAuthority'

export const TASK_OWNED_FIELDS = [
  'status',
  'linkedAgentNodeId',
  'claim',
  'claimNote',
  'claimGeneration',
  'lastRunAt',
  'agentSessions',
  'legacyConflict',
] as const

export function taskObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function authorityMarker(value: unknown): TaskAuthorityMarker | null {
  const marker = taskObject(taskObject(value).taskAuthority)
  return typeof marker.generation === 'string' &&
    marker.generation.length > 0 &&
    Number.isSafeInteger(marker.version) &&
    Number(marker.version) > 0 &&
    Number.isSafeInteger(marker.textVersion) &&
    Number(marker.textVersion) > 0
    ? (marker as unknown as TaskAuthorityMarker)
    : null
}

/** Reserved V5 markers cannot be introduced by an ordinary snapshot or import. */
export function stripUnownedTaskFields(value: unknown): unknown {
  const task = taskObject(value)
  const reserved = ['taskAuthority', 'claim', 'claimNote', 'claimGeneration', 'legacyConflict']
  if (!reserved.some(field => Object.hasOwn(task, field))) {
    return value
  }
  return Object.fromEntries(Object.entries(task).filter(([field]) => !reserved.includes(field)))
}

/** Only call with an accepted canonical source; a proposed marker never establishes authority. */
export function projectOwnedTaskFields<T extends { kind?: string; task?: unknown }>(
  canonical: { kind?: string; task?: unknown },
  proposed: T,
): T {
  const marker = authorityMarker(canonical.task)
  if (!marker || !['task', 'note'].includes(canonical.kind ?? '')) {
    const task = stripUnownedTaskFields(proposed.task)
    return task === proposed.task ? proposed : { ...proposed, task }
  }
  const source = taskObject(canonical.task)
  const task = { ...taskObject(proposed.task), taskAuthority: marker }
  if (canonical.kind === 'note') {
    return { ...proposed, kind: canonical.kind, task: { ...task, text: source.text } }
  }
  return {
    ...proposed,
    kind: canonical.kind,
    task: {
      ...task,
      ...Object.fromEntries(TASK_OWNED_FIELDS.map(field => [field, source[field]])),
    },
  }
}

export function projectTaskAuthorityRecord(
  record: TaskAuthorityRecord,
  proposed: unknown,
): Record<string, unknown> {
  const task = {
    ...taskObject(proposed),
    taskAuthority: {
      generation: record.generation,
      version: record.version,
      textVersion: record.textVersion,
    },
  }
  if (record.kind === 'note') {
    return { ...task, text: record.text }
  }
  return { ...task, ...Object.fromEntries(TASK_OWNED_FIELDS.map(field => [field, record[field]])) }
}
