import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  resolveWorkspacesForWorkerSync,
  shouldApplyWorkerSyncRefresh,
} from '../../../src/app/renderer/shell/hooks/useWorkerSyncStateUpdates'

function createWorkspace(id: string, overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    nodes: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    ...overrides,
  }
}

function createAgentNode(id: string, sessionId: string): WorkspaceState['nodes'][number] {
  return {
    id,
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId,
      title: 'codex',
      titlePinnedByUser: false,
      width: 480,
      height: 320,
      kind: 'agent',
      status: 'standby',
      startedAt: '2026-04-30T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: '/tmp/workspace-1',
      expectedDirectory: '/tmp/workspace-1',
      profileId: null,
      runtimeKind: 'posix',
      terminalGeometry: { cols: 80, rows: 24 },
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'resume',
        resumeSessionId: 'resume-session-1',
        resumeSessionIdVerified: true,
        executionDirectory: '/tmp/workspace-1',
        expectedDirectory: '/tmp/workspace-1',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
    draggable: true,
    selectable: false,
  }
}

describe('useWorkerSyncStateUpdates helpers', () => {
  it('skips worker sync refresh when persisted state only echoes the current durable state', () => {
    const workspace = createWorkspace('workspace-1')
    const currentState = {
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      agentSettings: DEFAULT_AGENT_SETTINGS,
    }
    const persistedState = toPersistedState(
      currentState.workspaces,
      currentState.activeWorkspaceId,
      currentState.agentSettings,
    )

    expect(
      shouldApplyWorkerSyncRefresh({
        currentState,
        persistedState,
      }),
    ).toBe(false)
  })

  it('preserves unchanged workspace references when syncing a different workspace', () => {
    const activeWorkspace = createWorkspace('workspace-1')
    const backgroundWorkspace = createWorkspace('workspace-2')
    const currentWorkspaces = [activeWorkspace, backgroundWorkspace]

    const persistedState = toPersistedState(
      [
        activeWorkspace,
        createWorkspace('workspace-2', {
          name: 'workspace-2-updated',
        }),
      ],
      activeWorkspace.id,
      DEFAULT_AGENT_SETTINGS,
    )

    const nextWorkspaces = resolveWorkspacesForWorkerSync({
      currentWorkspaces,
      persistedWorkspaces: persistedState.workspaces,
    })

    expect(nextWorkspaces).not.toBe(currentWorkspaces)
    expect(nextWorkspaces[0]).toBe(activeWorkspace)
    expect(nextWorkspaces[1]).not.toBe(backgroundWorkspace)
    expect(nextWorkspaces[1]?.name).toBe('workspace-2-updated')
  })

  it('applies the worker session id when persisted sync state revives a runtime node', () => {
    const existingNode = createAgentNode('agent-1', 'old-dead-pty-session')
    const revivedPersistedNode = createAgentNode('agent-1', 'live-revived-pty-session')
    const currentWorkspace = createWorkspace('workspace-1', {
      nodes: [existingNode],
    })
    const persistedState = toPersistedState(
      [
        createWorkspace('workspace-1', {
          nodes: [revivedPersistedNode],
        }),
      ],
      currentWorkspace.id,
      DEFAULT_AGENT_SETTINGS,
    )

    const nextWorkspaces = resolveWorkspacesForWorkerSync({
      currentWorkspaces: [currentWorkspace],
      persistedWorkspaces: persistedState.workspaces,
    })

    expect(nextWorkspaces[0]?.nodes[0]?.data.sessionId).toBe('live-revived-pty-session')
  })

  it('keeps the current runtime session id when persisted sync state has no live session', () => {
    const existingNode = createAgentNode('agent-1', 'live-revived-pty-session')
    const persistedNodeWithoutRuntimeSession = createAgentNode('agent-1', '')
    const currentWorkspace = createWorkspace('workspace-1', {
      nodes: [existingNode],
    })
    const persistedState = toPersistedState(
      [
        createWorkspace('workspace-1', {
          nodes: [persistedNodeWithoutRuntimeSession],
        }),
      ],
      currentWorkspace.id,
      DEFAULT_AGENT_SETTINGS,
    )

    const nextWorkspaces = resolveWorkspacesForWorkerSync({
      currentWorkspaces: [currentWorkspace],
      persistedWorkspaces: persistedState.workspaces,
    })

    expect(nextWorkspaces[0]?.nodes[0]?.data.sessionId).toBe('live-revived-pty-session')
  })
})
