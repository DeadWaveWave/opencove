import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerSessionFinalMessageHandler } from '../../../src/app/main/controlSurface/handlers/sessionFinalMessageHandler'
import { createSessionNodeResolver } from '../../../src/app/main/controlSurface/handlers/sessionNodeResolver'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

const remote = vi.hoisted(() => ({ emitExit: (_id: string, _code: number) => {} }))
vi.mock('../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy', () => ({
  RemotePtyEndpointProxy: class {
    constructor(options: { emitExit: typeof remote.emitExit }) {
      remote.emitExit = options.emitExit
    }
    attach() {}
    forget() {}
    dispose() {}
    getReplayCursor() {
      return 7
    }
  },
}))
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: vi.fn(async () => ({
    result: {
      ok: true,
      value: {
        sessionId: 'remote-session',
        provider: 'codex',
        startedAt: '2026-03-27T00:00:00.000Z',
        cwd: '/repo',
        resumeSessionId: 'conversation',
        message: 'remote done',
      },
    },
  })),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
  resolveSessionFilePath: vi.fn(async () => '/fixture/transcript'),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage', () => ({
  readLastAssistantMessageFromSessionFile: vi.fn(async () => 'local done'),
}))

function fixture(endpointId: string, binding: boolean) {
  const node = {
    id: 'node',
    kind: 'agent',
    sessionId: 'local-session',
    startedAt: '2026-03-27T00:00:00.000Z',
    ...(binding ? { workerBinding: { endpointId, mountId: 'mount' } } : {}),
    agent: { provider: 'codex', executionDirectory: '/repo', resumeSessionId: 'conversation' },
  }
  const store = {
    readAppState: async () => ({
      formatVersion: 1,
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          path: '/repo',
          nodes: [node],
          spaces: [
            {
              id: 'space',
              name: 'Space',
              directoryPath: '/repo',
              targetMountId: 'mount',
              nodeIds: ['node'],
            },
          ],
        },
      ],
      settings: {},
    }),
  } as PersistenceStore
  const endpoint = { baseUrl: 'http://unused.invalid', token: 'fixture' }
  const topology = {
    listMounts: async () => ({
      mounts: [{ mountId: 'mount', endpointId, rootPath: '/repo', rootUri: 'file:///repo' }],
    }),
    resolveRemoteEndpointConnection: vi.fn(async () => endpoint),
  } as unknown as WorkerTopologyStore
  let localExit = (_event: { sessionId: string; exitCode: number }) => {}
  const runtime = createMultiEndpointPtyRuntime({
    topology,
    disposeLocalRuntime: false,
    localRuntime: {
      spawnSession: async () => ({ sessionId: 'local-session' }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: listener => {
        localExit = listener
        return () => {}
      },
    },
  })
  const resolveNode = createSessionNodeResolver({
    getPersistenceStore: async () => store,
    topology,
    ptyRuntime: runtime,
    ptyStreamHub: { getSessionMetadata: () => null } as unknown as PtyStreamHub,
  })
  const createHandler = () => {
    const surface = createControlSurface()
    registerSessionFinalMessageHandler(surface, { sessions: new Map(), topology, resolveNode })
    return () =>
      surface.invoke({} as ControlSurfaceContext, {
        kind: 'query',
        id: 'session.finalMessage',
        payload: { nodeId: 'node' },
      })
  }
  return {
    node,
    runtime,
    resolveNode,
    createHandler,
    exitLocal: () => localExit({ sessionId: node.sessionId, exitCode: 0 }),
    endpoint,
  }
}

describe('node transcript route lifetime', () => {
  afterEach(() => vi.clearAllMocks())

  it('queries a completed remote agent while its live recovery route stays retired', async () => {
    const f = fixture('remote-worker', true)
    try {
      f.node.sessionId = f.runtime.registerRemoteSession({
        endpointId: 'remote-worker',
        remoteSessionId: 'remote-session',
      })
      remote.emitExit('remote-session', 0)
      await expect(f.runtime.resolveRecoveryRoute(f.node.sessionId, 'home')).resolves.toBeNull()
      expect(await f.createHandler()()).toMatchObject({
        ok: true,
        value: { sessionId: f.node.sessionId, message: 'remote done' },
      })
      expect(invokeControlSurface).toHaveBeenCalledWith(f.endpoint, {
        kind: 'query',
        id: 'session.finalMessageForNode',
        payload: { sessionId: 'remote-session' },
      })
      expect(resolveSessionFilePath).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
    expect(f.runtime.getSessionRoute?.(f.node.sessionId)).toBeNull()
  })

  it('queries a binding-absent local mounted agent after exit and handler restart', async () => {
    const f = fixture('local', false)
    try {
      await f.runtime.spawnSession({
        cwd: '/repo',
        command: 'fixture',
        args: [],
        cols: 80,
        rows: 24,
      })
      const query = f.createHandler()
      f.exitLocal()
      await expect(f.runtime.resolveRecoveryRoute(f.node.sessionId, 'home')).resolves.toBeNull()
      expect(await query()).toMatchObject({ ok: true, value: { message: 'local done' } })
      expect(await f.createHandler()()).toMatchObject({
        ok: true,
        value: { message: 'local done' },
      })
      expect(invokeControlSurface).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })

  it.each([true, false])('rejects unknown remote identity (binding=%s)', async binding => {
    const f = fixture('remote-worker', binding)
    try {
      expect(await f.createHandler()()).toMatchObject({
        ok: false,
        error: { code: 'worker.unavailable' },
      })
      expect(invokeControlSurface).not.toHaveBeenCalled()
      expect(resolveSessionFilePath).not.toHaveBeenCalled()
    } finally {
      f.runtime.dispose()
    }
  })
})
