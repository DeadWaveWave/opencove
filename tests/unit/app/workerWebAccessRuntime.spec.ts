import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkerWebAccessRuntime,
  type WorkerWebAccessRuntimeStatus,
} from '../../../src/app/worker/workerWebAccessRuntime'
import type { HomeWorkerConfigFile } from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import type {
  ControlSurfaceHttpListener,
  ControlSurfaceHttpListenerOptions,
  ControlSurfaceHttpRuntime,
} from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime.contract'

function config(overrides: Partial<HomeWorkerConfigFile['webUi']> = {}): HomeWorkerConfigFile {
  return {
    version: 1,
    mode: 'local',
    remote: null,
    webUi: {
      enabled: false,
      port: null,
      exposeOnLan: false,
      passwordHash: null,
      ...overrides,
    },
    updatedAt: '2026-08-31T00:00:00.000Z',
  }
}

function createFakeRuntime() {
  let nextPort = 20_000
  const listeners: Array<{
    options: ControlSurfaceHttpListenerOptions
    activate: ReturnType<typeof vi.fn>
    stopAccepting: ReturnType<typeof vi.fn>
    updateWebUiPasswordHash: ReturnType<typeof vi.fn>
    closeStreamingClients: ReturnType<typeof vi.fn>
    drainAcceptedRequests: ReturnType<typeof vi.fn>
  }> = []
  const policies: Array<{ enabled: boolean; passwordRequired: boolean }> = []
  const closeFilters: unknown[] = []
  const bindFailures: Error[] = []
  const deferredBinds: Array<{
    resolve: (address: { hostname: string; bindHostname: string; port: number }) => void
    reject: (error: Error) => void
  }> = []
  let deferBind = false
  let sessionGeneration = 0
  let disposed = false

  const runtime: ControlSurfaceHttpRuntime = {
    token: 'token',
    appVersion: 'test',
    ready: Promise.resolve(),
    registerHandlers: () => undefined,
    listen: options => {
      const activate = vi.fn()
      const stopAccepting = vi.fn(async () => undefined)
      const updateWebUiPasswordHash = vi.fn()
      const closeStreamingClients = vi.fn()
      const drainAcceptedRequests = vi.fn(async () => undefined)
      const address = {
        hostname: options.hostname,
        bindHostname: options.bindHostname,
        port: options.port === 0 ? nextPort++ : options.port,
      }
      const ready = deferBind
        ? new Promise<typeof address>((resolve, reject) => {
            deferredBinds.push({ resolve, reject })
          })
        : bindFailures.length > 0
          ? Promise.reject(bindFailures.shift())
          : Promise.resolve(address)
      deferBind = false
      const listener: ControlSurfaceHttpListener = {
        ready,
        activate,
        stopAccepting,
        updateWebUiPasswordHash,
        closeStreamingClients,
        drainAcceptedRequests,
        isAccepting: () => !options.startGated || activate.mock.calls.length > 0,
        dispose: stopAccepting,
      }
      listeners.push({
        options,
        activate,
        stopAccepting,
        updateWebUiPasswordHash,
        closeStreamingClients,
        drainAcceptedRequests,
      })
      return listener
    },
    setWebAccessPolicy: policy => policies.push(policy),
    getWebAccessPolicy: () => policies.at(-1) ?? { enabled: false, passwordRequired: false },
    rotateWebSessionGeneration: () => {
      const previousGeneration = sessionGeneration
      sessionGeneration += 1
      return { previousGeneration, generation: sessionGeneration }
    },
    closePtyStreamClients: filter => {
      closeFilters.push(filter)
      return 1
    },
    getPtyStreamInstanceId: () => 'stream-instance',
    dispose: async () => {
      disposed = true
    },
  }

  return {
    runtime,
    listeners,
    policies,
    closeFilters,
    failNextBind: (error: Error) => {
      bindFailures.push(error)
    },
    deferNextBind: () => {
      deferBind = true
    },
    resolveDeferredBind: () => {
      const deferred = deferredBinds.shift()
      deferred?.resolve({ hostname: '127.0.0.1', bindHostname: '127.0.0.1', port: 16661 })
    },
    wasDisposed: () => disposed,
  }
}

