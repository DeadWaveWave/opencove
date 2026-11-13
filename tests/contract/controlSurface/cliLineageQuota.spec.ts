// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerProjectHandlers } from '../../../src/app/main/controlSurface/handlers/projectHandlers'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { ControlSurfaceInvokeRequest } from '../../../src/shared/contracts/controlSurface'
import { identityFixture } from '../../unit/app/cliIdentity.helpers'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

async function fixture() {
  const store = createInMemoryPersistenceStore(),
    surface = createControlSurface()
  const state = createMinimalState('/repo', 'project', 'space')
  const nodes = [
    { id: 'root', kind: 'agent', title: 'Lead', sessionId: 'root-session' },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `child-${i}`,
      kind: i % 2 ? 'terminal' : 'agent',
      title: `Delegate ${i}`,
      sessionId: `s${i}`,
    })),
  ]
  state.workspaces[0].nodes = nodes
  state.workspaces[0].spaces[0].nodeIds = nodes.map(n => n.id)
  await store.writeAppState(state)
  for (const [i, node] of nodes.slice(1).entries()) {
    // eslint-disable-next-line no-await-in-loop
    await store.commitCreatedNodeState!(state, {
      lineage: {
        nodeId: node.id,
        spawnedBy: i === 1 ? 'child-0' : 'root',
        rootNodeId: 'root',
        lineageDepth: i === 1 ? 3 : 2,
      },
    })
  }
  let bindings = nodes.map(n => ({
    nodeId: n.id,
    sessionId: n.sessionId,
    runtimeOwner: 'local' as const,
    state: 'running' as const,
  }))
  let generation = 0
  registerNodeControlHandlers(surface, {
    topology: {
      listEndpoints: async () => ({ endpoints: [{ endpointId: 'local', kind: 'local' }] }),
      listMounts: async () => ({ mounts: [] }),
    } as unknown as WorkerTopologyStore,
    getPersistenceStore: async () => store,
    agentSpawnRuntime: {
      snapshot: () => ({ revision: generation, bindings }),
      isCurrent: r => r === generation,
    },
    killExactSession: () => {},
  })
  registerProjectHandlers(surface, async () => store)
  registerSpaceHandlers(surface, async () => store)
  registerSystemHandlers(surface, {
    appVersion: null,
    hasBoundedAgentSpawning: async () => true,
    hasNodeLineage: async () => true,
  })
  const context = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  const granted = (id: string) => ({
    ...context,
    requestAuth: {
      kind: 'session-grant' as const,
      grant: {
        grantId: 'g',
        nodeId: id,
        sessionId: nodes.find(n => n.id === id)!.sessionId,
        projectId: 'project',
        spaceId: 'space',
        tier: 'interact' as const,
        createdAt: '',
      },
    },
  })
  const cli = async (args: string[], id = 'root', oldWorker = false) => {
    const f = identityFixture()
    Object.assign(f.io.env, {
      OPENCOVE_NODE_ID: id,
      OPENCOVE_PROJECT_ID: 'project',
      OPENCOVE_SPACE_ID: 'space',
    })
    f.io.fetch = async (_url, init) => {
      const req = JSON.parse(String(init?.body)) as ControlSurfaceInvokeRequest
      const response = await surface.invoke(granted(id), req)
      if (oldWorker && response.ok && req.id === 'system.whoami') {
        delete (response.value as { lineageQuota?: unknown }).lineageQuota
      }
      return new Response(JSON.stringify(response))
    }
    return { code: await run(args, f.io), out: f.out(), error: f.error }
  }
  return {
    cli,
    exit: () => {
      bindings = bindings.slice(0, -1)
      generation++
    },
  }
}

it('projects admission quota for roots and depth-three callers and names width/depth blockers on stderr', async () => {
  const f = await fixture()
  for (const [id, depth] of [
    ['root', 1],
    ['child-1', 3],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    const who = await f.cli(['whoami', '--fields', 'lineageQuota'], id)
    expect(who.code).toBe(0)
    expect(JSON.parse(who.out)).toEqual({
      lineageQuota: { depth, maxDepth: 3, liveInTree: 6, maxLiveInTree: 6 },
    })
    // eslint-disable-next-line no-await-in-loop
    const refusal = await f.cli(['node', 'create', 'terminal', '--space', 'space'], id)
    expect(refusal.code).toBe(1)
    const error = refusal.error()
    expect(error.code).toBe(
      id === 'root' ? 'agent.spawn_concurrency_limit' : 'agent.spawn_depth_limit',
    )
    expect(error.details.nodes).toHaveLength(6)
    expect(error.details.nodes[0]).toEqual({
      nodeId: 'child-0',
      title: 'Delegate 0',
      kind: 'agent',
      depth: 2,
      state: 'running',
    })
    expect(error.hint).toContain('Delegate 0')
    expect(error.hint).toContain('opencove agent stop --node child-0')
  }
  f.exit()
  const who = await f.cli(['whoami', '--fields', 'lineageQuota.liveInTree'])
  expect(JSON.parse(who.out)).toEqual({ lineageQuota: { liveInTree: 5 } })
})
it('keeps identity usable against an older Worker without the optional quota', async () => {
  const f = await fixture()
  const who = await f.cli(['whoami', '--fields', 'nodeId,lineageQuota'], 'root', true)
  expect(who.code).toBe(0)
  expect(JSON.parse(who.out)).toEqual({ nodeId: 'root' })
})
