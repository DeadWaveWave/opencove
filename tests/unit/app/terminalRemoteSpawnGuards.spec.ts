import { afterEach, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createAppError } from '../../../src/shared/errors/appError'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'
import { terminalSpawnHandlerFixture } from '../../support/terminalSpawnHandlerFixture'
import { createReadyTerminalAdmissionDeps } from '../contexts/controlSurfaceTestTerminalAvailability'
import { deferred } from '../contexts/managedClaudeLaunchCompatibility.helpers'

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: vi.fn(),
}))
afterEach(() => vi.mocked(invokeControlSurface).mockReset())

it.each(['context', 'lifecycle', 'none'])(
  'checks both guards before remote dispatch with failure=%s',
  async failure => {
    vi.mocked(invokeControlSurface).mockResolvedValue({
      httpStatus: 200,
      result: { __opencoveControlEnvelope: true, ok: true, value: { sessionId: 'remote-shell' } },
    })
    const surface = createControlSurface()
    const entered = deferred<void>(),
      release = deferred<void>()
    const f = terminalSpawnHandlerFixture({
      surface,
      admission: createReadyTerminalAdmissionDeps().terminalSpawnAdmission,
      getStore: vi.fn(),
      prepareActivity: vi.fn(),
      remote: true,
      resolveEndpoint: async () => {
        entered.resolve()
        await release.promise
      },
    })
    let resolved = false
    const error = createAppError('agent.managed_launch_rejected', {
      details: { reason: 'superseded' },
    })
    const context = vi.fn(() => {
      if (resolved && failure === 'context') {
        throw error
      }
    })
    const lifecycle = vi.fn(() => {
      if (resolved && failure === 'lifecycle') {
        throw error
      }
    })
    const pending = surface.invoke(
      {
        now: () => new Date(),
        assertActive: context,
        terminalSpawnLifecycle: { assertActive: lifecycle, onSpawned: vi.fn() },
      },
      { kind: 'command', id: 'pty.spawnInMount', payload: { mountId: 'pending-mount' } },
    )
    try {
      await entered.promise
      context.mockClear()
      lifecycle.mockClear()
      resolved = true
      release.resolve()
      const result = await pending
      expect(context).toHaveBeenCalledOnce()
      if (failure !== 'context') {
        expect(lifecycle).toHaveBeenCalledOnce()
      }
      if (failure === 'none') {
        expect(result).toMatchObject({ ok: true })
        expect(invokeControlSurface).toHaveBeenCalledOnce()
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: { code: error.code, details: error.details },
        })
        expect(invokeControlSurface).not.toHaveBeenCalled()
        expect(f.metadata).not.toHaveBeenCalled()
      }
      expect(f.spawn).not.toHaveBeenCalled()
      expect(f.activity.prepare).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await pending
      await f.close()
    }
  },
)
