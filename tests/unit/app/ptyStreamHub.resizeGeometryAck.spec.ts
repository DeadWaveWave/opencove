import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'

function createOpenWebSocketMock() {
  const sent: unknown[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((raw: string) => sent.push(JSON.parse(raw))),
    close: vi.fn(),
  }
  return { ws: ws as never, sent }
}

function createHub(resize: ControlSurfacePtyRuntime['resize']) {
  const hub = new PtyStreamHub({
    replayWindowMaxBytes: 64_000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize,
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
    },
  })
  const client = createOpenWebSocketMock()
  hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: client.ws })
  hub.registerSessionMetadata({
    sessionId: 'session-ack',
    kind: 'terminal',
    startedAt: '2026-08-11T00:00:00.000Z',
    cwd: '/tmp',
    command: 'zsh',
    args: [],
    cols: 80,
    rows: 24,
  })
  hub.attach({ clientId: 'controller', sessionId: 'session-ack', role: 'controller' })
  client.sent.length = 0
  return { hub, sent: client.sent }
}

describe('PtyStreamHub applied geometry acknowledgement', () => {
  it.each(['accepted_unverified', 'runtime_failed', 'throw'] as const)(
    'reconfirms the previous canonical size after %s instead of accepting a false no-op',
    async failure => {
      const resize = vi
        .fn<ControlSurfacePtyRuntime['resize']>()
        .mockImplementation(async input => ({
          sessionId: input.sessionId,
          operationId: input.operationId!,
          status: 'accepted',
          changed: true,
          geometry: { cols: input.cols, rows: input.rows, revision: null },
          authority: null,
        }))
      if (failure === 'throw') {
        resize.mockRejectedValueOnce(new Error('observer lost'))
      } else {
        resize.mockImplementationOnce(async input => ({
          sessionId: input.sessionId,
          operationId: input.operationId!,
          status: failure,
          changed: false,
          geometry: null,
          authority: null,
        }))
      }
      const { hub } = createHub(resize)
      const input = { clientId: 'controller', sessionId: 'session-ack', authorityEpoch: 1 }
      await hub.resize({ ...input, cols: 120, rows: 40 })
      const retry = await hub.resize({ ...input, cols: 80, rows: 24 })
      expect(retry).toMatchObject({
        status: 'accepted',
        changed: false,
        geometry: { cols: 80, rows: 24 },
      })
      expect(resize).toHaveBeenCalledTimes(2)
      await hub.resize({ ...input, cols: 80, rows: 24 })
      expect(resize).toHaveBeenCalledTimes(2)
      hub.forgetSession('session-ack')
    },
  )
  it('commits the runtime-applied geometry when it differs from the request', async () => {
    const { hub, sent } = createHub(async input => ({
      sessionId: input.sessionId,
      operationId: input.operationId ?? 'operation-applied',
      status: 'accepted',
      changed: true,
      geometry: { cols: 91, rows: 27, revision: null },
      authority: null,
    }))

    const result = await hub.resize({
      clientId: 'controller',
      sessionId: 'session-ack',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-applied',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })

    expect(result).toMatchObject({
      status: 'accepted',
      geometry: { cols: 91, rows: 27, revision: 1 },
    })
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-ack',
      cols: 91,
      rows: 27,
      reason: 'frame_commit',
      revision: 1,
    })
    expect(sent).not.toContainEqual(expect.objectContaining({ cols: 120, rows: 40 }))
  })

  it('does not commit a remote accepted result that omitted geometry', async () => {
    const { hub, sent } = createHub(async input => ({
      sessionId: input.sessionId,
      operationId: input.operationId ?? 'operation-missing',
      status: 'accepted',
      changed: true,
      geometry: null,
      authority: null,
    }))

    const result = await hub.resize({
      clientId: 'controller',
      sessionId: 'session-ack',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-missing',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })

    expect(result.status).toBe('runtime_failed')
    await expect(hub.presentationSnapshotSession('session-ack')).resolves.toMatchObject({
      cols: 80,
      rows: 24,
      geometryRevision: null,
    })
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)
  })

  it('keeps an applied-unverified resize non-failing without committing the request', async () => {
    const { hub, sent } = createHub(async input => ({
      sessionId: input.sessionId,
      operationId: input.operationId ?? 'operation-unverified',
      status: 'accepted_unverified',
      changed: false,
      geometry: null,
      authority: null,
    }))

    const result = await hub.resize({
      clientId: 'controller',
      sessionId: 'session-ack',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-unverified',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })

    expect(result).toMatchObject({
      status: 'accepted_unverified',
      changed: false,
      geometry: { cols: 80, rows: 24, revision: null },
    })
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)
  })
})
