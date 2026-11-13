// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import type { RequestAuth } from '../../../src/app/main/controlSurface/http/requestAuth'
import type { CreateNodeResult } from '../../../src/shared/contracts/dto/nodeControl'
import type { NodeControlAppState } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { SPACE_NODE_PADDING } from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'
import {
  createMinimalState,
  createInMemoryPersistenceStore,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

it.each(['none', 'bearer', 'missing', 'other-project', 'root', 'no-reader', 'no-commit'] as const)(
  'uses only a grant caller from the target project (%s)',
  async mode => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-node-caller-'))
    try {
      const store = createInMemoryPersistenceStore()
      const rows = new Map<
        string,
        import('../../../src/contexts/workspace/domain/nodeLineage').NodeLineageRecord
      >()
      store.nodeLineage = { readMany: async () => rows }
      store.commitCreatedNodeState = async (state, options) => {
        const result = await store.writeAppState(state, options)
        if (result.ok) {
          rows.set(options.lineage.nodeId, options.lineage)
        }
        return result
      }
      const initial = createMinimalState(root, 'project', 'unused')
      initial.workspaces[0].spaces = []
      await store.writeAppState(initial)
      const topology = createWorkerTopologyStore({ userDataPath: root })
      await topology.createMount({ projectId: 'project', endpointId: 'local', rootPath: root })
      const surface = createControlSurface()
      registerNodeControlHandlers(surface, { topology, getPersistenceStore: async () => store })
      const seed = await surface.invoke(
        { now: () => new Date() },
        {
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'note',
            projectId: 'project',
            frame: { x: 4000, y: 3000 },
          },
        },
      )
      if (!seed.ok) {
        throw new Error(JSON.stringify(seed.error))
      }
      const caller = (seed.value as CreateNodeResult).node
      if (mode === 'other-project') {
        const state = (await store.readAppState()) as NodeControlAppState
        state.workspaces.push({
          ...state.workspaces[0],
          id: 'other-project',
          nodes: [...state.workspaces[0].nodes],
        })
        state.workspaces[0].nodes = []
        await store.writeAppState(state)
      }
      const grant = new SessionGrantRegistry(() => true).issue({
        projectId: 'project',
        spaceId: 'stale-space',
        nodeId: mode === 'missing' ? 'remote-node-not-here' : caller.id,
        sessionId: 'session',
      }).grant
      const requestAuth: RequestAuth | undefined =
        mode === 'none'
          ? undefined
          : mode === 'bearer'
            ? { kind: 'bearer' }
            : { kind: 'session-grant', grant }
      const ctx = {
        now: () => new Date(),
        requestAuth,
        // This trusted spawn-only identity must not be reused as request identity.
        spawnIdentity: { projectId: 'project', spaceId: '', nodeId: caller.id },
      }
      const before = await store.readAppStateRevision()
      if (mode === 'no-reader') {
        store.nodeLineage = undefined
      }
      if (mode === 'no-commit') {
        store.commitCreatedNodeState = undefined
      }
      const invokes = vi.spyOn(surface, 'invoke')
      const injected = await surface.invoke(ctx, {
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: 'note',
          projectId: 'project',
          callerNodeId: caller.id,
        },
      })
      expect(injected).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
      expect(await store.readAppStateRevision()).toBe(before)
      const created = await surface.invoke(ctx, {
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: mode === 'no-reader' || mode === 'no-commit' ? 'agent' : 'note',
          projectId: 'project',
        },
      })
      if (mode === 'no-reader' || mode === 'no-commit') {
        expect(created).toMatchObject({ ok: false, error: { code: 'persistence.unavailable' } })
        expect(invokes.mock.calls.every(([, request]) => request.id === 'node.create')).toBe(true)
        expect(await store.readAppStateRevision()).toBe(before)
        return
      }
      if (mode === 'missing') {
        expect(created).toMatchObject({ ok: false, error: { code: 'node.not_found' } })
        return
      }
      if (!created.ok) {
        throw new Error(JSON.stringify(created.error))
      }
      const result = created.value as CreateNodeResult
      expect(result.spaceId).toBeNull()
      expect(result.node).toMatchObject(
        mode === 'none' || mode === 'bearer'
          ? { spawnedBy: null, lineageDepth: 1, lineageStatus: 'root' }
          : { spawnedBy: caller.id, lineageDepth: 2, lineageStatus: 'recorded' },
      )
      expect(result.node.frame).toMatchObject(
        mode === 'root'
          ? { x: caller.frame.x + caller.frame.width + SPACE_NODE_PADDING, y: caller.frame.y }
          : { x: 0, y: 0 },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

it.each(['bearer', 'grant', 'missing-reference'] as const)(
  'near reference preserves authenticated creator and authority (%s)',
  async mode => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-node-near-caller-'))
    try {
      const store = createInMemoryPersistenceStore()
      const initial = createMinimalState(root, 'project', 'space')
      initial.workspaces[0].spaces = []
      await store.writeAppState(initial)
      const topology = createWorkerTopologyStore({ userDataPath: root })
      await topology.createMount({ projectId: 'project', endpointId: 'local', rootPath: root })
      const surface = createControlSurface()
      registerNodeControlHandlers(surface, { topology, getPersistenceStore: async () => store })
      const seed = async (x: number) => {
        const result = await surface.invoke(
          { now: () => new Date() },
          {
            kind: 'command',
            id: 'node.create',
            payload: { kind: 'note', projectId: 'project', frame: { x, y: 3000 } },
          },
        )
        if (!result.ok) {
          throw Error(JSON.stringify(result.error))
        }
        return (result.value as CreateNodeResult).node
      }
      const caller = await seed(4000),
        reference = await seed(8000)
      const grant = new SessionGrantRegistry(() => true).issue({
        projectId: 'project',
        spaceId: null,
        nodeId: caller.id,
        sessionId: 'session',
      }).grant
      const before = await store.readAppStateRevision()
      const result = await surface.invoke(
        {
          now: () => new Date(),
          requestAuth: mode === 'bearer' ? { kind: 'bearer' } : { kind: 'session-grant', grant },
        },
        {
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'note',
            near: {
              nodeId: mode === 'missing-reference' ? 'remote-node-not-here' : reference.id,
              target: 'reference-container',
            },
          },
        },
      )
      if (mode === 'missing-reference') {
        expect(result).toMatchObject({ ok: false, error: { code: 'node.not_found' } })
        expect(await store.readAppStateRevision()).toBe(before)
        return
      }
      if (!result.ok) {
        throw Error(JSON.stringify(result.error))
      }
      expect((result.value as CreateNodeResult).node).toMatchObject({
        spawnedBy: mode === 'grant' ? caller.id : null,
        lineageDepth: mode === 'grant' ? 2 : 1,
        frame: { x: reference.frame.x + reference.frame.width + SPACE_NODE_PADDING, y: 3000 },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
