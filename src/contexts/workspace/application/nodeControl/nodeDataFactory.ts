import { randomUUID } from 'node:crypto'
import type {
  AgentProviderId,
  CanvasNodeFrameDto,
  ManagedCanvasNodeKind,
  NodeTaskPriority,
  NodeTaskStatus,
  WebsiteWindowSessionMode,
} from '../../../../shared/contracts/dto'
import { resolveWebsiteNavigationUrl } from '../../../../shared/utils/websiteUrl'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveInitialAgentRuntimeStatus } from '../../../agent/domain/agentRuntimeStatus'
import {
  resolveCanonicalNodeMaxSize,
  resolveCanonicalNodeMinSize,
} from '../../domain/workspaceNodeSizing'
import type { NodeControlNode } from './nodeControlState'

export type NodeControlCreateData =
  | { kind: 'note'; text: string }
  | {
      kind: 'task'
      requirement: string
      priority: NodeTaskPriority
      tags: string[]
      status: NodeTaskStatus
    }
  | {
      kind: 'website'
      url: string
      pinned: boolean
      sessionMode: WebsiteWindowSessionMode
      profileId: string | null
    }
  | { kind: 'agent'; prompt: string; provider: AgentProviderId | null; model: string | null }
  | { kind: 'terminal'; shell: string | null; command: string | null; profileId: string | null }

export interface AgentNodeRuntimeData {
  sessionId: string
  provider: AgentProviderId
  prompt: string
  model: string | null
  effectiveModel: string | null
  executionDirectory: string
  expectedDirectory: string | null
  startedAt: string
  profileId?: string | null
  runtimeKind?: string | null
}

export interface TerminalNodeRuntimeData {
  sessionId: string
  executionDirectory: string
  expectedDirectory: string | null
  startedAt: string
  profileId?: string | null
  runtimeKind?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(value.map(normalizeOptionalString).filter(Boolean) as string[])].slice(0, 50)
}

function normalizeTaskPriority(value: unknown): NodeTaskPriority {
  if (value === null || value === undefined) {
    return 'medium'
  }
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'urgent') {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid task priority.' })
}

function normalizeTaskStatus(value: unknown): NodeTaskStatus {
  if (value === null || value === undefined) {
    return 'todo'
  }
  if (value === 'todo' || value === 'doing' || value === 'ai_done' || value === 'done') {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid task status.' })
}

function normalizeSessionMode(value: unknown): WebsiteWindowSessionMode {
  if (value === null || value === undefined) {
    return 'shared'
  }
  if (value === 'shared' || value === 'incognito' || value === 'profile') {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid website session mode.' })
}

function normalizeAgentProvider(value: unknown): AgentProviderId | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return null
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (
    normalized === 'claude-code' ||
    normalized === 'codex' ||
    normalized === 'opencode' ||
    normalized === 'gemini'
  ) {
    return normalized
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid agent provider.' })
}

export function normalizeCreateNodeData(
  kind: ManagedCanvasNodeKind,
  data: unknown,
): NodeControlCreateData {
  const record = isRecord(data) ? data : {}

  if (kind === 'note') {
    return { kind, text: typeof record.text === 'string' ? record.text : '' }
  }

  if (kind === 'task') {
    const requirement = normalizeOptionalString(record.requirement)
    if (!requirement) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'node.create task requires data.requirement.',
      })
    }

    return {
      kind,
      requirement,
      priority: normalizeTaskPriority(record.priority),
      tags: normalizeStringArray(record.tags),
      status: normalizeTaskStatus(record.status),
    }
  }

  if (kind === 'website') {
    const rawUrl = normalizeOptionalString(record.url)
    if (!rawUrl) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'node.create website requires data.url.',
      })
    }

    const resolved = resolveWebsiteNavigationUrl(rawUrl)
    if (!resolved.url) {
      throw createAppError('common.invalid_input', {
        debugMessage: resolved.error ?? 'Invalid website URL.',
      })
    }

    const sessionMode = normalizeSessionMode(record.sessionMode)
    const profileId = sessionMode === 'profile' ? normalizeOptionalString(record.profileId) : null

    return {
      kind,
      url: resolved.url,
      pinned: record.pinned === true,
      sessionMode: profileId ? 'profile' : sessionMode === 'profile' ? 'shared' : sessionMode,
      profileId,
    }
  }

  if (kind === 'agent') {
    return {
      kind,
      prompt: typeof record.prompt === 'string' ? record.prompt : '',
      provider: normalizeAgentProvider(record.provider),
      model: normalizeOptionalString(record.model),
    }
  }

  return {
    kind,
    shell: normalizeOptionalString(record.shell),
    command: normalizeOptionalString(record.command),
    profileId: normalizeOptionalString(record.profileId),
  }
}

export function normalizeUpdateNodeData(
  _kind: 'note' | 'task' | 'website',
  data: unknown,
): unknown {
  return isRecord(data) ? data : {}
}

