import { randomUUID } from 'node:crypto'
import type { PluginManifest } from '../../../plugins/domain/pluginTypes'
import type { NodeControlAppState, NodeControlNode, NodeControlWorkspace } from './nodeControlState'
import { resolveWorkspaceNodesPlacement } from '../../domain/workspaceNodePlacement'
import { SPACE_NODE_PADDING } from '../../domain/workspaceSpaceLayout'
import { getCollapsedNodeSize } from '../../domain/collapsedNodeGeometry'

export interface PluginWindowInput {
  pluginId: string
  nodeId?: string
  projectId?: string
  spaceId?: string
  anchor?: { x: number; y: number }
}

export interface PluginWindowSummary {
  nodeId: string
  projectId: string
  spaceId: string | null
  title: string
  titlePinnedByUser: boolean
}

function belongsToPlugin(node: NodeControlNode, pluginId: string): boolean {
  const data = node.task
  return (
    node.kind === 'plugin' &&
    !!data &&
    typeof data === 'object' &&
    'pluginId' in data &&
    data.pluginId === pluginId
  )
}

export function listPluginWindows(
  state: NodeControlAppState,
  pluginId: string,
): PluginWindowSummary[] {
  return state.workspaces.flatMap(workspace =>
    workspace.nodes
      .filter(node => belongsToPlugin(node, pluginId))
      .map(node => ({
        nodeId: node.id,
        projectId: workspace.id,
        spaceId: workspace.spaces.find(space => space.nodeIds.includes(node.id))?.id ?? null,
        title: node.title,
        titlePinnedByUser: node.titlePinnedByUser === true,
      })),
  )
}

/** Durable nodes define instance identity; visible browser frames never define uniqueness. */
export function resolvePluginWindow(
  state: NodeControlAppState,
  plugin: PluginManifest,
  input: PluginWindowInput,
  operation: 'open' | 'command',
): PluginWindowSummary | null {
  if (!plugin.view || !plugin.nodeKinds.length) {
    throw new Error('Plugin has no window.')
  }
  const windows = listPluginWindows(state, plugin.id)
  if (input.nodeId) {
    const target = windows.find(window => window.nodeId === input.nodeId)
    if (!target) {
      throw new Error('The selected node does not belong to this plugin or was closed.')
    }
    if (input.projectId && target.projectId !== input.projectId) {
      throw new Error('The selected plugin node belongs to another project.')
    }
    return target
  }
  if (plugin.view.instances !== 'single') {
    if (operation === 'command') {
      throw new Error(
        'This plugin supports multiple windows. Specify --node; use plugin windows to list them or plugin open to create one.',
      )
    }
    return null
  }
  if (windows.length > 1) {
    throw new Error(
      'More than one saved window exists for this single-window plugin. Select --node explicitly and close unwanted windows; none were deleted.',
    )
  }
  return windows[0] ?? null
}

export function planPluginWindowOpen(
  state: NodeControlAppState,
  plugin: PluginManifest,
  input: PluginWindowInput,
  now: string,
  createId = randomUUID,
): { state: NodeControlAppState; window: PluginWindowSummary; created: boolean } {
  const existing = resolvePluginWindow(state, plugin, input, 'open')
  if (existing) {
    return { state, window: existing, created: false }
  }
  // Active navigation belongs to each UI client, not to the shared Worker state.
  if (!input.projectId) {
    throw new Error('Specify --project to create a new plugin window.')
  }
  const workspace = state.workspaces.find(item => item.id === input.projectId)
  if (!workspace) {
    throw new Error('Choose a project for the new plugin window with --project.')
  }
  const space = input.spaceId ? workspace.spaces.find(item => item.id === input.spaceId) : null
  if (input.spaceId && !space) {
    throw new Error('The target Space does not belong to this project.')
  }
  const view = plugin.view!
  const anchor =
    input.anchor ??
    (space?.rect
      ? { x: space.rect.x + SPACE_NODE_PADDING, y: space.rect.y + SPACE_NODE_PADDING }
      : {
          x: -workspace.viewport.x / workspace.viewport.zoom + 80,
          y: -workspace.viewport.y / workspace.viewport.zoom + 80,
        })
  const collapsed = new Set(workspace.collapsedNodeIds ?? [])
  const placement = resolveWorkspaceNodesPlacement({
    anchor,
    size: view,
    nodes: workspace.nodes.map(node => ({
      id: node.id,
      position: node.position,
      data: collapsed.has(node.id) ? getCollapsedNodeSize() : node,
    })),
    spaceRects: workspace.spaces.flatMap(item => (item.rect ? [item.rect] : [])),
    targetSpaceRect: space?.rect,
  })
  if (!placement.canPlace) {
    throw new Error('Could not find space for the plugin window.')
  }
  const node: NodeControlNode = {
    id: createId(),
    kind: 'plugin',
    sessionId: null,
    title: plugin.displayName,
    titlePinnedByUser: false,
    position: placement.placement,
    width: view.width,
    height: view.height,
    labelColorOverride: null,
    status: null,
    startedAt: now,
    endedAt: null,
    exitCode: null,
    lastError: null,
    agent: null,
    scrollback: null,
    task: {
      pluginId: plugin.id,
      schemaVersion: 1,
      repoPath: space?.directoryPath ?? workspace.path,
      mountId: space?.targetMountId ?? null,
      workspaceId: workspace.id,
    },
  }
  const nextWorkspace = appendWindow(workspace, node, space?.id)
  return {
    state: {
      ...state,
      workspaces: state.workspaces.map(item => (item.id === workspace.id ? nextWorkspace : item)),
    },
    window: {
      nodeId: node.id,
      projectId: workspace.id,
      spaceId: space?.id ?? null,
      title: node.title,
      titlePinnedByUser: node.titlePinnedByUser === true,
    },
    created: true,
  }
}

function appendWindow(
  workspace: NodeControlWorkspace,
  node: NodeControlNode,
  spaceId?: string,
): NodeControlWorkspace {
  const spaces = workspace.spaces.map(space =>
    space.id === spaceId ? { ...space, nodeIds: [...space.nodeIds, node.id] } : space,
  )
  // Growing a child also grows its ancestors; existing positions and ownership stay intact.
  const byId = new Map(spaces.map(space => [space.id, space]))
  let id = spaceId
  const visited = new Set<string>()
  let bounds = { x: node.position.x, y: node.position.y, width: node.width, height: node.height }
  while (id && !visited.has(id)) {
    visited.add(id)
    const space = byId.get(id)
    if (!space) {
      break
    }
    const current = space.rect
    const x = Math.min(current?.x ?? Infinity, bounds.x - SPACE_NODE_PADDING)
    const y = Math.min(current?.y ?? Infinity, bounds.y - SPACE_NODE_PADDING)
    const right = Math.max(
      current ? current.x + current.width : -Infinity,
      bounds.x + bounds.width + SPACE_NODE_PADDING,
    )
    const bottom = Math.max(
      current ? current.y + current.height : -Infinity,
      bounds.y + bounds.height + SPACE_NODE_PADDING,
    )
    bounds = { x, y, width: right - x, height: bottom - y }
    byId.set(id, { ...space, rect: bounds })
    id = space.parentSpaceId ?? undefined
  }
  return {
    ...workspace,
    nodes: [...workspace.nodes, node],
    spaces: spaces.map(space => byId.get(space.id)!),
  }
}
