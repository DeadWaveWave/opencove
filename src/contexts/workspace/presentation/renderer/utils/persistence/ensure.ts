import type {
  AgentNodeData,
  NoteNodeData,
  PersistedTerminalNode,
  PersistedWorkspaceState,
  TaskAgentSessionRecord,
  TaskNodeData,
} from '../../types'
import type { WorkspaceSpaceState } from '../../types'
import type { AgentProviderId, TerminalRuntimeKind } from '../../../../../../shared/contracts/dto'
import { clearResumeSessionBinding, isResumeSessionBindingVerified } from '../agentResumeBinding'
import {
  normalizeAgentRuntimeStatus,
  normalizeDirectoryMode,
  normalizeLaunchMode,
  normalizeNodeKind,
  normalizeOptionalString,
  normalizeProvider,
  normalizeScrollback,
  normalizeTaskPriority,
  normalizeTaskRuntimeStatus,
  normalizeTaskTags,
  normalizeWorkspaceMinimapVisible,
  normalizeWorkspaceSpaceNodeIds,
  normalizeWorkspaceSpaceRect,
  normalizeWorkspaceViewport,
} from './normalize'

function normalizeResumeSessionBinding(
  provider: AgentProviderId,
  record: Record<string, unknown>,
): {
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
} {
  const resumeSessionId = normalizeOptionalString(record.resumeSessionId)
  const resumeSessionIdVerifiedInput =
    typeof record.resumeSessionIdVerified === 'boolean' ? record.resumeSessionIdVerified : undefined

  if (
    !isResumeSessionBindingVerified({
      provider,
      resumeSessionId,
      resumeSessionIdVerified: resumeSessionIdVerifiedInput,
    })
  ) {
    return clearResumeSessionBinding()
  }

  return {
    resumeSessionId,
    resumeSessionIdVerified: true,
  }
}

function ensurePersistedTaskAgentSessionRecords(value: unknown): TaskAgentSessionRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  const records: TaskAgentSessionRecord[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const id = normalizeOptionalString(record.id)
    const provider = normalizeProvider(record.provider)
    const prompt = normalizeOptionalString(record.prompt)
    const boundDirectory = normalizeOptionalString(record.boundDirectory)
    const createdAt = normalizeOptionalString(record.createdAt)
    const lastRunAt = normalizeOptionalString(record.lastRunAt)

    if (!id || !provider || !prompt || !boundDirectory || !createdAt || !lastRunAt) {
      continue
    }

    const status = normalizeAgentRuntimeStatus(record.status) ?? 'exited'
    const resumeBinding = normalizeResumeSessionBinding(provider, record)

    records.push({
      id,
      provider,
      ...resumeBinding,
      prompt,
      model: normalizeOptionalString(record.model),
      effectiveModel: normalizeOptionalString(record.effectiveModel),
      boundDirectory,
      lastDirectory: normalizeOptionalString(record.lastDirectory) ?? boundDirectory,
      createdAt,
      lastRunAt,
      endedAt: normalizeOptionalString(record.endedAt),
      exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
      status,
    })

    if (records.length >= 50) {
      break
    }
  }

  return records
}

function ensurePersistedWorkspaceSpace(
  value: unknown,
  workspacePath: string,
): WorkspaceSpaceState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const id = record.id
  const name = record.name

  if (typeof id !== 'string' || typeof name !== 'string') {
    return null
  }

  const normalizedDirectoryPath = normalizeOptionalString(record.directoryPath) ?? workspacePath

  return {
    id,
    name,
    directoryPath: normalizedDirectoryPath,
    nodeIds: normalizeWorkspaceSpaceNodeIds(record.nodeIds),
    rect: normalizeWorkspaceSpaceRect(record.rect),
  }
}

function ensurePersistedAgentData(value: unknown): AgentNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const provider = normalizeProvider(record.provider)
  const prompt = typeof record.prompt === 'string' ? record.prompt : ''
  const executionDirectory = normalizeOptionalString(record.executionDirectory)

  if (!provider || !executionDirectory) {
    return null
  }

  const resumeBinding = normalizeResumeSessionBinding(provider, record)

  return {
    provider,
    prompt,
    model: normalizeOptionalString(record.model),
    effectiveModel: normalizeOptionalString(record.effectiveModel),
    launchMode: normalizeLaunchMode(record.launchMode),
    ...resumeBinding,
    executionDirectory,
    expectedDirectory: normalizeOptionalString(record.expectedDirectory) ?? executionDirectory,
    directoryMode: normalizeDirectoryMode(record.directoryMode),
    customDirectory: normalizeOptionalString(record.customDirectory),
    shouldCreateDirectory:
      typeof record.shouldCreateDirectory === 'boolean' ? record.shouldCreateDirectory : false,
    taskId: normalizeOptionalString(record.taskId),
  }
}

