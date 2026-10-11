// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { registerPluginHostHandlers } from '../../../src/app/main/controlSurface/handlers/pluginHostHandlers'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createMinimalState } from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { PluginHostPort } from '../../../src/contexts/plugins/domain/pluginHostTypes'

afterEach(() => vi.useRealTimers())
it('never dispatches an external command after its view retires during target revalidation', async () => {
  vi.useFakeTimers()
  const control = createControlSurface()
  const spawn = vi.fn(async () => ({ sessionId: 'should-not-exist' }))
  control.register('pty.spawnInMount', {
    kind: 'command',
    validate: value => value,
    handle: spawn,
    defaultErrorCode: 'common.unexpected',
  })
  let host!: PluginHostPort
  let reads = 0
  let release!: () => void
  const state = createMinimalState('/repo', 'p', 's')
  const mount = {
    mountId: 'm',
    projectId: 'p',
    endpointId: 'local',
    rootPath: '/repo',
    rootUri: 'file:///repo',
    targetId: 't',
  }
  const deps = {
    context: { now: () => new Date() },
    plugins: {
      configureHost: (port: PluginHostPort) => {
        host = port
      },
    },
    getPersistenceStore: async () => ({
      readAppState: async () => {
        if (++reads === 2) {
          await new Promise<void>(resolve => {
            release = resolve
          })
        }
        return state
      },
    }),
    topology: {
      listMounts: async () => ({ mounts: [mount] }),
      resolveMountTarget: async () => mount,
    },
    ptyRuntime: { kill: vi.fn() },
    ptyStreamHub: { listSessions: () => ({ sessions: [] }), retireSession: vi.fn() },
  } as unknown as Parameters<typeof registerPluginHostHandlers>[1]
  registerPluginHostHandlers(control, deps)
  let active = true
  await host.request(
    {
      ownerId: 'view:1',
      assertActive: () => {
        if (!active) {
          throw new Error('closed')
        }
      },
    },
    'operations.start',
    { target: { projectId: 'p' }, command: 'tool' },
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(reads).toBe(2)
  active = false
  await host.retire('view:1')
  release()
  await vi.advanceTimersByTimeAsync(250)
  expect(spawn).not.toHaveBeenCalled()
  expect(deps.ptyRuntime.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
