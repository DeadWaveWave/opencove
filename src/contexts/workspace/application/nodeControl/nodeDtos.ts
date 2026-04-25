import type {
  CanvasNodeDetailDataDto,
  CanvasNodeDetailDto,
  CanvasNodeSummaryDto,
  ManagedCanvasNodeKind,
  NodeTaskPriority,
  NodeTaskStatus,
} from '../../../../shared/contracts/dto'
import type { NodeControlNode, NodeControlWorkspace } from './nodeControlState'

export const MANAGED_NODE_KINDS: ManagedCanvasNodeKind[] = [
  'note',
  'task',
  'website',
  'agent',
  'terminal',
]

export function isManagedNodeKind(value: unknown): value is ManagedCanvasNodeKind {
  return (
    value === 'note' ||
    value === 'task' ||
    value === 'website' ||
    value === 'agent' ||
    value === 'terminal'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
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

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeTaskPriority(value: unknown): NodeTaskPriority {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent'
    ? value
    : 'medium'
}

function normalizeTaskStatus(value: unknown): NodeTaskStatus {
  return value === 'todo' || value === 'doing' || value === 'ai_done' || value === 'done'
    ? value
    : 'todo'
}

function resolveNodeSpaceId(workspace: NodeControlWorkspace, nodeId: string): string | null {
  return workspace.spaces.find(space => space.nodeIds.includes(nodeId))?.id ?? null
}

function toNodeSummaryBase(options: {
  node: NodeControlNode
  workspace: NodeControlWorkspace
  spaceId?: string | null
}): CanvasNodeSummaryDto {
  const spaceId = options.spaceId ?? resolveNodeSpaceId(options.workspace, options.node.id)
  return {
    id: options.node.id,
    kind: isManagedNodeKind(options.node.kind) ? options.node.kind : 'terminal',
    title: options.node.title,
    projectId: options.workspace.id,
    spaceId,
    frame: {
      x: options.node.position.x,
      y: options.node.position.y,
      width: options.node.width,
      height: options.node.height,
    },
    ...(options.node.status !== null ? { status: options.node.status } : {}),
    ...(options.node.sessionId !== null ? { sessionId: options.node.sessionId } : {}),
  }
}

function toNodeData(node: NodeControlNode): CanvasNodeDetailDataDto {
  if (node.kind === 'note') {
    const note = isRecord(node.task) ? node.task : {}
    return {
      kind: 'note',
      text: normalizeString(note.text),
    }
  }

  if (node.kind === 'task') {
    const task = isRecord(node.task) ? node.task : {}
    return {
      kind: 'task',
      requirement: normalizeString(task.requirement),
      status: normalizeTaskStatus(task.status),
      priority: normalizeTaskPriority(task.priority),
      tags: normalizeStringArray(task.tags),
      linkedAgentNodeId: normalizeOptionalString(task.linkedAgentNodeId),
    }
  }

  if (node.kind === 'website') {
    const website = isRecord(node.task) ? node.task : {}
    const sessionMode =
      website.sessionMode === 'incognito' || website.sessionMode === 'profile'
        ? website.sessionMode
        : 'shared'
    const profileId = sessionMode === 'profile' ? normalizeOptionalString(website.profileId) : null
    return {
      kind: 'website',
      url: normalizeString(website.url),
      pinned: website.pinned === true,
      sessionMode: profileId ? sessionMode : sessionMode === 'profile' ? 'shared' : sessionMode,
      profileId,
    }
  }

  if (node.kind === 'agent') {
    const agent = isRecord(node.agent) ? node.agent : {}
    return {
      kind: 'agent',
      provider: normalizeOptionalString(agent.provider),
      prompt: normalizeString(agent.prompt),
      model: normalizeOptionalString(agent.model),
      effectiveModel: normalizeOptionalString(agent.effectiveModel),
      executionDirectory: normalizeOptionalString(
        agent.executionDirectory ?? node.executionDirectory,
      ),
      expectedDirectory: normalizeOptionalString(agent.expectedDirectory ?? node.expectedDirectory),
      taskId: normalizeOptionalString(agent.taskId),
    }
  }

  return {
    kind: 'terminal',
    profileId: normalizeOptionalString(node.profileId),
    runtimeKind:
      node.runtimeKind === 'posix' || node.runtimeKind === 'windows' || node.runtimeKind === 'wsl'
        ? node.runtimeKind
        : null,
    executionDirectory: normalizeOptionalString(node.executionDirectory),
    expectedDirectory: normalizeOptionalString(node.expectedDirectory),
  }
}

export function toCanvasNodeSummary(options: {
  node: NodeControlNode
  workspace: NodeControlWorkspace
  spaceId?: string | null
}): CanvasNodeSummaryDto {
  return toNodeSummaryBase(options)
}

export function toCanvasNodeDetail(options: {
  node: NodeControlNode
  workspace: NodeControlWorkspace
  spaceId?: string | null
}): CanvasNodeDetailDto {
  return {
    ...toNodeSummaryBase(options),
    data: toNodeData(options.node),
  }
}

export function findNodeForNodeControl(
  workspaces: NodeControlWorkspace[],
  nodeId: string,
): {
  workspace: NodeControlWorkspace
  node: NodeControlNode
  spaceId: string | null
} | null {
  for (const workspace of workspaces) {
    const node = workspace.nodes.find(candidate => candidate.id === nodeId) ?? null
    if (!node || !isManagedNodeKind(node.kind)) {
      continue
    }

    return {
      workspace,
      node,
      spaceId: resolveNodeSpaceId(workspace, node.id),
    }
  }

  return null
}
