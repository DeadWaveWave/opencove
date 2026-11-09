// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
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

it.each(['none', 'bearer', 'missing', 'other-project', 'root'] as const)(
  'uses only a grant caller from the target project (%s)',
  async mode => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-node-caller-'))
    try {
      const store = createInMemoryPersistenceStore()
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
        payload: { kind: 'note', projectId: 'project' },
      })
      if (!created.ok) {
        throw new Error(JSON.stringify(created.error))
      }
      const result = created.value as CreateNodeResult
      expect(result.spaceId).toBeNull()
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
