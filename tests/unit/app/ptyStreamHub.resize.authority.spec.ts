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
    send: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw))
    }),
    close: vi.fn(),
  }
  return { ws: ws as never, sent }
}

function registerTerminalSession(hub: PtyStreamHub, sessionId: string): void {
  hub.registerSessionMetadata({
    sessionId,
    kind: 'terminal',
    startedAt: '2026-07-10T00:00:00.000Z',
    cwd: '/tmp',
    command: 'zsh',
    args: [],
    cols: 80,
    rows: 24,
  })
}

describe('PtyStreamHub resize authority ordering', () => {
  it('orders controller handoff behind an in-flight runtime geometry commit', async () => {
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
    const nextController = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'next-controller', kind: 'web', ws: nextController.ws })
    registerTerminalSession(hub, 'session-handoff')
    hub.attach({ clientId: 'controller', sessionId: 'session-handoff', role: 'controller' })
    hub.attach({ clientId: 'next-controller', sessionId: 'session-handoff', role: 'controller' })
    controller.sent.length = 0
    nextController.sent.length = 0

    const resizePromise = hub.resize({
      clientId: 'controller',
      sessionId: 'session-handoff',
      cols: 100,
      rows: 30,
      reason: 'frame_commit',
      operationId: 'operation-before-handoff',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => {
      expect(runtimeResize).toHaveBeenCalledTimes(1)
    })

    hub.requestControl({ clientId: 'next-controller', sessionId: 'session-handoff' })
    expect(
      nextController.sent.some(
        message => (message as { type?: string }).type === 'control_changed',
      ),
    ).toBe(false)

    runtimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    const accepted = await resizePromise
    await vi.waitFor(() => {
      expect(nextController.sent).toContainEqual(
        expect.objectContaining({
          type: 'control_changed',
          role: 'controller',
          authorityEpoch: 2,
        }),
      )
    })

    expect(accepted).toMatchObject({
      status: 'accepted',
      geometry: { cols: 100, rows: 30, revision: 1 },
      authority: { role: 'controller', epoch: 1 },
    })
    const nextControllerEventTypes = nextController.sent.map(
      message => (message as { type?: string }).type,
    )
    expect(nextControllerEventTypes.indexOf('geometry')).toBeLessThan(
      nextControllerEventTypes.indexOf('control_changed'),
    )
  })

  it('applies a queued release after a queued request so the latest control intent wins', async () => {
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
    const viewer = createOpenWebSocketMock()
    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'viewer', kind: 'web', ws: viewer.ws })
    registerTerminalSession(hub, 'session-control-intent')
    hub.attach({ clientId: 'controller', sessionId: 'session-control-intent', role: 'controller' })
    hub.attach({ clientId: 'viewer', sessionId: 'session-control-intent', role: 'viewer' })
    viewer.sent.length = 0

    const resizePromise = hub.resize({
      clientId: 'controller',
      sessionId: 'session-control-intent',
      cols: 100,
      rows: 30,
      operationId: 'resize-before-control-intent',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => expect(runtimeResize).toHaveBeenCalledTimes(1))
    hub.requestControl({ clientId: 'viewer', sessionId: 'session-control-intent' })
    hub.releaseControl({ clientId: 'viewer', sessionId: 'session-control-intent' })

    runtimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    await resizePromise
    await vi.waitFor(() => {
      expect(viewer.sent).toContainEqual(
        expect.objectContaining({
          type: 'control_changed',
          role: 'viewer',
          authorityEpoch: 3,
        }),
      )
    })
    const roles = viewer.sent
      .filter(message => (message as { type?: string }).type === 'control_changed')
      .map(message => (message as { role?: string }).role)
    expect(roles).toEqual(['controller', 'viewer'])
  })

  it('orders writes and their implicit controller handoff behind an in-flight resize', async () => {
    const runtimeResult = createDeferred<TerminalGeometryCommitResult>()
    const runtimeResize = vi.fn((_input: ResizeTerminalInput) => runtimeResult.promise)
    const runtimeWrite = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: runtimeWrite,
        resize: runtimeResize,
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const controller = createOpenWebSocketMock()
    const writer = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'writer', kind: 'web', ws: writer.ws })
    registerTerminalSession(hub, 'session-write-order')
    hub.attach({ clientId: 'controller', sessionId: 'session-write-order', role: 'controller' })
    hub.attach({ clientId: 'writer', sessionId: 'session-write-order', role: 'controller' })
    controller.sent.length = 0
    writer.sent.length = 0

    const resizePromise = hub.resize({
      clientId: 'controller',
      sessionId: 'session-write-order',
      cols: 100,
      rows: 30,
      reason: 'frame_commit',
      operationId: 'operation-before-write',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => {
      expect(runtimeResize).toHaveBeenCalledTimes(1)
    })

    hub.write({ clientId: 'writer', sessionId: 'session-write-order', data: 'echo ordered\r' })

    expect(runtimeWrite).not.toHaveBeenCalled()
    expect(
      writer.sent.some(message => (message as { type?: string }).type === 'control_changed'),
    ).toBe(false)

    runtimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    await resizePromise
    await vi.waitFor(() => {
      expect(runtimeWrite).toHaveBeenCalledWith('session-write-order', 'echo ordered\r')
    })

    expect(writer.sent).toContainEqual(
      expect.objectContaining({
        type: 'control_changed',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )
    const writerEventTypes = writer.sent.map(message => (message as { type?: string }).type)
    expect(writerEventTypes.indexOf('geometry')).toBeLessThan(
      writerEventTypes.indexOf('control_changed'),
    )
  })

  it('drops a queued write when the retained session exits during resize', async () => {
    const runtimeResult = createDeferred<TerminalGeometryCommitResult>()
    const runtimeResize = vi.fn((_input: ResizeTerminalInput) => runtimeResult.promise)
    const runtimeWrite = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: runtimeWrite,
        resize: runtimeResize,
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const controller = createOpenWebSocketMock()
    const writer = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'writer', kind: 'web', ws: writer.ws })
    registerTerminalSession(hub, 'session-exit-before-write')
    hub.attach({ clientId: 'controller', sessionId: 'session-exit-before-write' })
    hub.attach({ clientId: 'writer', sessionId: 'session-exit-before-write' })
    controller.sent.length = 0
    writer.sent.length = 0

    const resizePromise = hub.resize({
      clientId: 'controller',
      sessionId: 'session-exit-before-write',
      cols: 100,
      rows: 30,
      reason: 'frame_commit',
      operationId: 'operation-before-exit',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => {
      expect(runtimeResize).toHaveBeenCalledTimes(1)
    })

    hub.write({
      clientId: 'writer',
      sessionId: 'session-exit-before-write',
      data: 'do not write\r',
    })
    hub.handlePtyExit('session-exit-before-write', 0)
    runtimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    await resizePromise
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(runtimeWrite).not.toHaveBeenCalled()
    expect(
      writer.sent.some(message => (message as { type?: string }).type === 'control_changed'),
    ).toBe(false)
    await expect(
      hub.presentationSnapshotSession('session-exit-before-write'),
    ).resolves.toMatchObject({
      cols: 100,
      rows: 30,
    })
  })

  it('revalidates the session lease after runtime await and broadcasts a canonical correction', async () => {
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
    const controller = createOpenWebSocketMock()
    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    registerTerminalSession(hub, 'session-replaced')
    hub.attach({ clientId: 'controller', sessionId: 'session-replaced', role: 'controller' })
    controller.sent.length = 0

    const resizePromise = hub.resize({
      clientId: 'controller',
      sessionId: 'session-replaced',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-replaced-session',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => {
      expect(runtimeResize).toHaveBeenCalledTimes(1)
    })

    hub.forgetSession('session-replaced')
    registerTerminalSession(hub, 'session-replaced')
    hub.attach({ clientId: 'controller', sessionId: 'session-replaced', role: 'controller' })
    controller.sent.length = 0

    firstRuntimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )
    const result = await resizePromise

    expect(runtimeResize).toHaveBeenCalledTimes(2)
    expect(runtimeResize.mock.calls[1]![0]).toMatchObject({
      sessionId: 'session-replaced',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      operationId: 'operation-replaced-session:canonical-correction',
    })
    expect(result).toEqual({
      sessionId: 'session-replaced',
      operationId: 'operation-replaced-session',
      status: 'rejected_stale_authority',
      changed: false,
      geometry: { cols: 80, rows: 24, revision: null },
      authority: { role: 'controller', epoch: 1 },
    })
    expect(controller.sent).toContainEqual({ type: 'resize_result', ...result })
    expect(controller.sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-replaced',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
    })
    expect(
      controller.sent.some(
        message =>
          (message as { type?: string; cols?: number }).type === 'geometry' &&
          (message as { cols?: number }).cols === 120,
      ),
    ).toBe(false)
    await expect(hub.presentationSnapshotSession('session-replaced')).resolves.toMatchObject({
      cols: 80,
      rows: 24,
      geometryRevision: null,
    })
  })

  it('promotes the confirmed runtime geometry if a stale-lease correction is rejected', async () => {
    const firstRuntimeResult = createDeferred<TerminalGeometryCommitResult>()
    const onPresentationMutation = vi.fn()
    const runtimeResize = vi
      .fn<(input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>>()
      .mockImplementationOnce(async () => await firstRuntimeResult.promise)
      .mockImplementation(async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'correction-operation',
        status: 'runtime_failed',
        changed: false,
        geometry: null,
        authority: null,
      }))
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      onPresentationMutation,
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
    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    registerTerminalSession(hub, 'session-correction-failed')
    hub.attach({
      clientId: 'controller',
      sessionId: 'session-correction-failed',
      role: 'controller',
    })
    controller.sent.length = 0

    const resizePromise = hub.resize({
      clientId: 'controller',
      sessionId: 'session-correction-failed',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-correction-failed',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })
    await vi.waitFor(() => {
      expect(runtimeResize).toHaveBeenCalledTimes(1)
    })

    hub.forgetSession('session-correction-failed')
    registerTerminalSession(hub, 'session-correction-failed')
    hub.attach({
      clientId: 'controller',
      sessionId: 'session-correction-failed',
      role: 'controller',
    })
    controller.sent.length = 0
    firstRuntimeResult.resolve(
      acceptedRuntimeResize(runtimeResize.mock.calls[0]![0] as ResizeTerminalInput),
    )

    const result = await resizePromise

    expect(result).toMatchObject({
      status: 'runtime_failed',
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 1 },
    })
    expect(onPresentationMutation).toHaveBeenCalledOnce()
    expect(onPresentationMutation).toHaveBeenCalledWith('session-correction-failed')
    expect(controller.sent).toContainEqual(
      expect.objectContaining({
        type: 'geometry',
        sessionId: 'session-correction-failed',
        cols: 120,
        rows: 40,
        revision: 1,
      }),
    )
    await expect(
      hub.presentationSnapshotSession('session-correction-failed'),
    ).resolves.toMatchObject({
      cols: 120,
      rows: 40,
      geometryRevision: 1,
    })
  })
})