function expectActive(
  status: WorkerWebAccessRuntimeStatus,
): asserts status is Extract<WorkerWebAccessRuntimeStatus, { state: 'active' }> {
  expect(status.state).toBe('active')
}

describe('WorkerWebAccessRuntime', () => {
  afterEach(() => vi.useRealTimers())
  it('warms and activates an enabled listener only after durable persistence', async () => {
    const fake = createFakeRuntime()
    const events: string[] = []
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config(),
      persist: async ({ next }) => {
        events.push('persist')
        return { ...next, updatedAt: '2026-08-31T00:00:01.000Z' }
      },
    })
    await owner.ready

    const result = await owner.apply({
      next: config({ enabled: true, port: 16661 }),
      expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
    })

    expect(result.config.updatedAt).toBe('2026-08-31T00:00:01.000Z')
    expect(fake.listeners).toHaveLength(1)
    expect(fake.listeners[0].options).toMatchObject({
      role: 'web',
      port: 16661,
      startGated: true,
    })
    expect(events).toEqual(['persist'])
    expect(fake.listeners[0].activate).toHaveBeenCalledOnce()
    expectActive(result.status)
    expect(result.status.address.port).toBe(16661)
    expect(fake.wasDisposed()).toBe(false)
  })

  it('joins an in-flight startup listener before dispose resolves', async () => {
    const fake = createFakeRuntime()
    fake.deferNextBind()
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({ enabled: true, port: 16661 }),
      persist: async ({ next }) => next,
    })

    await Promise.resolve()
    expect(fake.listeners).toHaveLength(1)
    const disposal = owner.dispose()
    fake.resolveDeferredBind()
    await disposal
    await owner.ready

    expect(fake.listeners).toHaveLength(1)
    expect(fake.listeners[0].activate).not.toHaveBeenCalled()
    expect(fake.listeners[0].stopAccepting).toHaveBeenCalled()
    expect(owner.status().state).toBe('disabled')
  })

  it('retries the same desired config after its startup listener failed', async () => {
    const fake = createFakeRuntime()
    fake.failNextBind(new Error('startup bind failed'))
    const persist = vi.fn(async ({ next }: { next: HomeWorkerConfigFile }) => ({
      ...next,
      updatedAt: '2026-08-31T00:00:01.000Z',
    }))
    const desired = config({ enabled: true, port: 16661 })
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: desired,
      persist,
    })
    expect((await owner.ready).state).toBe('failed')

    const retried = await owner.apply({
      next: desired,
      expectedUpdatedAt: desired.updatedAt,
    })

    expectActive(retried.status)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('keeps the active listener and skips persistence when candidate bind fails', async () => {
    const fake = createFakeRuntime()
    const persist = vi.fn(async ({ next }: { next: HomeWorkerConfigFile }) => next)
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({ enabled: true, port: 16661 }),
      persist,
    })
    const before = await owner.ready
    expectActive(before)
    fake.failNextBind(new Error('EADDRINUSE'))

    await expect(
      owner.apply({
        next: config({ enabled: true, port: 16662 }),
        expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
      }),
    ).rejects.toThrow('EADDRINUSE')

    expect(persist).not.toHaveBeenCalled()
    const after = owner.status()
    expectActive(after)
    expect(after.address).toEqual(before.address)
    expect(fake.listeners[0].stopAccepting).not.toHaveBeenCalled()
  })

  it('keeps durable authority and upgraded clients when candidate and rollback binds both fail', async () => {
    const fake = createFakeRuntime()
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({ enabled: true, port: 16661 }),
      persist: async ({ next }) => next,
    })
    await owner.ready
    fake.failNextBind(new Error('candidate failed'))
    fake.failNextBind(new Error('rollback failed'))

    await expect(
      owner.apply({
        next: config({
          enabled: true,
          port: 16661,
          exposeOnLan: true,
          passwordHash: 'scrypt$test',
        }),
        expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
      }),
    ).rejects.toThrow('rollback failed')

    expect(owner.status()).toMatchObject({
      state: 'degraded',
      generation: 1,
      address: { port: 16661 },
      passwordRequired: false,
    })
    expect(fake.closeFilters).not.toContainEqual({ listenerRole: 'web' })
    expect(fake.listeners[0].closeStreamingClients).not.toHaveBeenCalled()
    expect(fake.policies.at(-1)).toEqual({ enabled: true, passwordRequired: false })
    await owner.dispose()
  })

  it('restores degraded same-port admission without changing the authoritative generation', async () => {
    vi.useFakeTimers()
    const fake = createFakeRuntime()
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({ enabled: true, port: 16661 }),
      persist: async ({ next }) => next,
    })
    await owner.ready
    fake.failNextBind(new Error('candidate failed'))
    fake.failNextBind(new Error('rollback failed'))

    await expect(
      owner.apply({
        next: config({
          enabled: true,
          port: 16661,
          exposeOnLan: true,
          passwordHash: 'scrypt$test',
        }),
        expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
      }),
    ).rejects.toThrow('rollback failed')
    expect(owner.status()).toMatchObject({ state: 'degraded', generation: 1 })

    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()
    expect(owner.status()).toMatchObject({ state: 'active', generation: 1 })
    await owner.dispose()
  })

  it('updates password admission in place without replacing the listener', async () => {
    const fake = createFakeRuntime()
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({
        enabled: true,
        port: 16661,
        exposeOnLan: true,
        passwordHash: 'scrypt$one',
      }),
      persist: async ({ next }) => ({ ...next, updatedAt: '2026-08-31T00:00:01.000Z' }),
    })
    await owner.ready

    const result = await owner.apply({
      next: config({
        enabled: true,
        port: 16661,
        exposeOnLan: true,
        passwordHash: 'scrypt$two',
      }),
      expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
    })

    expect(result.config.updatedAt).toBe('2026-08-31T00:00:01.000Z')
    expect(fake.listeners).toHaveLength(1)
    expect(fake.listeners[0].stopAccepting).not.toHaveBeenCalled()
    expect(fake.listeners[0].updateWebUiPasswordHash).toHaveBeenCalledWith('scrypt$two')
    expect(fake.closeFilters).toContainEqual({ webSessionGeneration: 0 })
  })

  it('rolls back a same-port replacement when persistence fails', async () => {
    const fake = createFakeRuntime()
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({ enabled: true, port: 16661 }),
      persist: async () => {
        throw new Error('injected persistence failure')
      },
    })
    await owner.ready

    await expect(
      owner.apply({
        next: config({
          enabled: true,
          port: 16661,
          exposeOnLan: true,
          passwordHash: 'scrypt$test',
        }),
        expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
      }),
    ).rejects.toThrow('injected persistence failure')

    expect(fake.listeners).toHaveLength(3)
    expect(fake.listeners[0].stopAccepting).toHaveBeenCalledWith({
      preserveStreamingClients: true,
      drainTimeoutMs: 30_000,
    })
    expect(fake.listeners[1].stopAccepting).toHaveBeenCalledOnce()
    const after = owner.status()
    expectActive(after)
    expect(after.address.port).toBe(16661)
    expect(after.address.bindHostname).toBe('127.0.0.1')
    expect(fake.listeners[0].closeStreamingClients).not.toHaveBeenCalled()
    await owner.dispose()
    expect(fake.listeners[0].closeStreamingClients).toHaveBeenCalled()
  })

  it('disables Web access by revoking Web clients without disposing Control Surface runtime', async () => {
    const fake = createFakeRuntime()
    const owner = createWorkerWebAccessRuntime({
      controlSurfaceRuntime: fake.runtime,
      initialConfig: config({ enabled: true, port: 16661 }),
      persist: async ({ next }) => next,
    })
    const before = await owner.ready
    expectActive(before)

    const result = await owner.apply({
      next: config({ enabled: false, port: 16661 }),
      expectedUpdatedAt: '2026-08-31T00:00:00.000Z',
    })

    expect(result.status.state).toBe('disabled')
    expect(fake.listeners[0].stopAccepting).toHaveBeenCalledWith({ drainTimeoutMs: 0 })
    expect(fake.closeFilters).toContainEqual({ listenerRole: 'web' })
    expect(fake.wasDisposed()).toBe(false)
  })
})
