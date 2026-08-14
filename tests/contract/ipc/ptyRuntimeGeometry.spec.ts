import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'

type PtyDataHandler = (event: { sessionId: string; data: string }) => void
type PtyExitHandler = (event: { sessionId: string; exitCode: number }) => void

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Pty runtime geometry', () => {
  it('returns the geometry acknowledged by the headless PTY host', async () => {
    vi.resetModules()

    const resize = vi.fn(async () => ({
      sessionId: 'session-ack',
      status: 'applied_verified' as const,
      cols: 91,
      rows: 27,
    }))

    class MockPtyHostSupervisor {
      public resize = resize
      public dispose = vi.fn()
      public spawn = vi.fn()
      public write = vi.fn()
      public kill = vi.fn()
      public crash = vi.fn()

      public onData(_handler: PtyDataHandler): () => void {
        return () => undefined
      }

      public onForeground(): () => void {
        return () => undefined
      }

      public onExit(_handler: PtyExitHandler): () => void {
        return () => undefined
      }
    }

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')
    const runtime = createHeadlessPtyRuntime({ userDataPath: '/tmp/opencove-headless-test' })

    await expect(
      runtime.resize({
        sessionId: 'session-ack',
        cols: 120,
        rows: 40,
        reason: 'frame_commit',
        operationId: 'operation-host-ack',
        baseGeometryRevision: null,
      }),
    ).resolves.toEqual({
      sessionId: 'session-ack',
      operationId: 'operation-host-ack',
      status: 'accepted',
      changed: true,
      geometry: { cols: 91, rows: 27, revision: null },
      authority: null,
    })

    expect(resize).toHaveBeenCalledWith('session-ack', 120, 40)
    runtime.dispose()
  })

  it('reports an issued but unverified ConPTY resize without echoing the request', async () => {
    vi.resetModules()

    class MockPtyHostSupervisor {
      public resize = vi.fn(async (sessionId: string) => ({
        sessionId,
        status: 'applied_unverified' as const,
      }))
      public dispose = vi.fn()
      public spawn = vi.fn()
      public write = vi.fn()
      public kill = vi.fn()
      public crash = vi.fn()

      public onData(_handler: PtyDataHandler): () => void {
        return () => undefined
      }

      public onForeground(): () => void {
        return () => undefined
      }

      public onExit(_handler: PtyExitHandler): () => void {
        return () => undefined
      }
    }

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')
    const runtime = createHeadlessPtyRuntime({ userDataPath: '/tmp/opencove-headless-test' })

    await expect(
      runtime.resize({
        sessionId: 'session-unverified',
        cols: 120,
        rows: 40,
        reason: 'frame_commit',
        operationId: 'operation-unverified',
        baseGeometryRevision: null,
      }),
    ).resolves.toEqual({
      sessionId: 'session-unverified',
      operationId: 'operation-unverified',
      status: 'accepted_unverified',
      changed: false,
      geometry: null,
      authority: null,
    })

    runtime.dispose()
  })

  it('does not forward unchanged geometry to the PTY host', async () => {
    vi.resetModules()

    const send = vi.fn()
    const resize = vi.fn(async (sessionId: string) => ({
      sessionId,
      status: 'applied_verified' as const,
      cols: 91,
      rows: 27,
    }))
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = resize
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-1' }))

      public onData(_handler: PtyDataHandler): void {}

      public onForeground(): () => void {
        return () => undefined
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })

    const unchangedInitial = await runtime.resize({
      sessionId,
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      operationId: 'operation-initial',
      baseGeometryRevision: null,
    })

    expect(resize).not.toHaveBeenCalled()
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([])
    expect(unchangedInitial).toEqual({
      sessionId,
      operationId: 'operation-initial',
      status: 'accepted',
      changed: false,
      geometry: { cols: 80, rows: 24, revision: null },
      authority: { role: 'controller', epoch: 1 },
    })

    const accepted = await runtime.resize({
      sessionId,
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-1',
      baseGeometryRevision: null,
    })

    expect(resize).toHaveBeenCalledWith(sessionId, 100, 32)
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([
      [
        IPC_CHANNELS.ptyGeometry,
        { sessionId, cols: 91, rows: 27, reason: 'frame_commit', revision: 1 },
      ],
    ])
    expect(accepted).toEqual({
      sessionId,
      operationId: 'operation-1',
      status: 'accepted',
      changed: true,
      geometry: { cols: 91, rows: 27, revision: 1 },
      authority: { role: 'controller', epoch: 1 },
    })

    resize.mockClear()
    send.mockClear()

    const unchanged = await runtime.resize({
      sessionId,
      cols: 91,
      rows: 27,
      reason: 'frame_commit',
      operationId: 'operation-2',
      baseGeometryRevision: 1,
    })

    expect(resize).not.toHaveBeenCalled()
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([])
    expect(unchanged).toEqual({
      sessionId,
      operationId: 'operation-2',
      status: 'accepted',
      changed: false,
      geometry: { cols: 91, rows: 27, revision: 1 },
      authority: { role: 'controller', epoch: 1 },
    })

    send.mockClear()

    const superseded = await runtime.resize({
      sessionId,
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-stale',
      baseGeometryRevision: null,
    })

    expect(resize).not.toHaveBeenCalled()
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([])
    expect(superseded).toEqual({
      sessionId,
      operationId: 'operation-stale',
      status: 'superseded',
      changed: false,
      geometry: { cols: 91, rows: 27, revision: 1 },
      authority: { role: 'controller', epoch: 1 },
    })

    runtime.dispose()
  })

  it('does not recreate presentation state when kill wins during a runtime resize', async () => {
    vi.resetModules()

    const send = vi.fn()
    const runtimeResize = createDeferred<void>()
    const resize = vi.fn(async () => await runtimeResize.promise)
    const content = {
      isDestroyed: () => false,
      getType: () => 'window',
      send,
      once: vi.fn(),
    }

    class MockPtyHostSupervisor {
      public write = vi.fn()
      public resize = resize
      public kill = vi.fn()
      public dispose = vi.fn()
      public crash = vi.fn()
      public spawn = vi.fn(async () => ({ sessionId: 'session-killed-during-resize' }))

      public onData(_handler: PtyDataHandler): void {}

      public onForeground(): () => void {
        return () => undefined
      }

      public onExit(_handler: PtyExitHandler): void {}
    }

    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => '/tmp/opencove-test-userdata'),
      },
      utilityProcess: {
        fork: vi.fn(),
      },
      webContents: {
        getAllWebContents: () => [content],
        fromId: (id: number) => (id === 1 ? content : null),
      },
    }))

    vi.doMock('../../../src/platform/process/ptyHost/supervisor', () => ({
      PtyHostSupervisor: MockPtyHostSupervisor,
    }))

    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')

    const runtime = createPtyRuntime()
    const { sessionId } = await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24 })
    const resizePromise = runtime.resize({
      sessionId,
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-killed-during-resize',
      baseGeometryRevision: null,
    })
    await vi.waitFor(() => {
      expect(resize).toHaveBeenCalledWith(sessionId, 100, 32)
    })

    await runtime.kill(sessionId)
    runtimeResize.resolve(undefined)

    await expect(resizePromise).resolves.toEqual({
      sessionId,
      operationId: 'operation-killed-during-resize',
      status: 'session_not_found',
      changed: false,
      geometry: null,
      authority: null,
    })
    await expect(runtime.presentationSnapshot(sessionId)).rejects.toThrow(
      `Unknown terminal session: ${sessionId}`,
    )
    expect(send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.ptyGeometry)).toEqual([])

    runtime.dispose()
  })
})
