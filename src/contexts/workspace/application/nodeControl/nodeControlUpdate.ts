import type {
  ManagedCanvasNodeKind,
  UpdateNodeInput,
  UpdateNodeResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveWebsiteNavigationUrl } from '../../../../shared/utils/websiteUrl'
import {
  persistNodeControlState,
  replaceNodeControlWorkspace,
  requireNodeControlState,
  type NodeControlAppStateStore,
  type NodeControlNode,
} from './nodeControlState'
import { findNodeForNodeControl, toCanvasNodeDetail } from './nodeDtos'
import { clampFrameSize, normalizeUpdateNodeData } from './nodeDataFactory'

export async function updateNodeForNodeControl(options: {
  store: NodeControlAppStateStore
  input: UpdateNodeInput
}): Promise<UpdateNodeResult> {
  const state = requireNodeControlState(await options.store.readAppState())
  const matched = findNodeForNodeControl(state.workspaces, options.input.nodeId)
  if (!matched) {
    throw createAppError('node.not_found')
  }
  if (matched.node.kind !== options.input.kind) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.update kind does not match target node.',
    })
  }

  const data = normalizeUpdateNodeData(options.input.kind, options.input.data) as Record<
    string,
    unknown
  >
  const nextNode = updateNode(matched.node, options.input, data)
  const nextWorkspace = {
    ...matched.workspace,
    nodes: matched.workspace.nodes.map(node => (node.id === nextNode.id ? nextNode : node)),
  }
  const revision = await persistNodeControlState(
    options.store,
    replaceNodeControlWorkspace(state, nextWorkspace),
  )

  return {
    revision,
    node: toCanvasNodeDetail({
      node: nextNode,
      workspace: nextWorkspace,
      spaceId: matched.spaceId,
    }),
  }
}

function updateNode(
  node: NodeControlNode,
  input: UpdateNodeInput,
  data: Record<string, unknown>,
): NodeControlNode {
  const nextFrame = input.frame
    ? {
        position: {
          x:
            typeof input.frame.x === 'number' && Number.isFinite(input.frame.x)
              ? input.frame.x
              : node.position.x,
          y:
            typeof input.frame.y === 'number' && Number.isFinite(input.frame.y)
              ? input.frame.y
              : node.position.y,
        },
        size: clampFrameSize({
          kind: node.kind as ManagedCanvasNodeKind,
          width:
            typeof input.frame.width === 'number' && Number.isFinite(input.frame.width)
              ? input.frame.width
              : node.width,
          height:
            typeof input.frame.height === 'number' && Number.isFinite(input.frame.height)
              ? input.frame.height
              : node.height,
        }),
      }
    : null

  const title = typeof input.title === 'string' ? input.title.trim() || node.title : node.title
  const task = updateKindData(node, input.kind, data)
  return {
    ...node,
    title,
    position: nextFrame?.position ?? node.position,
    width: nextFrame?.size.width ?? node.width,
    height: nextFrame?.size.height ?? node.height,
    task,
  }
}

function updateKindData(
  node: NodeControlNode,
  kind: 'note' | 'task' | 'website',
  data: Record<string, unknown>,
): unknown | null {
  const current =
    node.task && typeof node.task === 'object' ? (node.task as Record<string, unknown>) : {}
  if (kind === 'note') {
    return { ...current, ...(typeof data.text === 'string' ? { text: data.text } : {}) }
  }

  if (kind === 'task') {
    return {
      ...current,
      ...(typeof data.requirement === 'string' ? { requirement: data.requirement } : {}),
      ...normalizeTaskPriorityUpdate(data.priority),
      ...normalizeTaskStatusUpdate(data.status),
      ...(Array.isArray(data.tags)
        ? { tags: data.tags.filter((item): item is string => typeof item === 'string') }
        : {}),
      updatedAt: new Date().toISOString(),
    }
  }

  const urlUpdate =
    typeof data.url === 'string' ? { url: normalizeWebsiteUrlForUpdate(data.url) } : {}
  const sessionUpdate = normalizeWebsiteSessionUpdate(data.sessionMode, data.profileId)
  return {
    ...current,
    ...urlUpdate,
    ...(typeof data.pinned === 'boolean' ? { pinned: data.pinned } : {}),
    ...sessionUpdate,
  }
}

function normalizeTaskPriorityUpdate(value: unknown): { priority?: string } {
  if (value === null || value === undefined) {
    return {}
  }
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'urgent') {
    return { priority: value }
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid task priority.' })
}

function normalizeTaskStatusUpdate(value: unknown): { status?: string } {
  if (value === null || value === undefined) {
    return {}
  }
  if (value === 'todo' || value === 'doing' || value === 'ai_done' || value === 'done') {
    return { status: value }
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid task status.' })
}

function normalizeWebsiteUrlForUpdate(value: string): string {
  const resolved = resolveWebsiteNavigationUrl(value)
  if (!resolved.url) {
    throw createAppError('common.invalid_input', {
      debugMessage: resolved.error ?? 'Invalid website URL.',
    })
  }
  return resolved.url
}

function normalizeWebsiteSessionUpdate(
  sessionMode: unknown,
  profileId: unknown,
): { sessionMode?: string; profileId?: string | null } {
  if (sessionMode === null || sessionMode === undefined) {
    return profileId !== undefined
      ? { profileId: typeof profileId === 'string' ? profileId.trim() || null : null }
      : {}
  }
  if (sessionMode !== 'shared' && sessionMode !== 'incognito' && sessionMode !== 'profile') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid website session mode.' })
  }
  const normalizedProfileId = typeof profileId === 'string' ? profileId.trim() || null : null
  return {
    sessionMode: sessionMode === 'profile' && !normalizedProfileId ? 'shared' : sessionMode,
    profileId: sessionMode === 'profile' ? normalizedProfileId : null,
  }
}
