import { describe, expect, it } from 'vitest'
import {
  reconcileTerminalAgentActivitySnapshots,
  updateWorkspacesWithTerminalAgentActivityMetadata,
} from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync.terminalAgentActivity'
import { isAgentTreatedNode } from '../../../src/contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

function createWorkspace() {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    nodes: [
      {
        id: 'terminal-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'terminal',
          sessionId: 'pty-1',
          title: 'Terminal',
          width: 520,
          height: 360,
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: 'kept output',
          executionDirectory: '/tmp/workspace',
          expectedDirectory: '/tmp/workspace',
          agent: null,
          terminalProviderHint: null,
          terminalAgentBinding: null,
          agentOverlay: null,
          task: null,
        },
      },
    ],
  } as never
}

function activity(
  phase: 'active' | 'exited',
  generation = 1,
  identityAuthority: 'provider_session_start' | null = null,
) {
  return {
    sessionId: 'pty-1',
    resumeSessionId: identityAuthority ? 'claude-session-1' : null,
    terminalAgentActivity: {
      provider: 'claude-code' as const,
      invocationId: `invocation-${generation}`,
      generation,
      phase,
      observedAtMs: 1_000 + generation,
      identityAuthority,
    },
  }
}

describe('terminal agent authenticated activity projection', () => {
  it('adopts an authenticated active invocation without changing terminal ownership', () => {
    const workspace = createWorkspace()
    const result = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [workspace],
      event: activity('active'),
    })
    const node = result.nextWorkspaces[0]?.nodes[0]

    expect(result).toMatchObject({ didChange: true, durableDidChange: false })
    expect(node).toMatchObject({
      id: 'terminal-1',
      data: {
        kind: 'terminal',
        sessionId: 'pty-1',
        scrollback: 'kept output',
        terminalAgentBinding: null,
        agentOverlay: {
          provider: 'claude-code',
          status: 'standby',
          activity: {
            invocationId: 'invocation-1',
            generation: 1,
            phase: 'active',
          },
        },
      },
    })
  })

  it('creates durable identity only from current provider SessionStart authority', () => {
    const active = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: activity('active'),
    })
    const verified = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: active.nextWorkspaces,
      event: activity('active', 1, 'provider_session_start'),
    })

    expect(verified).toMatchObject({ didChange: true, durableDidChange: true })
    expect(verified.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding).toEqual({
      provider: 'claude-code',
      resumeSessionId: 'claude-session-1',
      resumeSessionIdVerified: true,
    })
  })

  it('rejects a resume identity without provider SessionStart authority', () => {
    const event = {
      ...activity('active'),
      resumeSessionId: 'unverified-title-or-file-id',
    }
    const result = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event,
    })

    expect(result.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding).toBeNull()
    expect(result.durableDidChange).toBe(false)
  })

  it('ignores a stale generation and keeps the verified binding after current exit', () => {
    const generationTwo = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: activity('active', 2, 'provider_session_start'),
    })
    const stale = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: generationTwo.nextWorkspaces,
      event: activity('exited', 1),
    })
    const exited = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: stale.nextWorkspaces,
      event: activity('exited', 2),
    })

    expect(stale.didChange).toBe(false)
    expect(exited.nextWorkspaces[0]?.nodes[0]?.data).toMatchObject({
      terminalAgentBinding: {
        provider: 'claude-code',
        resumeSessionId: 'claude-session-1',
        resumeSessionIdVerified: true,
      },
      agentOverlay: {
        status: 'standby',
        activity: { generation: 2, phase: 'exited' },
      },
    })
  })

  it('does not reactivate an exited invocation from a late same-generation hook event', () => {
    const active = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: activity('active'),
    })
    const exited = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: active.nextWorkspaces,
      event: activity('exited'),
    })
    const lateSessionStart = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: exited.nextWorkspaces,
      event: {
        ...activity('active', 1, 'provider_session_start'),
        terminalAgentActivity: {
          ...activity('active', 1, 'provider_session_start').terminalAgentActivity,
          observedAtMs: 999,
        },
      },
    })

    expect(lateSessionStart.didChange).toBe(false)
    expect(lateSessionStart.nextWorkspaces[0]?.nodes[0]?.data.agentOverlay?.activity.phase).toBe(
      'exited',
    )
    expect(lateSessionStart.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding).toBeNull()
    expect(isAgentTreatedNode(lateSessionStart.nextWorkspaces[0]?.nodes[0] as never)).toBe(false)
  })

  it('switches providers by generation and replaces identity only after new SessionStart', () => {
    const claude = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: activity('active', 1, 'provider_session_start'),
    })
    const codexEvent = {
      sessionId: 'pty-1',
      resumeSessionId: null,
      terminalAgentActivity: {
        provider: 'codex' as const,
        invocationId: 'codex-invocation',
        generation: 2,
        phase: 'active' as const,
        observedAtMs: 2_000,
        identityAuthority: null,
      },
    }
    const codex = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: claude.nextWorkspaces,
      event: codexEvent,
    })

    expect(codex.nextWorkspaces[0]?.nodes[0]?.data.agentOverlay?.provider).toBe('codex')
    expect(codex.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding?.provider).toBe(
      'claude-code',
    )

    const verifiedCodex = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: codex.nextWorkspaces,
      event: {
        ...codexEvent,
        resumeSessionId: 'codex-session-2',
        terminalAgentActivity: {
          ...codexEvent.terminalAgentActivity,
          observedAtMs: 2_001,
          identityAuthority: 'provider_session_start' as const,
        },
      },
    })
    expect(verifiedCodex.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding).toEqual({
      provider: 'codex',
      resumeSessionId: 'codex-session-2',
      resumeSessionIdVerified: true,
    })
  })

  it('reconciles a snapshot that arrived before the terminal node was registered', () => {
    const cached = activity('active')
    const result = reconcileTerminalAgentActivitySnapshots({
      workspaces: [createWorkspace()],
      readLatestMetadata: sessionId => (sessionId === 'pty-1' ? cached : null),
    })

    expect(result.didChange).toBe(true)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agentOverlay).toMatchObject({
      provider: 'claude-code',
      activity: { invocationId: 'invocation-1', phase: 'active' },
    })
  })
})
