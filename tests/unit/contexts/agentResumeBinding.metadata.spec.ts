import { describe, expect, it } from 'vitest'
import { resolveObservedResumeSessionBindingUpdate } from '../../../src/contexts/agent/domain/agentResumeBinding'
import {
  updateWorkspacesWithAgentMetadata,
  updateWorkspacesWithAgentRunState,
} from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { applyAgentMetadataToNodes } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'

function createAgentNode({
  resumeSessionId,
  resumeSessionIdVerified,
  launchMode = 'new',
}: {
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
  launchMode?: 'new' | 'resume'
}) {
  return {
    id: 'agent-1',
    type: 'terminal',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      title: 'Agent',
      sessionId: 'runtime-1',
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider: 'claude-code',
        prompt: 'Ship it',
        model: null,
        effectiveModel: null,
        launchMode,
        resumeSessionId,
        resumeSessionIdVerified,
        executionDirectory: '/tmp/workspace',
        expectedDirectory: '/tmp/workspace',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: 'task-1',
      },
      task: null,
      note: null,
    },
  } as never
}

describe('agent resume metadata binding', () => {
  it('applies run-state to a terminal agent overlay without persisting the projection', () => {
    const terminalOverlayNode = {
      ...createAgentNode({ resumeSessionId: null, resumeSessionIdVerified: false }),
      data: {
        ...createAgentNode({ resumeSessionId: null, resumeSessionIdVerified: false }).data,
        kind: 'terminal',
        status: null,
        agent: null,
        terminalAgentBinding: {
          provider: 'claude-code',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
        },
        agentOverlay: {
          provider: 'claude-code',
          status: 'running',
          startedAtMs: 1_723_456_789_000,
        },
      },
    }
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      nodes: [terminalOverlayNode],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    } as never

    const result = updateWorkspacesWithAgentRunState({
      workspaces: [workspace],
      sessionId: 'runtime-1',
      state: 'standby',
    })

    expect(result.didChange).toBe(true)
    expect(result.durableDidChange).toBe(false)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.kind).toBe('terminal')
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agentOverlay?.status).toBe('standby')
  })

  it('keeps authoritative waiting and hook health in runtime-only observation state', () => {
    const node = createAgentNode({ resumeSessionId: null, resumeSessionIdVerified: false })
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      nodes: [node],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    } as never

    const result = updateWorkspacesWithAgentRunState({
      workspaces: [workspace],
      sessionId: 'runtime-1',
      state: 'waiting',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })

    expect(result.durableDidChange).toBe(false)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.status).toBe('running')
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agentRuntimeObservation).toEqual({
      status: 'waiting',
      source: 'claude_hook',
      hookInstallState: 'installed',
      degraded: false,
    })
    const persistedNode = toPersistedState(result.nextWorkspaces, 'workspace-1').workspaces[0]
      ?.nodes[0]
    expect(persistedNode?.status).toBe('running')
    expect(persistedNode).not.toHaveProperty('agentRuntimeObservation')
  })

  it('INV-1 keeps degraded session-file fallback runtime-only', () => {
    const node = createAgentNode({ resumeSessionId: null, resumeSessionIdVerified: false })
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      nodes: [node],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    } as never

    const result = updateWorkspacesWithAgentRunState({
      workspaces: [workspace],
      sessionId: 'runtime-1',
      state: 'standby',
      source: 'session_file',
      hookInstallState: 'error',
      degraded: true,
    })

    expect(result.durableDidChange).toBe(false)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.status).toBe('running')
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agentRuntimeObservation).toEqual({
      status: 'standby',
      source: 'session_file',
      hookInstallState: 'error',
      degraded: true,
    })
    const persistedNode = toPersistedState(result.nextWorkspaces, 'workspace-1').workspaces[0]
      ?.nodes[0]
    expect(persistedNode?.status).toBe('running')
    expect(persistedNode).not.toHaveProperty('agentRuntimeObservation')
  })

  it('ignores runtime metadata that conflicts with a verified durable binding', () => {
    expect(
      resolveObservedResumeSessionBindingUpdate(
        {
          provider: 'claude-code',
          resumeSessionId: 'durable-session',
          resumeSessionIdVerified: true,
        },
        'unrelated-session',
      ),
    ).toBeNull()

    const prevNodes = [
      createAgentNode({
        launchMode: 'resume',
        resumeSessionId: 'durable-session',
        resumeSessionIdVerified: true,
      }),
    ]
    const result = applyAgentMetadataToNodes(prevNodes, {
      sessionId: 'runtime-1',
      resumeSessionId: 'unrelated-session',
    })

    expect(result.didChange).toBe(false)
    expect(result.nextNodes).toBe(prevNodes)
  })

  it('promotes runtime metadata only when the durable binding is not verified', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      nodes: [
        createAgentNode({
          resumeSessionId: null,
          resumeSessionIdVerified: false,
        }),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    } as never

    const result = updateWorkspacesWithAgentMetadata({
      workspaces: [workspace],
      sessionId: 'runtime-1',
      resumeSessionId: 'observed-session',
    })

    expect(result.didChange).toBe(true)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agent?.resumeSessionId).toBe('observed-session')
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agent?.resumeSessionIdVerified).toBe(true)
  })

  it('promotes a provider-hinted terminal to a verified durable binding', () => {
    const hintedTerminal = {
      ...createAgentNode({ resumeSessionId: null, resumeSessionIdVerified: false }),
      data: {
        ...createAgentNode({ resumeSessionId: null, resumeSessionIdVerified: false }).data,
        kind: 'terminal',
        agent: null,
        terminalProviderHint: 'codex',
        terminalAgentBinding: null,
        agentOverlay: {
          provider: 'codex',
          status: 'running',
          startedAtMs: 1_723_456_789_000,
        },
      },
    }
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      nodes: [hintedTerminal],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    } as never

    const result = updateWorkspacesWithAgentMetadata({
      workspaces: [workspace],
      sessionId: 'runtime-1',
      resumeSessionId: 'captured-terminal-session',
    })

    expect(result.didChange).toBe(true)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding).toEqual({
      provider: 'codex',
      resumeSessionId: 'captured-terminal-session',
      resumeSessionIdVerified: true,
    })
  })
})
