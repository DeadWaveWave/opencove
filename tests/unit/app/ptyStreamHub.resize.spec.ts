import { describe, expect, it, vi } from 'vitest'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

function createOpenWebSocketMock() {
  const sent: unknown[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw))
    }),
    close: vi.fn(),
  }

  return { ws: ws as never, sent }
}

describe('PtyStreamHub resize', () => {
  it('does not forward unchanged canonical geometry to the PTY runtime', () => {
    const runtimeResize = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: runtimeResize,
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const { ws, sent } = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'client-1', kind: 'desktop', ws })
    hub.registerSessionMetadata({
      sessionId: 'session-1',
      kind: 'agent',
      startedAt: '2026-04-29T00:00:00.000Z',
      cwd: '/tmp',
      command: 'codex',
      args: [],
      cols: 64,
      rows: 44,
    })
    hub.attach({ clientId: 'client-1', sessionId: 'session-1', role: 'controller' })
    sent.length = 0

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 64,
      rows: 44,
      reason: 'frame_commit',
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
    })

    expect(runtimeResize).toHaveBeenCalledWith('session-1', 80, 24, 'frame_commit')
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
    })
  })
})
