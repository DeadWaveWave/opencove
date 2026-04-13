import type {
  AgentNodeData,
  DocumentNodeData,
  ImageNodeData,
  NoteNodeData,
  PersistedTerminalNode,
  PersistedWorkspaceState,
  SpaceArchiveRecord,
  TaskAgentSessionRecord,
  TaskNodeData,
  WebsiteNodeData,
} from '../../types'
import type { WorkspaceSpaceState } from '../../types'
import type {
  CanvasImageMimeType,
  TerminalRuntimeKind,
  WebsiteWindowSessionMode,
} from '@shared/contracts/dto'
import { CANVAS_IMAGE_MIME_TYPES } from '@shared/contracts/dto'
import { normalizeLabelColor, normalizeNodeLabelColorOverride } from '@shared/types/labelColor'
import { normalizeResumeSessionBinding } from './ensureResumeSessionBinding'
import { ensurePersistedSpaceArchiveRecord } from './ensureSpaceArchiveRecord'
import {
  normalizeAgentRuntimeStatus,
  normalizeDirectoryMode,
  normalizeLaunchMode,
  normalizeNodeKind,
  normalizeOptionalString,
  normalizePullRequestBaseBranchOptions,
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

const MAX_SPACE_ARCHIVE_RECORDS = 50

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
    targetMountId: normalizeOptionalString(record.targetMountId),
    labelColor: normalizeLabelColor(record.labelColor),
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

const CANVAS_IMAGE_ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeOptionalCanvasImageDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function ensurePersistedImageData(value: unknown): ImageNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : ''
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim() : ''

  if (assetId.length === 0 || !CANVAS_IMAGE_ASSET_ID_PATTERN.test(assetId)) {
    return null
  }

  if (!CANVAS_IMAGE_MIME_TYPES.includes(mimeType as CanvasImageMimeType)) {
    return null
  }

  const fileName =
    typeof record.fileName === 'string' && record.fileName.trim().length > 0
      ? record.fileName.trim()
      : null

  return {
    assetId,
    mimeType: mimeType as CanvasImageMimeType,
    fileName,
    naturalWidth: normalizeOptionalCanvasImageDimension(record.naturalWidth),
    naturalHeight: normalizeOptionalCanvasImageDimension(record.naturalHeight),
  }
}

function ensurePersistedDocumentData(value: unknown): DocumentNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const uri = typeof record.uri === 'string' ? record.uri.trim() : ''
  if (uri.length === 0) {
    return null
  }

  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') {
      return null
    }
  } catch {
    return null
  }

  return { uri }
}

function ensurePersistedWebsiteData(value: unknown): WebsiteNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  const pinned = typeof record.pinned === 'boolean' ? record.pinned : false
  const normalizedProfileId = normalizeOptionalString(record.profileId)
  const sessionModeInput = typeof record.sessionMode === 'string' ? record.sessionMode.trim() : ''
  const sessionMode: WebsiteWindowSessionMode =
    sessionModeInput === 'incognito' ||
    sessionModeInput === 'profile' ||
    sessionModeInput === 'shared'
      ? (sessionModeInput as WebsiteWindowSessionMode)
      : 'shared'

  const effectiveSessionMode =
    sessionMode === 'profile' && !normalizedProfileId ? 'shared' : sessionMode

  return {
    url,
    pinned,
    sessionMode: effectiveSessionMode,
    profileId: effectiveSessionMode === 'profile' ? normalizedProfileId : null,
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
  const sessionId = normalizeOptionalString(record.sessionId)
  const agent = ensurePersistedAgentData(record.agent)
  const task = ensurePersistedTaskData(record.task)
  const note = ensurePersistedNoteData(record.task)
  const image = ensurePersistedImageData(record.task)
  const document = ensurePersistedDocumentData(record.task)
  const website = ensurePersistedWebsiteData(record.task)
  const runtimeKindInput = record.runtimeKind
  const runtimeKind: TerminalRuntimeKind | undefined =
    runtimeKindInput === 'windows' || runtimeKindInput === 'wsl' || runtimeKindInput === 'posix'
      ? runtimeKindInput
      : undefined

  return {
    id,
    ...(sessionId ? { sessionId } : {}),
    title,
    titlePinnedByUser: record.titlePinnedByUser === true,
    width,
    height,
    kind,
    profileId: normalizeOptionalString(record.profileId),
    runtimeKind,
    terminalProviderHint:
      record.terminalProviderHint === 'claude-code' ||
      record.terminalProviderHint === 'codex' ||
      record.terminalProviderHint === 'opencode' ||
      record.terminalProviderHint === 'gemini'
        ? record.terminalProviderHint
        : null,
    labelColorOverride: normalizeNodeLabelColorOverride(record.labelColorOverride),
    status: normalizeAgentRuntimeStatus(record.status),
    startedAt: normalizeOptionalString(record.startedAt),
    endedAt: normalizeOptionalString(record.endedAt),
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
    lastError: normalizeOptionalString(record.lastError),
    scrollback: normalizeScrollback(record.scrollback),
    executionDirectory: normalizeOptionalString(record.executionDirectory),
    expectedDirectory: normalizeOptionalString(record.expectedDirectory),
    agent: kind === 'agent' ? agent : null,
    task:
      kind === 'task'
        ? task
        : kind === 'note'
          ? note
          : kind === 'image'
            ? image
            : kind === 'document'
              ? document
              : kind === 'website'
                ? (website ?? { url: '', pinned: false, sessionMode: 'shared', profileId: null })
                : null,
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
  const pullRequestBaseBranchOptions = normalizePullRequestBaseBranchOptions(
    record.pullRequestBaseBranchOptions,
  )
  const nodes = record.nodes
  const spaces = record.spaces
  const activeSpaceId = record.activeSpaceId
  const spaceArchiveRecords = record.spaceArchiveRecords

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

  const normalizedSpaceArchiveRecords = Array.isArray(spaceArchiveRecords)
    ? spaceArchiveRecords
        .map(item => ensurePersistedSpaceArchiveRecord(item, path))
        .filter((item): item is SpaceArchiveRecord => item !== null)
        .slice(0, MAX_SPACE_ARCHIVE_RECORDS)
    : []

  return {
    id,
    name,
    path,
    worktreesRoot,
    pullRequestBaseBranchOptions,
    nodes: normalizedNodes,
    viewport: normalizeWorkspaceViewport(record.viewport),
    isMinimapVisible: normalizeWorkspaceMinimapVisible(record.isMinimapVisible),
    spaces: sanitizedSpaces,
    activeSpaceId: resolvedActiveSpaceId,
    spaceArchiveRecords: normalizedSpaceArchiveRecords,
  }
}
