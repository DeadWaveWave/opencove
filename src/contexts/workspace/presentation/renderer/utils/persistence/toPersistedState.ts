import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState, WorkspaceState } from '../../types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '../../types'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import {
  normalizeOptionalString,
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
    formatVersion: PERSISTED_APP_STATE_FORMAT_VERSION,
    activeWorkspaceId,
    workspaces: workspaces.map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      worktreesRoot: normalizeOptionalString(workspace.worktreesRoot) ?? '',
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
        profileId: normalizeOptionalString(node.data.profileId),
        runtimeKind: node.data.runtimeKind,
        status: node.data.status,
        startedAt: node.data.startedAt,
        endedAt: node.data.endedAt,
        exitCode: node.data.exitCode,
        lastError: node.data.lastError,
        scrollback: null,
        executionDirectory: normalizeOptionalString(node.data.executionDirectory),
        expectedDirectory: normalizeOptionalString(node.data.expectedDirectory),
        agent: node.data.agent,
        task: node.data.kind === 'note' ? node.data.note : node.data.task,
      })),
    })),
    settings,
  }
}
