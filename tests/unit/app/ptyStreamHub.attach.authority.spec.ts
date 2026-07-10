import { describe, expect, it, vi } from 'vitest'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type {
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
} from '../../../src/shared/contracts/dto'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function acceptedRuntimeResize(input: ResizeTerminalInput): TerminalGeometryCommitResult {
  return {
    sessionId: input.sessionId,
    operationId: input.operationId ?? 'runtime-operation',
    status: 'accepted',
    changed: true,
    geometry: { cols: input.cols, rows: input.rows, revision: null },
    authority: null,
  }
}

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

describe('PtyStreamHub attach authority ordering', () => {
  it('promotes the next attached subscriber when the controller detaches', () => {
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const controller = createOpenWebSocketMock()
    const nextController = createOpenWebSocketMock()
    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'next-controller', kind: 'web', ws: nextController.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-promotion',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'zsh',
      args: [],
      cols: 80,
      rows: 24,
    })
    hub.attach({ clientId: 'controller', sessionId: 'session-promotion' })
    hub.attach({ clientId: 'next-controller', sessionId: 'session-promotion' })
    nextController.sent.length = 0

    hub.detach('controller', 'session-promotion')

    expect(nextController.sent).toContainEqual(
      expect.objectContaining({
        type: 'control_changed',
        sessionId: 'session-promotion',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )
  })

  it('does not promote a subscriber that explicitly attached as viewer', () => {
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const controller = createOpenWebSocketMock()
    const viewer = createOpenWebSocketMock()
    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'viewer', kind: 'web', ws: viewer.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-viewer',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'zsh',
      args: [],
      cols: 80,
      rows: 24,
    })
    hub.attach({ clientId: 'controller', sessionId: 'session-viewer' })
    hub.attach({ clientId: 'viewer', sessionId: 'session-viewer', role: 'viewer' })
    viewer.sent.length = 0

    hub.detach('controller', 'session-viewer')

    expect(viewer.sent).toContainEqual(
      expect.objectContaining({
        type: 'control_changed',
        sessionId: 'session-viewer',
        controller: null,
        role: 'viewer',
        authorityEpoch: 2,
      }),
    )
    expect(
      viewer.sent.some(
        message =>
          (message as { type?: string; role?: string }).type === 'control_changed' &&
          (message as { role?: string }).role === 'controller',
      ),
    ).toBe(false)
  })

  it('hands control to a reconnecting client after the old controller detaches during resize', async () => {
    const firstRuntimeResult = createDeferred<TerminalGeometryCommitResult>()
    const runtimeResize = vi
      .fn<(input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>>()
      .mockImplementationOnce(async () => await firstRuntimeResult.promise)
      .mockImplementation(async input => acceptedRuntimeResize(input))
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
    const oldController = createOpenWebSocketMock()
    const reconnecting = createOpenWebSocketMock()
    hub.registerClient({ clientId: 'old-controller', kind: 'desktop', ws: oldController.ws })
    hub.registerClient({ clientId: 'reconnecting', kind: 'desktop', ws: reconnecting.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-reconnect',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'zsh',
      args: [],
      cols: 80,
      rows: 24,
    })
    hub.attach({ clientId: 'old-controller', sessionId: 'session-reconnect' })
    oldController.sent.length = 0

    const oldResize = hub.resize({
      clientId: 'old-controller',
      sessionId: 'session-reconnect',
      cols: 100,
      rows: 30,
      reason: 'frame_commit',
      operationId: 'old-resize',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => expect(runtimeResize).toHaveBeenCalledOnce())

    hub.attach({ clientId: 'reconnecting', sessionId: 'session-reconnect' })
    hub.unregisterClient('old-controller')
    expect(reconnecting.sent).toEqual([])

    firstRuntimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    await oldResize
    await vi.waitFor(() => {
      expect(reconnecting.sent).toContainEqual(
        expect.objectContaining({
          type: 'attached',
          sessionId: 'session-reconnect',
          role: 'controller',
          authorityEpoch: 3,
        }),
      )
    })
    expect(reconnecting.sent).toContainEqual(
      expect.objectContaining({
        type: 'control_changed',
        sessionId: 'session-reconnect',
        role: 'controller',
        authorityEpoch: 3,
      }),
    )

    const nextResize = await hub.resize({
      clientId: 'reconnecting',
      sessionId: 'session-reconnect',
      cols: 110,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'reconnected-resize',
      baseGeometryRevision: 1,
      authorityEpoch: 3,
    })
    expect(nextResize).toMatchObject({
      status: 'accepted',
      changed: true,
      authority: { role: 'controller', epoch: 3 },
    })
  })

  it('orders a control request after the viewer attach that makes it eligible', async () => {
    const runtimeResult = createDeferred<TerminalGeometryCommitResult>()
    const runtimeResize = vi.fn((_input: ResizeTerminalInput) => runtimeResult.promise)
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
    const controller = createOpenWebSocketMock()
    const joiningViewer = createOpenWebSocketMock()
    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'joining-viewer', kind: 'web', ws: joiningViewer.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-queued-viewer',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'zsh',
      args: [],
      cols: 80,
      rows: 24,
    })
    hub.attach({ clientId: 'controller', sessionId: 'session-queued-viewer' })

    const resize = hub.resize({
      clientId: 'controller',
      sessionId: 'session-queued-viewer',
      cols: 100,
      rows: 30,
      operationId: 'resize-before-viewer-attach',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => expect(runtimeResize).toHaveBeenCalledOnce())
    hub.attach({
      clientId: 'joining-viewer',
      sessionId: 'session-queued-viewer',
      role: 'viewer',
    })
    hub.requestControl({ clientId: 'joining-viewer', sessionId: 'session-queued-viewer' })

    runtimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    await resize
    await vi.waitFor(() => {
      expect(joiningViewer.sent).toContainEqual(
        expect.objectContaining({
          type: 'control_changed',
          sessionId: 'session-queued-viewer',
          role: 'controller',
          authorityEpoch: 2,
        }),
      )
    })
    expect(
      joiningViewer.sent.some(
        message =>
          (message as { type?: string; code?: string }).type === 'error' &&
          (message as { code?: string }).code === 'session.not_attached',
      ),
    ).toBe(false)
  })
})
