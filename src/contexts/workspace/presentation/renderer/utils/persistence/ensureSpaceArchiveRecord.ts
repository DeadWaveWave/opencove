import type {
  NodeFrame,
  SpaceArchiveGitSnapshot,
  SpaceArchiveNodeSnapshot,
  SpaceArchiveRecord,
} from '../../types'
import type { GitHubPullRequestSummary, TerminalRuntimeKind } from '@shared/contracts/dto'
import { normalizeLabelColor, normalizeNodeLabelColorOverride } from '@shared/types/labelColor'
import { normalizeResumeSessionBinding } from './ensureResumeSessionBinding'
import {
  normalizeAgentRuntimeStatus,
  normalizeDirectoryMode,
  normalizeLaunchMode,
  normalizeOptionalString,
  normalizeProvider,
  normalizeTaskPriority,
  normalizeTaskRuntimeStatus,
  normalizeTaskTags,
  normalizeWorkspaceSpaceRect,
} from './normalize'

function ensureOptionalNodeFrame(value: unknown): NodeFrame | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const position = record.position
  const size = record.size

  if (!position || typeof position !== 'object' || !size || typeof size !== 'object') {
    return null
  }

  const positionRecord = position as Record<string, unknown>
  const sizeRecord = size as Record<string, unknown>

  const x = positionRecord.x
  const y = positionRecord.y
  const width = sizeRecord.width
  const height = sizeRecord.height

  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null
  }

  return {
    position: { x, y },
    size: { width, height },
  }
}

function ensureOptionalGitHubPullRequestSummary(value: unknown): GitHubPullRequestSummary | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const refInput = record.ref

  if (!refInput || typeof refInput !== 'object') {
    return null
  }

  const ref = refInput as Record<string, unknown>
  const kind = normalizeOptionalString(ref.kind)
  const providerId = normalizeOptionalString(ref.providerId)
  const id = normalizeOptionalString(ref.id)

  if (kind !== 'pull_request' || providerId !== 'github' || !id) {
    return null
  }

  const number = typeof record.number === 'number' ? record.number : null
  const title = normalizeOptionalString(record.title)

  if (!number || !title) {
    return null
  }

  const stateRaw = normalizeOptionalString(record.state)
  const state =
    stateRaw === 'open' || stateRaw === 'closed' || stateRaw === 'merged' ? stateRaw : null

  if (!state) {
    return null
  }

  return {
    ref: {
      providerId: 'github',
      kind: 'pull_request',
      id,
      url: normalizeOptionalString(ref.url),
    },
    number,
    title,
    state,
    isDraft: record.isDraft === true,
    authorLogin: normalizeOptionalString(record.authorLogin),
    updatedAt: normalizeOptionalString(record.updatedAt),
    baseRefName: normalizeOptionalString(record.baseRefName),
    headRefName: normalizeOptionalString(record.headRefName),
  }
}

function ensurePersistedSpaceArchiveGitSnapshot(value: unknown): SpaceArchiveGitSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const pullRequestInput = record.pullRequest

  return {
    worktreePath: normalizeOptionalString(record.worktreePath),
    branch: normalizeOptionalString(record.branch),
    head: normalizeOptionalString(record.head),
    pullRequest: ensureOptionalGitHubPullRequestSummary(pullRequestInput),
  }
}

