import { describe, expect, it, vi } from 'vitest'
import { createTerminalAgentWatcherOwner } from '../../../src/app/renderer/shell/utils/terminalAgentWatcherOwner'

function createWorkspace(options: { overlay: boolean }) {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    worktreesRoot: '',
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
          sessionId: 'pty-session-1',
          title: 'Terminal',
          executionDirectory: '/tmp/workspace',
          width: 520,
          height: 400,
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: null,
          task: null,
          note: null,
          role: null,
          image: null,
          document: null,
          website: null,
          terminalAgentBinding: options.overlay
            ? {
                provider: 'codex',
                resumeSessionId: null,
                resumeSessionIdVerified: false,
              }
            : null,
          agentOverlay: options.overlay
            ? { provider: 'codex', status: 'running', startedAtMs: 1_723_456_789_000 }
            : null,
        },
      },
    ],
  } as never
}

describe('terminal agent watcher owner', () => {
  it('INV-3 attaches once and disposes on drop-back and node removal', () => {
    const invoke = vi.fn(async () => undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true })])
    owner.sync([createWorkspace({ overlay: true })])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenNthCalledWith(1, {
      kind: 'command',
      id: 'session.attachAgentStateWatcher',
      payload: expect.objectContaining({
        sessionId: 'pty-session-1',
        provider: 'codex',
        cwd: '/tmp/workspace',
      }),
    })

    owner.sync([createWorkspace({ overlay: false })])
    expect(invoke).toHaveBeenNthCalledWith(2, {
      kind: 'command',
      id: 'session.detachAgentStateWatcher',
      payload: { sessionId: 'pty-session-1' },
    })

    owner.sync([createWorkspace({ overlay: true })])
    owner.sync([])
    expect(invoke).toHaveBeenLastCalledWith({
      kind: 'command',
      id: 'session.detachAgentStateWatcher',
      payload: { sessionId: 'pty-session-1' },
    })
  })

  it('disposes every watcher still owned by the renderer lifecycle', () => {
    const invoke = vi.fn(async () => undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true })])
    owner.dispose()

    expect(invoke).toHaveBeenLastCalledWith({
      kind: 'command',
      id: 'session.detachAgentStateWatcher',
      payload: { sessionId: 'pty-session-1' },
    })
  })

  it('releases ownership after an attach race so recovered state can retry', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('session not admitted yet'))
      .mockResolvedValue(undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true })])
    await Promise.resolve()
    owner.sync([createWorkspace({ overlay: true })])

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'session.attachAgentStateWatcher' }),
    )
  })
})
