import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { createAppError } from '../../../src/shared/errors/appError'
import { createReadyTerminalAdmissionDeps } from '../contexts/controlSurfaceTestTerminalAvailability'
import { deferred } from '../contexts/managedClaudeLaunchCompatibility.helpers'
import { terminalSpawnHandlerFixture } from '../../support/terminalSpawnHandlerFixture'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

it.each(
  ['plain', 'mount', 'space'].flatMap(route =>
    ['context', 'lifecycle', 'none'].map(failure => ({ route, failure })),
  ),
)(
  'checks both guards after activity preparation on $route with failure=$failure',
  async ({ route, failure }) => {
    const surface = createControlSurface()
    const state = normalizePersistedAppState({
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          path: '/repo',
          nodes: [],
          spaces: [{ id: 'space', name: 'Space', directoryPath: '/repo', nodeIds: [] }],
        },
      ],
    })!
    const entered = deferred<void>(),
      release = deferred<void>()
    const f = terminalSpawnHandlerFixture({
      surface,
      admission: createReadyTerminalAdmissionDeps().terminalSpawnAdmission,
      getStore: async () => ({ readAppState: async () => state }) as PersistenceStore,
      prepareActivity: async () => {
        entered.resolve()
        await release.promise
      },
    })
    let finishedPreparation = false
    const error = createAppError('agent.managed_launch_rejected', {
      details: { reason: 'superseded' },
    })
    const context = vi.fn(() => {
      if (finishedPreparation && failure === 'context') {
        throw error
      }
    })
    const lifecycle = vi.fn(() => {
      if (finishedPreparation && failure === 'lifecycle') {
        throw error
      }
    })
    const onSpawned = vi.fn()
    const operation = surface.invoke(
      {
        now: () => new Date(),
        assertActive: context,
        terminalSpawnLifecycle: { assertActive: lifecycle, onSpawned },
      },
      {
        kind: 'command',
        id:
          route === 'plain'
            ? 'pty.spawn'
            : route === 'mount'
              ? 'pty.spawnInMount'
              : 'session.spawnTerminal',
        payload:
          route === 'plain'
            ? { cwd: '/repo' }
            : route === 'mount'
              ? { mountId: 'pending-mount' }
              : { spaceId: 'space' },
      },
    )
    try {
      await entered.promise
      context.mockClear()
      lifecycle.mockClear()
      finishedPreparation = true
      release.resolve()
      const result = await operation
      expect(context).toHaveBeenCalledOnce()
      if (failure !== 'context') {
        expect(lifecycle).toHaveBeenCalledOnce()
      }
      if (failure === 'none') {
        expect(result).toMatchObject({ ok: true })
        expect(f.spawn).toHaveBeenCalledOnce()
        expect(f.commit).toHaveBeenCalledExactlyOnceWith('extra-shell')
        expect(onSpawned).toHaveBeenCalledExactlyOnceWith('extra-shell')
        expect(f.dispose).not.toHaveBeenCalled()
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: { code: error.code, details: error.details },
        })
        expect(f.spawn).not.toHaveBeenCalled()
        expect(f.commit).not.toHaveBeenCalled()
        expect(f.metadata).not.toHaveBeenCalled()
        expect(onSpawned).not.toHaveBeenCalled()
        expect(f.dispose).toHaveBeenCalledOnce()
      }
    } finally {
      release.resolve()
      await operation
      await f.close()
    }
  },
)
