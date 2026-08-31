import { describe, expect, it, vi } from 'vitest'
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
  }> = []
  const policies: Array<{ enabled: boolean; passwordRequired: boolean }> = []
  const closeFilters: unknown[] = []
  const bindFailures: Error[] = []
  let disposed = false

  const runtime: ControlSurfaceHttpRuntime = {
    token: 'token',
    appVersion: 'test',
    ready: Promise.resolve(),
    registerHandlers: () => undefined,
    listen: options => {
      const activate = vi.fn()
      const stopAccepting = vi.fn(async () => undefined)
      const listener: ControlSurfaceHttpListener = {
        ready:
          bindFailures.length > 0
            ? Promise.reject(bindFailures.shift())
            : Promise.resolve({
                hostname: options.hostname,
                bindHostname: options.bindHostname,
                port: options.port === 0 ? nextPort++ : options.port,
              }),
        activate,
        stopAccepting,
        isAccepting: () => !options.startGated || activate.mock.calls.length > 0,
        dispose: stopAccepting,
      }
      listeners.push({ options, activate, stopAccepting })
      return listener
    },
    setWebAccessPolicy: policy => policies.push(policy),
    getWebAccessPolicy: () => policies.at(-1) ?? { enabled: false, passwordRequired: false },
    rotateWebSessionGeneration: () => ({ previousGeneration: 0, generation: 1 }),
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
    wasDisposed: () => disposed,
  }
}

function expectActive(
  status: WorkerWebAccessRuntimeStatus,
): asserts status is Extract<WorkerWebAccessRuntimeStatus, { state: 'active' }> {
  expect(status.state).toBe('active')
}

describe('WorkerWebAccessRuntime', () => {
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

  it('fails closed and revokes Web clients when candidate and rollback binds both fail', async () => {
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

    expect(owner.status()).toMatchObject({ state: 'failed' })
    expect(fake.closeFilters).toContainEqual({ listenerRole: 'web' })
    expect(fake.policies.at(-1)).toEqual({ enabled: false, passwordRequired: false })
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
    expect(fake.listeners[0].stopAccepting).toHaveBeenCalledOnce()
    expect(fake.listeners[1].stopAccepting).toHaveBeenCalledOnce()
    const after = owner.status()
    expectActive(after)
    expect(after.address.port).toBe(16661)
    expect(after.address.bindHostname).toBe('127.0.0.1')
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
    expect(fake.closeFilters).toContainEqual({ listenerRole: 'web' })
    expect(fake.wasDisposed()).toBe(false)
  })
})
