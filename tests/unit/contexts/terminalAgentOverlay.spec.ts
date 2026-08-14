import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  activateTerminalAgentOverlay,
  clearTerminalAgentOverlay,
  isAgentTreatedNode,
  resolveAgentTreatedActionContext,
  reactivateTerminalAgentOverlayAfterReexec,
} from '../../../src/contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { toRuntimeNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/nodeTransform'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'

function createTerminalNode(): Node<TerminalNodeData> {
  return {
    id: 'terminal-1',
    type: 'terminalNode',
    position: { x: 10, y: 20 },
    data: {
      sessionId: 'pty-session-1',
      title: 'Terminal',
      width: 520,
      height: 400,
      kind: 'terminal',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: 'durable scrollback',
      agent: null,
      task: null,
      note: null,
      role: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

describe('terminal agent overlay invariants', () => {
  it('INV-A keeps an unverified terminal agent as a provider hint instead of a binding', () => {
    const terminal = createTerminalNode()
    const activated = activateTerminalAgentOverlay(terminal, {
      provider: 'codex',
      startedAtMs: 1_723_456_789_000,
    })

    expect(activated.data.kind).toBe('terminal')
    expect(activated.data.terminalAgentBinding).toBeNull()
    expect(activated.data.terminalProviderHint).toBe('codex')
    expect(activated.data.agentOverlay).toEqual({
      provider: 'codex',
      status: 'standby',
      startedAtMs: 1_723_456_789_000,
    })
    expect(isAgentTreatedNode(activated)).toBe(true)
  })

  it('INV-1 persists only the explicit binding and reconstructs the runtime overlay on recovery', () => {
    const activated = activateTerminalAgentOverlay(createTerminalNode(), {
      provider: 'codex',
      startedAtMs: 1_723_456_789_000,
    })
    const workspace = {
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
      nodes: [activated],
    } as never

    const persistedWorkspace = toPersistedState([workspace], 'workspace-1').workspaces[0]!
    const persistedNode = persistedWorkspace.nodes[0]!
    expect(persistedNode.kind).toBe('terminal')
    expect(persistedNode.agent).toEqual(activated.data.terminalAgentBinding)
    expect(persistedNode).not.toHaveProperty('agentOverlay')

    const ensuredWorkspace = ensurePersistedWorkspace(persistedWorkspace)
    expect(ensuredWorkspace).not.toBeNull()
    const recovered = toRuntimeNodes(ensuredWorkspace!)[0]!
    expect(recovered.data.kind).toBe('terminal')
    expect(recovered.data.sessionId).toBe(activated.data.sessionId)
    expect(recovered.data.terminalAgentBinding).toEqual(activated.data.terminalAgentBinding)
    expect(recovered.data.agentOverlay).toEqual(
      expect.objectContaining({ provider: 'codex', status: 'restoring' }),
    )
  })

  it('normalizes an unverified legacy binding to a provider hint without auto-resume identity', () => {
    const terminal = createTerminalNode()
    const persistedWorkspace = toPersistedState(
      [
        {
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
          nodes: [terminal],
        } as never,
      ],
      'workspace-1',
    ).workspaces[0]!
    persistedWorkspace.nodes[0]!.agent = {
      provider: 'codex',
      resumeSessionId: null,
      resumeSessionIdVerified: false,
    }

    const ensuredWorkspace = ensurePersistedWorkspace(persistedWorkspace)
    const recovered = toRuntimeNodes(ensuredWorkspace!)[0]!

    expect(recovered.data.terminalAgentBinding).toBeNull()
    expect(recovered.data.terminalProviderHint).toBe('codex')
    expect(recovered.data.agentOverlay).toMatchObject({
      provider: 'codex',
      status: 'restoring',
    })
  })

  it('INV-2 preserves node, PTY session, and scrollback identity across overlay on/off', () => {
    const terminal = createTerminalNode()
    const activated = activateTerminalAgentOverlay(terminal, {
      provider: 'claude-code',
      startedAtMs: 1_723_456_789_000,
    })
    const cleared = clearTerminalAgentOverlay(activated)

    expect(activated.id).toBe(terminal.id)
    expect(activated.data.sessionId).toBe(terminal.data.sessionId)
    expect(activated.data.scrollback).toBe(terminal.data.scrollback)
    expect(cleared.id).toBe(terminal.id)
    expect(cleared.data.sessionId).toBe(terminal.data.sessionId)
    expect(cleared.data.scrollback).toBe(terminal.data.scrollback)
    expect(cleared.data.kind).toBe('terminal')
    expect(cleared.data.terminalAgentBinding).toBeNull()
    expect(cleared.data.agentOverlay).toBeNull()
    expect(cleared.data.terminalProviderHint).toBeNull()
    expect(isAgentTreatedNode(cleared)).toBe(false)
  })

  it('does not replace an active overlay from agent-like text typed inside the TUI', () => {
    const active = activateTerminalAgentOverlay(createTerminalNode(), {
      provider: 'codex',
      startedAtMs: 1_723_456_789_000,
    })
    const ignored = activateTerminalAgentOverlay(active, {
      provider: 'claude-code',
      startedAtMs: 1_723_456_790_000,
    })

    expect(ignored).toBe(active)
    expect(ignored.data.agentOverlay?.provider).toBe('codex')
    expect(ignored.data.terminalAgentBinding).toBeNull()
    expect(ignored.data.terminalProviderHint).toBe('codex')
  })

  it('sources overlay action fields only from the binding, overlay, and terminal directory', () => {
    const activated = activateTerminalAgentOverlay(
      {
        ...createTerminalNode(),
        data: {
          ...createTerminalNode().data,
          executionDirectory: '/tmp/terminal-cwd',
          agent: null,
          startedAt: '1999-01-01T00:00:00.000Z',
        },
      },
      {
        provider: 'claude-code',
        startedAtMs: Date.parse('2026-08-12T01:02:03.000Z'),
        resumeSessionId: 'resume-overlay',
        resumeSessionIdVerified: true,
      },
    )

    expect(resolveAgentTreatedActionContext(activated)).toEqual({
      provider: 'claude-code',
      cwd: '/tmp/terminal-cwd',
      startedAt: '2026-08-12T01:02:03.000Z',
      resumeSessionId: 'resume-overlay',
      resumeSessionIdVerified: true,
    })
  })

  it('INV-1 re-enters with a fresh provider without changing terminal identity or scrollback', () => {
    const original = createTerminalNode()
    const firstOverlay = activateTerminalAgentOverlay(original, {
      provider: 'claude-code',
      startedAtMs: 1_723_456_789_000,
    })
    const droppedBack = clearTerminalAgentOverlay(firstOverlay)
    const reentered = reactivateTerminalAgentOverlayAfterReexec(droppedBack, {
      expectedSessionId: original.data.sessionId,
      provider: 'codex',
      startedAtMs: 1_723_456_790_000,
      resumeSessionId: 'codex-session-2',
      resumeSessionIdVerified: true,
    })

    expect(reentered.id).toBe(original.id)
    expect(reentered.data.kind).toBe('terminal')
    expect(reentered.data.sessionId).toBe(original.data.sessionId)
    expect(reentered.data.scrollback).toBe(original.data.scrollback)
    expect(reentered.data.agentOverlay).toEqual({
      provider: 'codex',
      status: 'standby',
      startedAtMs: 1_723_456_790_000,
    })
    expect(reentered.data.terminalAgentBinding).toEqual({
      provider: 'codex',
      resumeSessionId: 'codex-session-2',
      resumeSessionIdVerified: true,
    })
  })

  it('ignores a stale exit from an earlier overlay activation', () => {
    const original = createTerminalNode()
    const current = activateTerminalAgentOverlay(original, {
      provider: 'codex',
      startedAtMs: 1_723_456_790_000,
    })

    expect(clearTerminalAgentOverlay(current, { expectedStartedAtMs: 1_723_456_789_000 })).toBe(
      current,
    )
    expect(
      clearTerminalAgentOverlay(current, { expectedStartedAtMs: 1_723_456_790_000 }).data
        .agentOverlay,
    ).toBeNull()
  })
})
