import { expect, it, vi } from 'vitest'
import { compatibilityFixture, context, deferred } from './managedClaudeLaunchCompatibility.helpers'
import { terminalSpawnHandlerFixture } from '../../support/terminalSpawnHandlerFixture'
import { spawnPreparedFallbackTerminal } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveTerminalSpawn'
import { createAppError } from '../../../src/shared/errors/appError'

it.each(['active', 'execution'] as const)(
  'retains the caller lifecycle %s guard inside managed fallback',
  async fence => {
    const f = compatibilityFixture({ enabled: true, live: false })
    const entered = deferred<void>(),
      release = deferred<void>()
    const pty = terminalSpawnHandlerFixture({
      surface: f.surface,
      getStore: f.getPersistenceStore,
      admission: f.admission.terminalSpawnAdmission,
      prepareActivity: async () => {
        if (fence === 'active') {
          entered.resolve()
          await release.promise
        }
      },
    })
    await f.runtime.ready()
    await f.store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'A',
      runtimeSessionId: null,
      tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    })
    let active = true
    const error = createAppError('agent.managed_launch_rejected', {
      details: { reason: 'superseded' },
    })
    const assertActive = vi.fn(() => {
      if (!active) {
        throw error
      }
    })
    const assertExecution = vi.fn(() => {
      if (fence === 'execution') {
        throw error
      }
    })
    const workspace = f.state.workspaces[0]
    const pending = f.runtime.withPreparation(f.runtime.owner.reserve('agent'), () =>
      spawnPreparedFallbackTerminal({
        controlSurface: f.surface,
        ctx: {
          ...context,
          terminalSpawnLifecycle: { assertActive, assertExecution, onSpawned: vi.fn() },
        },
        workspace,
        node: workspace.nodes[0],
        space: null,
        cwd: '/repo',
        profileId: null,
        launchContext: {
          resolution: 'resolved',
          endpointId: 'local',
          mountId: null,
          workingDirectory: '/repo',
          workerBinding: { endpointId: 'local', mountId: null },
          reason: 'fixture',
        },
      }),
    )
    try {
      if (fence === 'active') {
        await entered.promise
        active = false
        release.resolve()
      }
      await expect(pending).rejects.toMatchObject({ code: error.code, details: error.details })
      expect(pty.spawn).not.toHaveBeenCalled()
      expect(pty.commit).not.toHaveBeenCalled()
      expect(pty.metadata).not.toHaveBeenCalled()
      if (fence === 'active') {
        expect(pty.dispose).toHaveBeenCalledOnce()
      } else {
        expect(assertExecution).toHaveBeenCalledOnce()
      }
    } finally {
      release.resolve()
      await pending.catch(() => {})
      await pty.close()
      f.runtime.dispose()
    }
  },
)
