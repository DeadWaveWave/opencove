import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState, WorkspaceState } from '../../types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE } from '../../types'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import {
  normalizeOptionalString,
  normalizePullRequestBaseBranchOptions,
  normalizeWorkspaceSpaceNodeIds,
  normalizeWorkspaceSpaceRect,
  normalizeWorkspaceViewport,
} from './normalize'
import { normalizeLabelColor, normalizeNodeLabelColorOverride } from '@shared/types/labelColor'

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
      pullRequestBaseBranchOptions: normalizePullRequestBaseBranchOptions(
        workspace.pullRequestBaseBranchOptions,
      ),
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
        targetMountId: normalizeOptionalString(space.targetMountId),
        labelColor: normalizeLabelColor(space.labelColor),
        nodeIds: normalizeWorkspaceSpaceNodeIds(space.nodeIds),
        rect: normalizeWorkspaceSpaceRect(space.rect),
      })),
      activeSpaceId:
        workspace.activeSpaceId &&
        workspace.spaces.some(space => space.id === workspace.activeSpaceId)
          ? workspace.activeSpaceId
          : null,
      spaceArchiveRecords: Array.isArray(workspace.spaceArchiveRecords)
        ? workspace.spaceArchiveRecords.slice(0, 50)
        : [],
      nodes: workspace.nodes.map(node => {
        const sessionId = normalizeOptionalString(node.data.sessionId)

        return {
          id: node.id,
          ...(sessionId ? { sessionId } : {}),
          title: node.data.title,
          titlePinnedByUser: node.data.titlePinnedByUser === true,
          position: node.position,
          width: node.data.width,
          height: node.data.height,
          kind: node.data.kind,
          profileId: normalizeOptionalString(node.data.profileId),
          runtimeKind: node.data.runtimeKind,
          labelColorOverride: normalizeNodeLabelColorOverride(node.data.labelColorOverride),
          status: node.data.status,
          startedAt: node.data.startedAt,
          endedAt: node.data.endedAt,
          exitCode: node.data.exitCode,
          lastError: node.data.lastError,
          scrollback: null,
          executionDirectory: normalizeOptionalString(node.data.executionDirectory),
          expectedDirectory: normalizeOptionalString(node.data.expectedDirectory),
          terminalProviderHint: node.data.terminalProviderHint ?? null,
          agent: node.data.agent,
          task:
            node.data.kind === 'note'
              ? node.data.note
              : node.data.kind === 'image'
                ? node.data.image
                : node.data.kind === 'document'
                  ? node.data.document
                  : node.data.kind === 'website'
                    ? node.data.website
                    : node.data.task,
        }
      }),
    })),
    settings,
  }
}
