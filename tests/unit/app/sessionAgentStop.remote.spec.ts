// @vitest-environment node
import { setImmediate } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import { RemotePtyEndpointProxy } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy'
import {
  invokeControlSurface,
  type ControlSurfaceRemoteEndpoint,
} from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: vi.fn(async () => ({ result: { ok: true } })),
}))

it.each(['runtime route', 'durable binding'] as const)(
  'refuses remote agent-only stopping before delayed endpoint dispatch: %s',
  async remoteEvidence => {
    vi.mocked(invokeControlSurface).mockClear()
    let release!: (endpoint: ControlSurfaceRemoteEndpoint) => void
    const endpoint = new Promise<ControlSurfaceRemoteEndpoint>(resolve => {
      release = resolve
    })
    const resolveRemoteEndpointConnection = vi.fn(() => endpoint)
    const proxy = new RemotePtyEndpointProxy({
      endpointId: 'remote',
      topology: { resolveRemoteEndpointConnection } as unknown as WorkerTopologyStore,
      emitData() {},
      emitExit() {},
      emitForeground() {},
      emitState() {},
      emitMetadata() {},
      emitPresentationReset: async () => {},
      emitPresentationResetCommitted() {},
    })
    const store = createInMemoryPersistenceStore()
    const state = createMinimalState('/repo', 'project', 'space')
    state.workspaces[0].nodes = [
      {
        id: 'node',
        kind: 'terminal',
        sessionId: 'home-session',
        title: 'Reviewer',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        status: 'running',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        agent: null,
        task: null,
        scrollback: null,
        labelColorOverride: null,
        ...(remoteEvidence === 'durable binding'
          ? { workerBinding: { endpointId: 'remote', mountId: 'mount' } }
          : {}),
      },
    ]
    await store.writeAppState(state)
    let agentState = 'idle'
    const kill = vi.fn(() => proxy.kill('executing-session'))
    const control = createControlSurface()
    registerSessionInputHandlers(control, {
      getPersistenceStore: async () => store,
      ptyRuntime: {
        kill,
        getSessionRoute: () =>
          remoteEvidence === 'runtime route'
            ? { kind: 'remote', endpointId: 'remote', remoteSessionId: 'executing-session' }
            : null,
      },
      ptyStreamHub: {
        isSessionActive: () => true,
        observeAgentState: () => ({ nodeId: 'node', sessionId: 'home-session', state: agentState }),
      } as unknown as PtyStreamHub,
    })
    try {
      const result = await control.invoke(
        { now: () => new Date() },
        {
          id: 'session.stopNode',
          kind: 'command',
          payload: { nodeId: 'node', sessionId: 'home-session', agentOnly: true },
        },
      )
      // The executing agent exits while an old unconditional proxy call would still be queued.
      agentState = 'exited'
      release({ baseUrl: 'http://unused.invalid', token: 'test' })
      await setImmediate()
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'node.unsupported_operation',
          debugMessage: expect.stringContaining('remote'),
        },
      })
      expect(kill).not.toHaveBeenCalled()
      expect(resolveRemoteEndpointConnection).not.toHaveBeenCalled()
      expect(invokeControlSurface).not.toHaveBeenCalled()
      expect(await store.readAppState()).toEqual(state)
    } finally {
      release({ baseUrl: 'http://unused.invalid', token: 'test' })
      proxy.dispose()
    }
  },
)
