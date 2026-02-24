import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../../../settings/agentConfig'
import type { PersistedAppState, WorkspaceState } from '../../types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '../../types'
import {
  normalizeOptionalString,
  normalizeScrollback,
  normalizeWorkspaceSpaceNodeIds,
  normalizeWorkspaceSpaceRect,
  normalizeWorkspaceViewport,
} from './normalize'

export function toPersistedState(
  workspaces: WorkspaceState[],
  activeWorkspaceId: string | null,
  settings: AgentSettings = DEFAULT_AGENT_SETTINGS,
): PersistedAppState {
  return {
    activeWorkspaceId,
    workspaces: workspaces.map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      viewport: normalizeWorkspaceViewport(workspace.viewport),
      isMinimapVisible:
        typeof workspace.isMinimapVisible === 'boolean'
          ? workspace.isMinimapVisible
          : DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
      spaces: workspace.spaces.map(space => ({
        id: space.id,
        name: space.name,
        directoryPath:
          normalizeOptionalString(space.directoryPath) ??
          normalizeOptionalString(workspace.path) ??
          workspace.path,
        nodeIds: normalizeWorkspaceSpaceNodeIds(space.nodeIds),
        rect: normalizeWorkspaceSpaceRect(space.rect),
      })),
      activeSpaceId:
        workspace.activeSpaceId &&
        workspace.spaces.some(space => space.id === workspace.activeSpaceId)
          ? workspace.activeSpaceId
          : null,
      nodes: workspace.nodes.map(node => ({
        id: node.id,
        title: node.data.title,
        titlePinnedByUser: node.data.titlePinnedByUser === true,
        position: node.position,
        width: node.data.width,
        height: node.data.height,
        kind: node.data.kind,
        status: node.data.status,
        startedAt: node.data.startedAt,
        endedAt: node.data.endedAt,
        exitCode: node.data.exitCode,
        lastError: node.data.lastError,
        scrollback: normalizeScrollback(node.data.scrollback),
        agent: node.data.agent,
        task: node.data.task,
      })),
    })),
    settings,
  }
}
