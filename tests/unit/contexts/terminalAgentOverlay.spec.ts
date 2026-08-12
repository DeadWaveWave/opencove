import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  activateTerminalAgentOverlay,
  clearTerminalAgentOverlay,
  isAgentTreatedNode,
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
  it('INV-1 keeps durable terminal kind while adding a separate binding and runtime overlay', () => {
    const terminal = createTerminalNode()
    const activated = activateTerminalAgentOverlay(terminal, {
      provider: 'codex',
      startedAtMs: 1_723_456_789_000,
    })

    expect(activated.data.kind).toBe('terminal')
    expect(activated.data.terminalAgentBinding).toEqual({
      provider: 'codex',
      resumeSessionId: null,
      resumeSessionIdVerified: false,
    })
    expect(activated.data.agentOverlay).toEqual({
      provider: 'codex',
      status: 'running',
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
    expect(ignored.data.terminalAgentBinding?.provider).toBe('codex')
  })
})
