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
  identityAuthority: 'provider_session_start' | 'session_file' | null = null,
) {
  return {
    sessionId: 'pty-1',
    resumeSessionId:
      identityAuthority === 'session_file'
        ? 'codex-session-1'
        : identityAuthority
          ? 'claude-session-1'
          : null,
    terminalAgentActivity: {
      provider:
        identityAuthority === 'session_file' ? ('codex' as const) : ('claude-code' as const),
      invocationId: `invocation-${generation}`,
      generation,
      phase,
      observedAtMs: 1_000 + generation,
      identityAuthority,
    },
  }
}

describe('terminal agent authenticated activity projection', () => {
  it('persists a file identity only with the current invocation and keeps the original terminal', () => {
    const workspace = createWorkspace()
    const event = activity('active', 2, 'session_file')
    const result = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [workspace],
      event,
    })
    expect(result.durableDidChange).toBe(true)
    expect(result.nextWorkspaces[0].nodes[0].data).toMatchObject({
      kind: 'terminal',
      sessionId: 'pty-1',
      scrollback: 'kept output',
      terminalAgentBinding: {
        provider: 'codex',
        resumeSessionId: 'codex-session-1',
        resumeSessionIdVerified: true,
      },
    })
    const late = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: result.nextWorkspaces,
      event: activity('active', 1, 'session_file'),
    })
    expect(late.didChange).toBe(false)
  })
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

  it('keeps runtime working observation authoritative when SessionStart updates the standby overlay', () => {
    const workspace = createWorkspace()
    workspace.nodes[0].data.agentRuntimeObservation = {
      status: 'running',
      source: 'codex_hook',
      hookInstallState: 'installed',
      degraded: false,
    }
    const active = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [workspace],
      event: activity('active'),
    })
    const sessionStart = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: active.nextWorkspaces,
      event: activity('active', 1, 'provider_session_start'),
    })
    const data = sessionStart.nextWorkspaces[0]?.nodes[0]?.data

    expect(data?.agentOverlay?.status).toBe('standby')
    expect(data?.agentRuntimeObservation).toEqual({
      status: 'running',
      source: 'codex_hook',
      hookInstallState: 'installed',
      degraded: false,
    })
    expect(
      data?.agentRuntimeObservation?.status ?? data?.agentOverlay?.status ?? data?.status,
    ).toBe('running')
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

    const forgedReplacement = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: verified.nextWorkspaces,
      event: {
        ...activity('active', 1, 'provider_session_start'),
        resumeSessionId: 'forged-replacement',
        terminalAgentActivity: {
          ...activity('active', 1, 'provider_session_start').terminalAgentActivity,
          observedAtMs: 1_500,
        },
      },
    })
    expect(forgedReplacement.nextWorkspaces[0]?.nodes[0]?.data.terminalAgentBinding).toEqual({
      provider: 'claude-code',
      resumeSessionId: 'claude-session-1',
      resumeSessionIdVerified: true,
    })
    expect(forgedReplacement.durableDidChange).toBe(false)
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

  it('prefers registry revision fences and uses timestamps only for legacy activity', () => {
    const revisionedActive = {
      ...activity('active'),
      terminalAgentActivity: {
        ...activity('active').terminalAgentActivity,
        observedAtMs: 5_000,
        sourceRevision: 5,
        revision: 10,
      },
    }
    const active = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: revisionedActive,
    })
    const newerRevision = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: active.nextWorkspaces,
      event: {
        ...revisionedActive,
        terminalAgentActivity: {
          ...revisionedActive.terminalAgentActivity,
          observedAtMs: 1,
          phase: 'exited',
          sourceRevision: 6,
          revision: 11,
        },
      },
    })
    const lateLegacy = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: newerRevision.nextWorkspaces,
      event: {
        ...activity('active'),
        terminalAgentActivity: {
          ...activity('active').terminalAgentActivity,
          observedAtMs: 9_000,
        },
      },
    })

    expect(newerRevision.didChange).toBe(true)
    expect(newerRevision.nextWorkspaces[0]?.nodes[0]?.data.agentOverlay?.activity).toMatchObject({
      phase: 'exited',
      observedAtMs: 1,
      sourceRevision: 6,
      revision: 11,
    })
    expect(lateLegacy.didChange).toBe(false)
  })

  it('resets the revision fence when a higher legacy generation arrives', () => {
    const revisionedGenerationOne = {
      ...activity('active'),
      terminalAgentActivity: {
        ...activity('active').terminalAgentActivity,
        sourceRevision: 5,
        revision: 10,
      },
    }
    const generationOne = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: revisionedGenerationOne,
    })
    const legacyGenerationTwo = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: generationOne.nextWorkspaces,
      event: activity('active', 2),
    })

    expect(legacyGenerationTwo.didChange).toBe(true)
    expect(legacyGenerationTwo.nextWorkspaces[0]?.nodes[0]?.data.agentOverlay?.activity).toEqual({
      invocationId: 'invocation-2',
      generation: 2,
      phase: 'active',
      observedAtMs: 1_002,
      verifiedProviderSessionId: null,
    })
  })

  it('ignores duplicate or lower registry revisions even when their timestamps are newer', () => {
    const revisioned = {
      ...activity('active'),
      terminalAgentActivity: {
        ...activity('active').terminalAgentActivity,
        sourceRevision: 7,
        revision: 12,
      },
    }
    const active = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createWorkspace()],
      event: revisioned,
    })

    for (const revision of [12, 11]) {
      const stale = updateWorkspacesWithTerminalAgentActivityMetadata({
        workspaces: active.nextWorkspaces,
        event: {
          ...revisioned,
          terminalAgentActivity: {
            ...revisioned.terminalAgentActivity,
            observedAtMs: 99_000,
            phase: 'exited',
            sourceRevision: 8,
            revision,
          },
        },
      })
      expect(stale.didChange).toBe(false)
    }
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

  it('adopts verified identity from an exited late-attach baseline without reactivating it', () => {
    const cached = {
      ...activity('exited', 1, 'provider_session_start'),
      terminalAgentActivity: {
        ...activity('exited', 1, 'provider_session_start').terminalAgentActivity,
        sourceRevision: 3,
        revision: 3,
      },
    }
    const result = reconcileTerminalAgentActivitySnapshots({
      workspaces: [createWorkspace()],
      readLatestMetadata: sessionId => (sessionId === 'pty-1' ? cached : null),
    })

    expect(result).toMatchObject({ didChange: true, durableDidChange: true })
    expect(result.nextWorkspaces[0]?.nodes[0]?.data).toMatchObject({
      terminalAgentBinding: {
        provider: 'claude-code',
        resumeSessionId: 'claude-session-1',
        resumeSessionIdVerified: true,
      },
      agentOverlay: {
        activity: {
          generation: 1,
          phase: 'exited',
          sourceRevision: 3,
          revision: 3,
        },
      },
    })
  })
})
