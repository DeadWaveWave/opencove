import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import { PtyHostSessionEventOwner } from '../../../src/platform/process/ptyHost/ptyHostSessionEventOwner'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it.each([false, true])(
  'keeps descendant cleanup after natural exit exclusive to generic stops (agentOnly=%s)',
  async agentOnly => {
    const emitExit = vi.fn()
    const owner = new PtyHostSessionEventOwner({ emitData() {}, emitExit, retireUnowned() {} })
    owner.resolveSpawn('session', true)
    owner.observeExit({ sessionId: 'session', exitCode: 0 })
    const descendants = new Set(['owned-child'])
    const kill = vi.fn((sessionId: string) => {
      if (owner.beginTermination(sessionId)) {
        descendants.clear()
      }
    })
    const store = createInMemoryPersistenceStore()
    const state = createMinimalState('/repo', 'project', 'space')
    state.workspaces[0].nodes = [
      {
        id: 'node',
        kind: 'agent',
        sessionId: 'session',
        title: 'Reviewer',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        status: 'exited',
        startedAt: null,
        endedAt: null,
        exitCode: 0,
        lastError: null,
        agent: null,
        task: null,
        scrollback: null,
        labelColorOverride: null,
      },
    ]
    await store.writeAppState(state)
    const control = createControlSurface()
    registerSessionInputHandlers(control, {
      getPersistenceStore: async () => store,
      ptyRuntime: { kill },
      ptyStreamHub: {
        isSessionActive: () => false,
        observeAgentState: () => ({ nodeId: 'node', sessionId: 'session', state: 'exited' }),
      } as unknown as PtyStreamHub,
    })
    const result = await control.invoke(
      { now: () => new Date() },
      {
        id: 'session.stopNode',
        kind: 'command',
        payload: {
          nodeId: 'node',
          sessionId: 'session',
          ...(agentOnly ? { agentOnly: true } : {}),
        },
      },
    )
    expect(result).toMatchObject({ ok: true, value: { stopped: !agentOnly } })
    expect(kill).toHaveBeenCalledTimes(agentOnly ? 0 : 1)
    expect(descendants.size).toBe(agentOnly ? 1 : 0)
    expect(emitExit).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', exitCode: 0 })
    expect(await store.readAppState()).toEqual(state)
  },
)
