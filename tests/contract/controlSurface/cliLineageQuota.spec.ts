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
      startedAt: new Date(i * 1000).toISOString(),
    })),
  ]
  state.workspaces[0].nodes = nodes
  state.workspaces[0].spaces[0].nodeIds = nodes.map(n => n.id)
  await store.writeAppState(state)
  for (const [i, node] of nodes.slice(1).entries()) {
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
  const cli = async (
    args: string[],
    id = 'root',
    oldWorker: boolean | 'rows' = false,
    tty = false,
  ) => {
    const f = identityFixture()
    f.io.stdout.isTTY = tty
    Object.assign(f.io.env, {
      OPENCOVE_NODE_ID: id,
      OPENCOVE_PROJECT_ID: 'project',
      OPENCOVE_SPACE_ID: 'space',
    })
    f.io.fetch = async (_url, init) => {
      const req = JSON.parse(String(init?.body)) as ControlSurfaceInvokeRequest
      const response = await surface.invoke(granted(id), req)
      if (oldWorker && response.ok && req.id === 'system.whoami') {
        if (oldWorker === 'rows') {
          delete (response.value as { lineageQuota: { nodes?: unknown } }).lineageQuota.nodes
        } else {
          delete (response.value as { lineageQuota?: unknown }).lineageQuota
        }
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

it.each([false, true])(
  'projects admission quota for roots and depth-three callers and names width/depth blockers on stderr (near=%s)',
  async near => {
    const f = await fixture()
    for (const [id, depth] of [
      ['root', 1],
      ['child-1', 3],
    ] as const) {
      const who = await f.cli(['whoami', '--fields', 'lineageQuota'], id)
      expect(who.code).toBe(0)
      expect(JSON.parse(who.out)).toEqual({
        lineageQuota: {
          depth,
          maxDepth: 3,
          liveInTree: 6,
          maxLiveInTree: 6,
          remainingLiveInTree: 0,
        },
      })
      const refusal = await f.cli(
        ['node', 'create', 'terminal', ...(near ? ['--near', 'Lead'] : ['--space', 'space'])],
        id,
      )
      expect(refusal.code).toBe(1)
      const error = refusal.error()
      // Tree is opt-in; legacy refusal rows must stay byte-for-byte unchanged.
      // eslint-disable-next-line no-await-in-loop
      const tree = await f.cli(['whoami', '--tree'], id)
      expect(tree.code).toBe(0)
      const occupants = JSON.parse(tree.out).tree.occupants
      expect(occupants.map((row: { nodeId: string }) => row.nodeId)).toEqual(
        error.details.nodes.map((row: { nodeId: string }) => row.nodeId),
      )
      expect(occupants[1].spawnedBy).toBe('child-0')
      const legacyDetails = {
        reason: id === 'root' ? 'concurrency_limit' : 'depth_limit',
        retryable: false,
        nodes: Array.from({ length: 6 }, (_, i) => ({
          nodeId: `child-${i}`,
          title: `Delegate ${i}`,
          kind: i % 2 ? 'terminal' : 'agent',
          sessionId: `s${i}`,
          sessionStartedAt: new Date(i * 1000).toISOString(),
          depth: i === 1 ? 3 : 2,
          state: 'running',
        })),
        rootNodeId: 'root',
        callerNodeId: id,
        requestedKind: 'terminal',
        limit: id === 'root' ? 6 : 3,
        ...(id === 'root' ? { occupied: 6 } : { attemptedDepth: 4 }),
        actions: [0, 2, 4].map(i => ({
          kind: 'stop_agent',
          nodeId: `child-${i}`,
          command: `opencove agent stop --node child-${i}`,
        })),
      }
      expect(JSON.stringify(error.details)).toBe(JSON.stringify(legacyDetails))
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
        sessionId: 's0',
        sessionStartedAt: new Date(0).toISOString(),
      })
      expect(error.details.actions[0]).toEqual({
        kind: 'stop_agent',
        nodeId: 'child-0',
        command: 'opencove agent stop --node child-0',
      })
      expect(
        error.details.actions.every((action: { kind: string }) => action.kind === 'stop_agent'),
      ).toBe(true)
      expect(error.hint).toContain('Delegate 0')
      expect(error.hint).toContain('opencove agent stop --node child-0')
    }
    f.exit()
    const who = await f.cli(['whoami', '--fields', 'lineageQuota.liveInTree'])
    expect(JSON.parse(who.out)).toEqual({ lineageQuota: { liveInTree: 5 } })
  },
)
it('keeps identity usable against an older Worker without the optional quota', async () => {
  const f = await fixture()
  const who = await f.cli(['whoami', '--fields', 'nodeId,lineageQuota'], 'root', true)
  expect(who.code).toBe(0)
  expect(JSON.parse(who.out)).toEqual({ nodeId: 'root' })
})

it('summarizes human identity and context while leaving explicit JSON clean', async () => {
  const f = await fixture()
  const who = await f.cli(['whoami'], 'root', false, true)
  expect(who.out).toContain('Agents: 6 of 6 running in your tree; depth 1 of 3\n')
  const context = await f.cli(['context', '--space', 'space'], 'root', false, true)
  expect(context.out).toContain('Agents: 6 of 6 running in your tree; depth 1 of 3\n')
  const json = await f.cli(['whoami', '-o', 'json'])
  expect(JSON.parse(json.out).lineageQuota.remainingLiveInTree).toBe(0)
  f.exit()
  const remaining = await f.cli(['whoami', '--fields', 'lineageQuota.remainingLiveInTree'])
  expect(JSON.parse(remaining.out)).toEqual({ lineageQuota: { remainingLiveInTree: 1 } })
})

it('refuses tree view against an older Worker without census rows while retaining real counts', async () => {
  const f = await fixture()
  const who = await f.cli(['whoami', '--tree', '-o', 'json'], 'root', 'rows')
  expect(who.code).toBe(5)
  expect(who.out).toBe('')
  expect(who.error()).toMatchObject({
    hint: expect.stringContaining('Update OpenCove'),
    details: { identity: { lineageQuota: { liveInTree: 6, remainingLiveInTree: 0 } } },
  })
})

it('keeps plain identity and context quota JSON at the legacy shape', async () => {
  const f = await fixture()
  const quota = { depth: 1, maxDepth: 3, liveInTree: 6, maxLiveInTree: 6, remainingLiveInTree: 0 }
  const who = await f.cli(['whoami', '-o', 'json'])
  expect(who.out).toBe(
    JSON.stringify({
      lineageQuota: quota,
      caller: 'session-grant',
      scope: 'interact',
      projectId: 'project',
      spaceId: 'space',
      nodeId: 'root',
      sessionId: 'root-session',
    }) + '\n',
  )
  const context = await f.cli(['context', '--space', 'space', '--fields', 'self.lineageQuota'])
  expect(context.out).toBe(JSON.stringify({ self: { lineageQuota: quota } }) + '\n')
})