export function resolveNodeTitle(options: {
  kind: ManagedCanvasNodeKind
  title?: string | null
  data: NodeControlCreateData
  agentRuntime?: AgentNodeRuntimeData | null
}): string {
  const title = normalizeOptionalString(options.title)
  if (title) {
    return title
  }

  if (options.kind === 'task' && options.data.kind === 'task') {
    return options.data.requirement.slice(0, 80) || 'Task'
  }

  if (options.kind === 'website' && options.data.kind === 'website') {
    return options.data.url
  }

  if (options.kind === 'agent') {
    const provider = options.agentRuntime?.provider ?? 'codex'
    const model = options.agentRuntime?.effectiveModel ?? options.agentRuntime?.model ?? null
    return model ? `${provider} ${model}` : 'Agent'
  }

  if (options.kind === 'terminal') {
    return 'Terminal'
  }

  return 'Note'
}

export function clampFrameSize(options: {
  kind: ManagedCanvasNodeKind
  width: number
  height: number
}): { width: number; height: number } {
  const min = resolveCanonicalNodeMinSize(options.kind)
  const max = resolveCanonicalNodeMaxSize(options.kind)
  return {
    width: Math.max(min.width, Math.min(max.width, options.width)),
    height: Math.max(min.height, Math.min(max.height, options.height)),
  }
}

export function resolveCreateFrame(options: {
  kind: ManagedCanvasNodeKind
  size: { width: number; height: number }
  placement: { x: number; y: number }
  frame?: Partial<CanvasNodeFrameDto> | null
}): CanvasNodeFrameDto {
  const frame = options.frame ?? null
  const explicitWidth =
    typeof frame?.width === 'number' && Number.isFinite(frame.width) ? frame.width : null
  const explicitHeight =
    typeof frame?.height === 'number' && Number.isFinite(frame.height) ? frame.height : null
  const size = clampFrameSize({
    kind: options.kind,
    width: explicitWidth ?? options.size.width,
    height: explicitHeight ?? options.size.height,
  })

  return {
    x: typeof frame?.x === 'number' && Number.isFinite(frame.x) ? frame.x : options.placement.x,
    y: typeof frame?.y === 'number' && Number.isFinite(frame.y) ? frame.y : options.placement.y,
    width: size.width,
    height: size.height,
  }
}

export function makeNode(options: {
  kind: ManagedCanvasNodeKind
  title: string
  frame: CanvasNodeFrameDto
  data: NodeControlCreateData
  now: string
  agentRuntime?: AgentNodeRuntimeData | null
  terminalRuntime?: TerminalNodeRuntimeData | null
}): NodeControlNode {
  const runtime = options.agentRuntime ?? options.terminalRuntime ?? null
  const kindData =
    options.data.kind === 'note'
      ? { text: options.data.text }
      : options.data.kind === 'task'
        ? {
            requirement: options.data.requirement,
            status: options.data.status,
            priority: options.data.priority,
            tags: options.data.tags,
            linkedAgentNodeId: null,
            agentSessions: [],
            lastRunAt: null,
            autoGeneratedTitle: !options.title.trim(),
            createdAt: options.now,
            updatedAt: options.now,
          }
        : options.data.kind === 'website'
          ? {
              url: options.data.url,
              pinned: options.data.pinned,
              sessionMode: options.data.sessionMode,
              profileId: options.data.profileId,
            }
          : null

  const agent =
    options.agentRuntime && options.data.kind === 'agent'
      ? {
          provider: options.agentRuntime.provider,
          prompt: options.agentRuntime.prompt,
          model: options.agentRuntime.model,
          effectiveModel: options.agentRuntime.effectiveModel,
          launchMode: 'new',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
          executionDirectory: options.agentRuntime.executionDirectory,
          expectedDirectory:
            options.agentRuntime.expectedDirectory ?? options.agentRuntime.executionDirectory,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        }
      : null

  return {
    id: randomUUID(),
    sessionId: runtime?.sessionId ?? null,
    title: options.title,
    titlePinnedByUser: false,
    position: { x: options.frame.x, y: options.frame.y },
    width: options.frame.width,
    height: options.frame.height,
    kind: options.kind,
    profileId: runtime?.profileId ?? null,
    runtimeKind: runtime?.runtimeKind ?? null,
    terminalProviderHint: null,
    labelColorOverride: null,
    status:
      options.agentRuntime && options.data.kind === 'agent'
        ? resolveInitialAgentRuntimeStatus(options.agentRuntime.prompt)
        : null,
    startedAt: runtime?.startedAt ?? (options.kind === 'note' ? options.now : null),
    endedAt: null,
    exitCode: null,
    lastError: null,
    executionDirectory:
      options.terminalRuntime?.executionDirectory ??
      options.agentRuntime?.executionDirectory ??
      null,
    expectedDirectory:
      options.terminalRuntime?.expectedDirectory ?? options.agentRuntime?.expectedDirectory ?? null,
    agent,
    task: kindData,
    scrollback: null,
  }
}