function ensurePersistedSpaceArchiveNodeSnapshot(value: unknown): SpaceArchiveNodeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const kind = normalizeOptionalString(record.kind)
  const id = normalizeOptionalString(record.id)
  const title = typeof record.title === 'string' ? record.title : ''
  const frame = ensureOptionalNodeFrame(record.frame)
  const labelColorOverride = normalizeNodeLabelColorOverride(record.labelColorOverride)

  if (!kind || !id) {
    return null
  }

  if (kind === 'terminal') {
    const runtimeKind: TerminalRuntimeKind | null =
      record.runtimeKind === 'posix' ||
      record.runtimeKind === 'windows' ||
      record.runtimeKind === 'wsl'
        ? record.runtimeKind
        : null

    return {
      kind: 'terminal',
      id,
      title,
      frame,
      labelColorOverride,
      runtimeKind,
      executionDirectory: normalizeOptionalString(record.executionDirectory),
      expectedDirectory: normalizeOptionalString(record.expectedDirectory),
      startedAt: normalizeOptionalString(record.startedAt),
      endedAt: normalizeOptionalString(record.endedAt),
      exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
      lastError: normalizeOptionalString(record.lastError),
    }
  }

  if (kind === 'agent') {
    const provider = normalizeProvider(record.provider)
    const resumeBinding = provider ? normalizeResumeSessionBinding(provider, record) : null

    return {
      kind: 'agent',
      id,
      title,
      frame,
      labelColorOverride,
      status: normalizeAgentRuntimeStatus(record.status),
      provider,
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
      model: normalizeOptionalString(record.model),
      effectiveModel: normalizeOptionalString(record.effectiveModel),
      launchMode: normalizeLaunchMode(record.launchMode),
      resumeSessionId: resumeBinding?.resumeSessionId ?? null,
      ...(resumeBinding ? { resumeSessionIdVerified: resumeBinding.resumeSessionIdVerified } : {}),
      executionDirectory: normalizeOptionalString(record.executionDirectory),
      expectedDirectory: normalizeOptionalString(record.expectedDirectory),
      directoryMode: normalizeDirectoryMode(record.directoryMode),
      customDirectory: normalizeOptionalString(record.customDirectory),
      shouldCreateDirectory:
        typeof record.shouldCreateDirectory === 'boolean' ? record.shouldCreateDirectory : false,
      taskId: normalizeOptionalString(record.taskId),
      startedAt: normalizeOptionalString(record.startedAt),
      endedAt: normalizeOptionalString(record.endedAt),
      exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
      lastError: normalizeOptionalString(record.lastError),
    }
  }

  if (kind === 'task') {
    const requirement = typeof record.requirement === 'string' ? record.requirement : null
    if (requirement === null) {
      return null
    }

    return {
      kind: 'task',
      id,
      title,
      frame,
      labelColorOverride,
      requirement,
      status: normalizeTaskRuntimeStatus(record.status),
      priority: normalizeTaskPriority(record.priority),
      tags: normalizeTaskTags(record.tags),
      linkedAgentNodeId: normalizeOptionalString(record.linkedAgentNodeId),
      lastRunAt: normalizeOptionalString(record.lastRunAt),
      autoGeneratedTitle:
        typeof record.autoGeneratedTitle === 'boolean' ? record.autoGeneratedTitle : false,
      createdAt: normalizeOptionalString(record.createdAt),
      updatedAt: normalizeOptionalString(record.updatedAt),
    }
  }

  if (kind === 'note') {
    const text = typeof record.text === 'string' ? record.text : null
    if (text === null) {
      return null
    }

    return {
      kind: 'note',
      id,
      title,
      frame,
      labelColorOverride,
      text,
    }
  }

  return null
}

export function ensurePersistedSpaceArchiveRecord(
  value: unknown,
  workspacePath: string,
): SpaceArchiveRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const id = normalizeOptionalString(record.id)
  const archivedAt = normalizeOptionalString(record.archivedAt)
  const space = record.space
  const git = ensurePersistedSpaceArchiveGitSnapshot(record.git)

  if (!id || !archivedAt || !space || typeof space !== 'object') {
    return null
  }

  const spaceRecord = space as Record<string, unknown>
  const spaceId = normalizeOptionalString(spaceRecord.id)
  const spaceName = typeof spaceRecord.name === 'string' ? spaceRecord.name : null

  if (!spaceId || spaceName === null) {
    return null
  }

  const directoryPath = normalizeOptionalString(spaceRecord.directoryPath) ?? workspacePath
  const labelColor = normalizeLabelColor(spaceRecord.labelColor)
  const rect = normalizeWorkspaceSpaceRect(spaceRecord.rect)

  const nodesInput = Array.isArray(record.nodes) ? record.nodes : []
  const nodes: SpaceArchiveNodeSnapshot[] = nodesInput
    .map(item => ensurePersistedSpaceArchiveNodeSnapshot(item))
    .filter((item): item is SpaceArchiveNodeSnapshot => item !== null)

  return {
    id,
    archivedAt,
    git,
    space: {
      id: spaceId,
      name: spaceName,
      directoryPath,
      labelColor,
      rect,
    },
    nodes,
  }
}
