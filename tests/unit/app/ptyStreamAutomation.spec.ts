import { describe, expect, it, vi } from 'vitest'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

function fixture() {
  const write = vi.fn(),
    ready = vi.fn(async () => {})
  const hub = new PtyStreamHub({
    replayWindowMaxBytes: 64000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write,
      waitForShellReady: ready,
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => undefined,
      onExit: () => () => undefined,
    },
  })
  hub.registerSessionMetadata({
    sessionId: 'terminal',
    kind: 'terminal',
    cwd: '/repo',
    command: 'sh',
    args: [],
    cols: 80,
    rows: 24,
    startedAt: '2026-10-11T00:00:00Z',
  })
  return { hub, write, ready }
}

describe('programmatic PTY input', () => {
  it('writes exact bytes without claiming terminal geometry', async () => {
    const f = fixture()
    try {
      const before = f.hub.listSessions()
      await f.hub.writeAutomation({
        sessionId: 'terminal',
        data: 'echo hello\n',
        assertActive: () => {},
        validateBinding: async () => {},
      })
      expect(f.write).toHaveBeenCalledWith('terminal', 'echo hello\n')
      expect(f.hub.listSessions()).toEqual(before)
    } finally {
      f.hub.forgetSession('terminal')
    }
  })
  it('rechecks generation and exact binding after readiness, and lets later queue work continue', async () => {
    const f = fixture()
    try {
      let release!: () => void
      f.ready.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve
          }),
      )
      const stale = f.hub.writeAutomation({
        sessionId: 'terminal',
        data: 'danger',
        assertActive: () => {
          throw new Error('retired')
        },
        validateBinding: async () => {},
      })
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      release()
      await expect(stale).rejects.toThrow('retired')
      await expect(
        f.hub.writeAutomation({
          sessionId: 'terminal',
          data: 'stale binding',
          assertActive: () => {},
          validateBinding: async () => {
            throw new Error('binding changed')
          },
        }),
      ).rejects.toThrow('binding changed')
      expect(f.write).not.toHaveBeenCalled()
      await f.hub.writeAutomation({
        sessionId: 'terminal',
        data: '\u0003',
        assertActive: () => {},
        validateBinding: async () => {},
      })
      expect(f.write).toHaveBeenCalledWith('terminal', '\u0003')
    } finally {
      f.hub.forgetSession('terminal')
    }
  })
})
