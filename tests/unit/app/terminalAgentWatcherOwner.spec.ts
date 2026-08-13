import { describe, expect, it, vi } from 'vitest'
import { createTerminalAgentWatcherOwner } from '../../../src/app/renderer/shell/utils/terminalAgentWatcherOwner'

function createWorkspace(options: { overlay: boolean; provider?: 'claude-code' | 'codex' }) {
  const provider = options.provider ?? 'codex'
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
          terminalProviderHint: options.overlay ? provider : null,
          terminalAgentBinding: null,
          agentOverlay: options.overlay
            ? { provider, status: 'running', startedAtMs: 1_723_456_789_000 }
            : null,
        },
      },
    ],
  } as never
}

describe('terminal agent watcher owner', () => {
  it('INV-3 attaches once and disposes on drop-back and node removal', async () => {
    const invoke = vi.fn(async () => undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true })])
    owner.sync([createWorkspace({ overlay: true })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenNthCalledWith(1, {
      kind: 'command',
      id: 'session.attachAgentStateWatcher',
      payload: expect.objectContaining({
        sessionId: 'pty-session-1',
        provider: 'codex',
        cwd: '/tmp/workspace',
        launchMode: 'new',
        resumeSessionId: null,
      }),
    })

    owner.sync([createWorkspace({ overlay: false })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke).toHaveBeenNthCalledWith(2, {
      kind: 'command',
      id: 'session.detachAgentStateWatcher',
      payload: { sessionId: 'pty-session-1' },
    })

    owner.sync([createWorkspace({ overlay: true })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
    owner.sync([])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(4))
    expect(invoke).toHaveBeenLastCalledWith({
      kind: 'command',
      id: 'session.detachAgentStateWatcher',
      payload: { sessionId: 'pty-session-1' },
    })
  })

  it('disposes every watcher still owned by the renderer lifecycle', async () => {
    const invoke = vi.fn(async () => undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    owner.dispose()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

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

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'session.attachAgentStateWatcher' }),
    )
  })

  it('INV-3 serializes drop-back disposal before one fresh cross-provider watcher attach', async () => {
    const liveWatchers: Array<{ provider: string }> = []
    let releaseDetach = () => undefined
    const detachBarrier = new Promise<void>(resolve => {
      releaseDetach = resolve
    })
    const invoke = vi.fn(async request => {
      if (request.id === 'session.attachAgentStateWatcher') {
        liveWatchers.push({ provider: request.payload.provider })
        return
      }
      await detachBarrier
      liveWatchers.length = 0
    })
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true, provider: 'claude-code' })])
    await vi.waitFor(() => expect(liveWatchers).toEqual([{ provider: 'claude-code' }]))

    owner.sync([createWorkspace({ overlay: false })])
    owner.sync([createWorkspace({ overlay: true, provider: 'codex' })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(liveWatchers).toEqual([{ provider: 'claude-code' }])

    releaseDetach()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'session.attachAgentStateWatcher',
        payload: expect.objectContaining({ provider: 'codex' }),
      }),
    )
    expect(liveWatchers).toEqual([{ provider: 'codex' }])
  })

  it('does not attach a replacement watcher when disposal fails', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('detach failed'))
    const owner = createTerminalAgentWatcherOwner({ invoke, now: () => 1_723_456_789_000 })

    owner.sync([createWorkspace({ overlay: true, provider: 'claude-code' })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))

    owner.sync([createWorkspace({ overlay: true, provider: 'codex' })])
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'session.detachAgentStateWatcher' }),
    )
    expect(invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session.attachAgentStateWatcher',
        payload: expect.objectContaining({ provider: 'codex' }),
      }),
    )
  })
})