function ensurePersistedTaskData(value: unknown): TaskNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const requirement = normalizeOptionalString(record.requirement)

  if (!requirement) {
    return null
  }

  return {
    requirement,
    status: normalizeTaskRuntimeStatus(record.status),
    priority: normalizeTaskPriority(record.priority),
    tags: normalizeTaskTags(record.tags),
    linkedAgentNodeId: normalizeOptionalString(record.linkedAgentNodeId),
    agentSessions: ensurePersistedTaskAgentSessionRecords(record.agentSessions),
    lastRunAt: normalizeOptionalString(record.lastRunAt),
    autoGeneratedTitle:
      typeof record.autoGeneratedTitle === 'boolean' ? record.autoGeneratedTitle : false,
    createdAt: normalizeOptionalString(record.createdAt),
    updatedAt: normalizeOptionalString(record.updatedAt),
  }
}

function ensurePersistedNoteData(value: unknown): NoteNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : ''

  return {
    text,
  }
}

function ensurePersistedNode(node: unknown): PersistedTerminalNode | null {
  if (!node || typeof node !== 'object') {
    return null
  }

  const record = node as Record<string, unknown>
  const id = record.id
  const title = record.title
  const width = record.width
  const height = record.height
  const position = record.position

  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !position ||
    typeof position !== 'object'
  ) {
    return null
  }

  const positionRecord = position as Record<string, unknown>
  if (typeof positionRecord.x !== 'number' || typeof positionRecord.y !== 'number') {
    return null
  }

  const kind = normalizeNodeKind(record.kind)
  const agent = ensurePersistedAgentData(record.agent)
  const task = ensurePersistedTaskData(record.task)
  const note = ensurePersistedNoteData(record.task)
  const runtimeKindInput = record.runtimeKind
  const runtimeKind: TerminalRuntimeKind | undefined =
    runtimeKindInput === 'windows' || runtimeKindInput === 'wsl' || runtimeKindInput === 'posix'
      ? runtimeKindInput
      : undefined

  return {
    id,
    title,
    titlePinnedByUser: record.titlePinnedByUser === true,
    width,
    height,
    kind,
    profileId: normalizeOptionalString(record.profileId),
    runtimeKind,
    status: normalizeAgentRuntimeStatus(record.status),
    startedAt: normalizeOptionalString(record.startedAt),
    endedAt: normalizeOptionalString(record.endedAt),
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
    lastError: normalizeOptionalString(record.lastError),
    scrollback: normalizeScrollback(record.scrollback),
    executionDirectory: normalizeOptionalString(record.executionDirectory),
    expectedDirectory: normalizeOptionalString(record.expectedDirectory),
    agent: kind === 'agent' ? agent : null,
    task: kind === 'task' ? task : kind === 'note' ? note : null,
    position: {
      x: positionRecord.x,
      y: positionRecord.y,
    },
  }
}

export function ensurePersistedWorkspace(workspace: unknown): PersistedWorkspaceState | null {
  if (!workspace || typeof workspace !== 'object') {
    return null
  }

  const record = workspace as Record<string, unknown>
  const id = record.id
  const name = record.name
  const path = record.path
  const worktreesRoot = normalizeOptionalString(record.worktreesRoot) ?? ''
  const nodes = record.nodes
  const spaces = record.spaces
  const activeSpaceId = record.activeSpaceId

  if (typeof id !== 'string' || typeof name !== 'string' || typeof path !== 'string') {
    return null
  }

  if (!Array.isArray(nodes)) {
    return null
  }

  const normalizedNodes = nodes
    .map(node => ensurePersistedNode(node))
    .filter((node): node is PersistedTerminalNode => node !== null)

  const normalizedSpaces = Array.isArray(spaces)
    ? spaces
        .map(item => ensurePersistedWorkspaceSpace(item, path))
        .filter((item): item is WorkspaceSpaceState => item !== null)
    : []

  const availableNodeIds = new Set(normalizedNodes.map(node => node.id))
  const sanitizedSpaces = normalizedSpaces.map(space => ({
    ...space,
    nodeIds: space.nodeIds.filter(nodeId => availableNodeIds.has(nodeId)),
  }))
  const normalizedActiveSpaceId = typeof activeSpaceId === 'string' ? activeSpaceId : null
  const resolvedActiveSpaceId =
    normalizedActiveSpaceId && sanitizedSpaces.some(space => space.id === normalizedActiveSpaceId)
      ? normalizedActiveSpaceId
      : null

  return {
    id,
    name,
    path,
    worktreesRoot,
    nodes: normalizedNodes,
    viewport: normalizeWorkspaceViewport(record.viewport),
    isMinimapVisible: normalizeWorkspaceMinimapVisible(record.isMinimapVisible),
    spaces: sanitizedSpaces,
    activeSpaceId: resolvedActiveSpaceId,
  }
}
