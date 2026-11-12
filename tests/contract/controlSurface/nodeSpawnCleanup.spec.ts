// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import { registerSessionQueryHandlers } from '../../../src/app/main/controlSurface/handlers/sessionQueryHandlers'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'

it.each([false, true])(
  'kills an unregistered physical session after activity commit throws (kill fails=%s)',
  async killFails => {
    const store = createInMemoryPersistenceStore()
    const state = createMinimalState(process.cwd(), 'project', 'space')
    state.workspaces[0].nodes = [
      { id: 'root', kind: 'agent', sessionId: 'root-session', title: 'Root' },
    ]
    await store.writeAppState(state)
    const exits = new Set<(event: { sessionId: string; exitCode: number }) => void>()
    const kill = vi.fn(() => {
      if (killFails) {
        throw new Error('kill failed')
      }
    })
    const tracked = createAgentSpawnRuntime({
      spawnSession: async () => ({ sessionId: 'physical' }),
      kill,
      write: () => {},
      resize: async () => ({ status: 'session_not_found' }) as never,
      onData: () => () => {},
      onExit: listener => {
        exits.add(listener)
        return () => {
          exits.delete(listener)
        }
      },
    })
    const hub = new PtyStreamHub({ ptyRuntime: tracked.runtime, replayWindowMaxBytes: 1000 })
    const topology = {
      listEndpoints: async () => ({ endpoints: [{ endpointId: 'local', kind: 'local' }] }),
      listMounts: async () => ({ mounts: [] }),
    } as unknown as WorkerTopologyStore
    const surface = createControlSurface({
      run: async (ctx, _request, execute) =>
        ctx.spawnIdentity ? canvasSpawnIdentity.run(ctx.spawnIdentity, execute) : execute(),
    })
    const commit = vi.fn(() => {
      throw new Error('activity commit failed')
    })
    const deps = {
      ...createReadyTerminalAdmissionDeps(),
      ptyRuntime: tracked.runtime,
      ptyStreamHub: hub,
      topology,
      getPersistenceStore: async () => store,
      approvedWorkspaces: { isPathApproved: async () => true } as never,
      terminalAgentActivity: {
        prepare: async (input: { command: string; args: string[] }) => ({
          ...input,
          commit,
          dispose: async () => {},
        }),
      } as never,
    }
    registerSessionStreamingHandlers(surface, deps)
    // Exercise the production public kill handler, with no records and an initially empty hub.
    registerSessionQueryHandlers(surface, deps as never, new Map(), vi.fn() as never)
    registerNodeControlHandlers(surface, {
      ...deps,
      agentSpawnRuntime: tracked.port,
      killExactSession: (id: string) => tracked.runtime.kill(id),
    })
    const ctx = createControlSurfaceHttpServerContext({
      enableWebShell: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 1000,
    })
    const grant = {
      grantId: 'g',
      nodeId: 'root',
      sessionId: 'root-session',
      projectId: 'project',
      spaceId: 'space',
      tier: 'interact' as const,
      createdAt: '',
    }
    try {
      expect(hub.listSessions().sessions).toEqual([])
      expect(
        await surface.invoke(
          { ...ctx, requestAuth: { kind: 'session-grant', grant } },
          {
            kind: 'command',
            id: 'node.create',
            payload: { kind: 'terminal', space: { kind: 'spaceId', spaceId: 'space' }, data: {} },
          },
        ),
      ).toMatchObject({ ok: false })
      expect(commit).toHaveBeenCalledWith('physical')
      expect(hub.hasSession('physical')).toBe(false)
      expect(kill).toHaveBeenCalledWith('physical')
      expect(tracked.port.snapshot().bindings).toMatchObject([
        { sessionId: 'physical', state: 'running' },
      ])
      expect((await store.readAppState())!.workspaces[0].nodes.map(n => n.id)).toEqual(['root'])
      // Public lookups still reject unknown IDs; trusted cleanup must not widen public authority.
      expect(
        await surface.invoke(ctx, {
          kind: 'command',
          id: 'session.kill',
          payload: { sessionId: 'unrelated' },
        }),
      ).toMatchObject({ ok: false, error: { code: 'session.not_found' } })
      exits.forEach(emit => emit({ sessionId: 'physical', exitCode: 0 }))
      expect(tracked.port.snapshot().bindings).toEqual([])
    } finally {
      tracked.dispose()
    }
  },
)
