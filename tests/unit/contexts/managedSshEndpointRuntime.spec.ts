import { EventEmitter } from 'node:events'
import type { ExecutableLocationResult } from '../../../src/platform/process/ExecutableLocator'
import type { ManagedSshEndpointRuntimeAccess } from '../../../src/app/main/controlSurface/topology/topologyEndpointAccess'
import { createManagedSshEndpointRuntime } from '../../../src/app/main/controlSurface/topology/managedSshEndpointRuntime'

import { describe, expect, it, vi } from 'vitest'

type MockTunnelProcess = EventEmitter & {
  exitCode: number | null
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createAccess(): ManagedSshEndpointRuntimeAccess {
  return {
    endpointId: 'managed-1',
    displayName: 'SSH Box',
    token: 'managed-token',
    ssh: {
      host: 'example.com',
      port: 22,
      username: 'ubuntu',
      remotePort: 39291,
      remotePlatform: 'auto',
    },
  }
}

function createSshAvailability(
  overrides: Partial<ExecutableLocationResult> = {},
): ExecutableLocationResult {
  return {
    toolId: 'ssh',
    command: 'ssh',
    executablePath: '/usr/bin/ssh',
    source: 'path',
    status: 'resolved',
    diagnostics: [],
    ...overrides,
  }
}

function createTunnelProcess(): MockTunnelProcess {
  const process = new EventEmitter() as MockTunnelProcess
  process.exitCode = null
  process.stderr = new EventEmitter()
  process.kill = vi.fn(() => {
    process.exitCode = 0
    process.emit('exit', 0)
    return true
  })
  return process
}

describe('managedSshEndpointRuntime', () => {
  it('returns an error snapshot when ssh is unavailable', async () => {
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () =>
        createSshAvailability({
          executablePath: null,
          source: null,
          status: 'not_found',
          diagnostics: ['ssh is not installed'],
        }),
    })

    const prepared = await runtime.prepare(createAccess())

    expect(prepared.connection).toBeNull()
    expect(prepared.bootstrapRan).toBe(false)
    expect(prepared.snapshot.status).toBe('error')
    expect(prepared.snapshot.lastError).toContain('ssh is not installed')
  })

  it('reuses the same in-flight prepare call for concurrent requests', async () => {
    const tunnelProcess = createTunnelProcess()
    let releaseWait: (() => void) | null = null

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41001,
      spawnTunnelProcess: vi.fn(() => tunnelProcess),
      probeConnection: async () => true,
      waitForCondition: async fn => {
        await new Promise<void>(resolve => {
          releaseWait = resolve
        })
        return await fn()
      },
    })

    const firstPromise = runtime.prepare(createAccess())
    const secondPromise = runtime.prepare(createAccess())

    await new Promise(resolve => setTimeout(resolve, 0))
    releaseWait?.()

    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).toEqual(second)
    expect(first.connection).toEqual({
      hostname: '127.0.0.1',
      port: 41001,
      token: 'managed-token',
    })
  })

  it('runs bootstrap and reconnects when the remote worker is not ready yet', async () => {
    const firstTunnel = createTunnelProcess()
    const secondTunnel = createTunnelProcess()
    const probeConnection = vi
      .fn<[{ hostname: string; port: number; token: string }, number], Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const runBootstrap = vi.fn(async () => undefined)

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: vi.fn(async () => 41002),
      spawnTunnelProcess: vi
        .fn()
        .mockReturnValueOnce(firstTunnel)
        .mockReturnValueOnce(secondTunnel),
      probeConnection,
      runBootstrap,
      waitForCondition: async fn => await fn(),
    })

    const prepared = await runtime.prepare(createAccess(), {
      allowBootstrap: true,
    })

    expect(runBootstrap).toHaveBeenCalledTimes(1)
    expect(prepared.bootstrapRan).toBe(true)
    expect(prepared.connection).toEqual({
      hostname: '127.0.0.1',
      port: 41002,
      token: 'managed-token',
    })
    expect(firstTunnel.kill).toHaveBeenCalledTimes(1)
  })

  it('restarts the tunnel when reconnect is requested', async () => {
    const firstTunnel = createTunnelProcess()
    const secondTunnel = createTunnelProcess()

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: vi.fn().mockResolvedValueOnce(41003).mockResolvedValueOnce(41004),
      spawnTunnelProcess: vi
        .fn()
        .mockReturnValueOnce(firstTunnel)
        .mockReturnValueOnce(secondTunnel),
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
    })

    await runtime.prepare(createAccess())
    const restarted = await runtime.prepare(createAccess(), {
      restartTunnel: true,
    })

    expect(firstTunnel.kill).toHaveBeenCalledTimes(1)
    expect(restarted.connection).toEqual({
      hostname: '127.0.0.1',
      port: 41004,
      token: 'managed-token',
    })
  })

  it('records an error snapshot when the tunnel exits unexpectedly', async () => {
    const tunnelProcess = createTunnelProcess()

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41005,
      spawnTunnelProcess: vi.fn(() => tunnelProcess),
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
    })

    await runtime.prepare(createAccess())
    tunnelProcess.stderr.emit('data', Buffer.from('broken pipe\n'))
    tunnelProcess.exitCode = 255
    tunnelProcess.emit('exit', 255)

    expect(runtime.getSnapshot('managed-1')).toMatchObject({
      endpointId: 'managed-1',
      status: 'error',
      localPort: null,
      lastError: 'broken pipe',
    })
  })
})
