// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import { registerProjectHandlers } from '../../../src/app/main/controlSurface/handlers/projectHandlers'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type {
  NodeControlAppState,
  NodeControlNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { NodeLineageRecord } from '../../../src/contexts/workspace/domain/nodeLineage'
import type {
  GetNodeResult,
  ListNodesResult,
  ListSpacesResult,
  GetSpaceResult,
  UpdateNodeResult,
} from '../../../src/shared/contracts/dto'
import type { ControlSurfaceInvokeRequest } from '../../../src/shared/contracts/controlSurface'
import {
  createMinimalState,
  createInMemoryPersistenceStore,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import { identityFixture } from '../../unit/app/cliIdentity.helpers'
import { run } from '../../../src/app/cli/core/run'
import { commands } from '../../../src/app/cli/commands'

const projectA = 'project-a',
  projectB = 'project-b'
const callerId = '11111111-1111-4111-8111-111111111111'
const parentId = 'legacy-coordinator'
const childA = 'child-a',
  childB = 'child-b',
  noteB = 'note-b'
const spaceB = '22222222-2222-4222-8222-222222222222'
const lineageFields = ['spawnedBy', 'lineageDepth', 'lineageStatus']
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function node(id: string, kind = 'agent'): NodeControlNode {
  return {
    id,
    kind,
    title: id,
    sessionId: kind === 'agent' ? `session-${id}` : null,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    agent: kind === 'agent' ? { provider: 'codex' } : null,
    task: kind === 'note' ? { text: 'Before' } : null,
    scrollback: null,
  }
}
async function fixture(creatorId = callerId) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-lineage-queries-'))
  roots.push(root)
  const state = createMinimalState(root, projectA, 'space-a') as unknown as NodeControlAppState
  state.workspaces[0].nodes = [
    { ...node(callerId), title: 'Coordinator A' },
    node(parentId),
    node(childA),
  ]
  state.workspaces[0].spaces[0].nodeIds = [callerId, parentId, childA]
  state.workspaces.push({
    ...structuredClone(state.workspaces[0]),
    id: projectB,
    name: 'Project B',
    nodes: [node(childB), node(noteB, 'note'), node('unrelated-b')],
    activeSpaceId: spaceB,
    spaces: [
      { ...state.workspaces[0].spaces[0], id: spaceB, nodeIds: [childB, noteB, 'unrelated-b'] },
    ],
  })
  const rows = new Map<string, NodeLineageRecord>([
    [callerId, { nodeId: callerId, spawnedBy: parentId, rootNodeId: parentId, lineageDepth: 2 }],
    ...[childA, childB, noteB].map(
      id =>
        [
          id,
          {
            nodeId: id,
            spawnedBy: creatorId,
            rootNodeId: parentId,
            lineageDepth: creatorId === callerId ? 3 : 2,
          },
        ] as const,
    ),
  ])
  const store = createInMemoryPersistenceStore()
  store.nodeLineage = { readMany: async () => rows }
  store.commitCreatedNodeState = async (next, options) => {
    const result = await store.writeAppState(next, options)
    if (result.ok) {
      rows.set(options.lineage.nodeId, options.lineage)
    }
    return result
  }
  await store.writeAppState(state)
  const surface = createControlSurface()
  const topology = createWorkerTopologyStore({ userDataPath: root })
  await topology.createMount({ projectId: projectA, endpointId: 'local', rootPath: root })
  await topology.createMount({ projectId: projectB, endpointId: 'local', rootPath: root })
  registerNodeControlHandlers(surface, { topology, getPersistenceStore: async () => store })
  registerSpaceHandlers(surface, async () => store)
  registerProjectHandlers(surface, async () => store)
  registerSystemHandlers(surface, { appVersion: null, hasNodeLineage: async () => true })
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => 1,
    createTurnId: () => 'turn',
    schedule: () => () => {},
  })
  for (const workspace of state.workspaces) {
    for (const candidate of workspace.nodes.filter(n => n.kind === 'agent')) {
      registry.register({
        sessionId: candidate.sessionId!,
        nodeId: candidate.id,
        provider: 'codex',
        incarnation: candidate.id,
        projectId: workspace.id,
        spaceId: workspace.spaces[0].id,
      })
    }
  }
  registerAgentRunStateHandlers(
    surface,
    { agentRuns: { registry } } as PtyStreamHub,
    undefined,
    async () => store,
  )
  const grant = new SessionGrantRegistry(() => true).issue({
    projectId: projectA,
    spaceId: 'space-a',
    nodeId: callerId,
    sessionId: `session-${callerId}`,
  }).grant
  const ctx = {
    now: () => new Date(),
    requestAuth: { kind: 'session-grant', grant },
  } as ControlSurfaceContext
  const invoke = async <T>(
    id: string,
    payload: unknown,
    kind: 'query' | 'command' = 'query',
  ): Promise<T> => {
    const result = await surface.invoke(ctx, { id, payload, kind })
    if (!result.ok) {
      throw Error(JSON.stringify(result.error))
    }
    return result.value as T
  }
  const cli = async (args: string[], injected = true) => {
    const f = identityFixture()
    Object.assign(f.io.env, {
      OPENCOVE_PROJECT_ID: projectA,
      OPENCOVE_SPACE_ID: 'space-a',
      OPENCOVE_NODE_ID: callerId,
    })
    if (!injected) {
      f.io.env = { OPENCOVE_CONTROL_URL: 'http://fixture', OPENCOVE_CONTROL_TOKEN: 'secret' }
    }
    f.io.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as ControlSurfaceInvokeRequest
      f.requests.push(request as (typeof f.requests)[number])
      return new Response(JSON.stringify(await surface.invoke(ctx, request)))
    }
    const code = await run(args, f.io)
    return { code, out: f.out(), requests: f.requests, error: f.error }
  }
  return { invoke, cli, rows, store }
}

it.each(
  ['node', 'agent'].flatMap(domain =>
    ['@self', callerId, '@parent', parentId, 'Coordinator A', callerId.slice(0, 8)].map(
      selector => ({ domain, selector }),
    ),
  ),
)(
  '$domain list filters children in B without constraining creator $selector to B',
  async ({ domain, selector }) => {
    const creatorId = selector === '@parent' || selector === parentId ? parentId : callerId
    const f = await fixture(creatorId)
    // Prove the actual Worker handler already selects B's children before exercising CLI resolution.
    const server = await f.invoke<ListNodesResult>('node.list', {
      projectId: projectB,
      spawnedByNodeId: creatorId,
    })
    expect(server.nodes.map(n => n.id)).toEqual([childB, noteB])
    const result = await f.cli([
      domain,
      'list',
      '--project',
      projectB,
      '--spawned-by',
      selector,
      '--fields',
      domain === 'node' ? 'id,spawnedBy' : 'nodeId,spawnedBy',
    ])
    expect(result.code, result.out).toBe(0)
    const returned = JSON.parse(result.out)
    expect(returned[domain === 'node' ? 'nodes' : 'agents']).toEqual(
      (domain === 'node' ? [childB, noteB] : [childB]).map(id => ({
        [domain === 'node' ? 'id' : 'nodeId']: id,
        spawnedBy: creatorId,
      })),
    )
    expect(
      result.requests.some(
        r =>
          r.id === `${domain}.list` &&
          r.payload.spawnedByNodeId === creatorId &&
          r.payload.projectId === projectB,
      ),
    ).toBe(true)
  },
)

it('retains project membership checks for ordinary node targets', async () => {
  const f = await fixture()
  for (const selector of [
    '@self',
    callerId,
    '@parent',
    parentId,
    'Coordinator A',
    callerId.slice(0, 8),
  ]) {
    const result = await f.cli(['node', 'get', '--project', projectB, '--node', selector])
    expect(result.code).toBe(1)
    expect(result.error().code).toBe('node.not_found')
  }
})

it('declares update fields from its actual handler result without losing query lineage', async () => {
  const f = await fixture()
  expect((await f.invoke<GetNodeResult>('node.get', { nodeId: noteB })).node).toMatchObject({
    spawnedBy: callerId,
    lineageStatus: 'recorded',
  })
  const updated = await f.invoke<UpdateNodeResult>(
    'node.update',
    { nodeId: noteB, kind: 'note', data: { text: 'Updated' } },
    'command',
  )
  expect(updated.node).toMatchObject({ id: noteB, data: { text: 'Updated' } })
  const fields = commands.find(c => c.path.join(' ') === 'node update note')!.render!.fields!
  for (const field of lineageFields) {
    expect(updated.node).not.toHaveProperty(field)
  }
  const bad = await f.cli([
    'node',
    'update',
    'note',
    '--node',
    noteB,
    '--text',
    'Must not mutate',
    '--fields',
    'id,spawnedBy,lineageDepth,lineageStatus',
  ])
  expect(bad.code).toBe(2)
  for (const field of lineageFields) {
    expect(fields).not.toContain(field)
  }
  expect((await f.invoke<GetNodeResult>('node.get', { nodeId: noteB })).node).toMatchObject({
    data: { text: 'Updated' },
    spawnedBy: callerId,
  })
  const good = await f.cli([
    'node',
    'get',
    '--node',
    noteB,
    '--fields',
    'id,spawnedBy,lineageDepth,lineageStatus',
  ])
  expect(good.code).toBe(0)
  expect(JSON.parse(good.out).node).toMatchObject({
    id: noteB,
    spawnedBy: callerId,
    lineageStatus: 'recorded',
    lineageDepth: 3,
  })
})

it.each(['get', 'list'])(
  'space %s omits lineage declarations absent from its actual compact node results',
  async action => {
    const f = await fixture()
    const result =
      action === 'get'
        ? (await f.invoke<GetSpaceResult>('space.get', { spaceId: spaceB })).space
        : (await f.invoke<ListSpacesResult>('space.list', { projectId: projectB })).spaces[0]
    const child = result.nodes.find(n => n.id === noteB)!
    expect(child).toMatchObject({ id: noteB, kind: 'note', data: { kind: 'note' } })
    const fields = commands.find(c => c.path.join(' ') === `space ${action}`)!.render!.fields!
    for (const field of lineageFields) {
      expect(child).not.toHaveProperty(field)
    }
    const selection = action === 'get' ? ['--space', spaceB] : ['--project', projectB]
    const bad = await f.cli(['space', action, ...selection, '--fields', 'id,nodes.spawnedBy'])
    expect(bad.code).toBe(2)
    for (const field of lineageFields) {
      expect(fields).not.toContain(`nodes.${field}`)
    }
    const good = await f.cli(['space', action, ...selection, '--fields', 'id,nodes.id'])
    expect(good.code).toBe(0)
    const output = JSON.parse(good.out)
    const projected = action === 'get' ? output.space : output.spaces[0]
    expect(projected.nodes.map((n: { id: string }) => n.id)).toContain(noteB)
  },
)

it('retains lineage fields on actual node create and agent get responses', async () => {
  const f = await fixture()
  const created = await f.cli([
    'node',
    'create',
    'note',
    '--project',
    projectB,
    '--root-canvas',
    '--text',
    'Created',
    '--fields',
    'id,spawnedBy,lineageDepth,lineageStatus',
  ])
  expect(created.code).toBe(0)
  expect(JSON.parse(created.out).node).toMatchObject({
    spawnedBy: callerId,
    lineageDepth: 3,
    lineageStatus: 'recorded',
  })
  const agent = await f.cli([
    'agent',
    'get',
    '--node',
    childB,
    '--fields',
    'nodeId,spawnedBy,lineageDepth,lineageStatus',
  ])
  expect(agent.code).toBe(0)
  expect(JSON.parse(agent.out)).toEqual({
    nodeId: childB,
    spawnedBy: callerId,
    lineageDepth: 3,
    lineageStatus: 'recorded',
  })
})

it.each(
  ['node', 'agent'].flatMap(domain =>
    ['@self', 'Coordinator A'].map(selector => ({ domain, selector })),
  ),
)(
  '$domain creator $selector uses verified identity when injected identity is hidden',
  async ({ domain, selector }) => {
    const f = await fixture()
    const result = await f.cli(
      [
        domain,
        'list',
        '--project',
        projectB,
        '--spawned-by',
        selector,
        '--fields',
        domain === 'node' ? 'id,spawnedBy' : 'nodeId,spawnedBy',
      ],
      false,
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out)[domain === 'node' ? 'nodes' : 'agents']).toEqual(
      (domain === 'node' ? [childB, noteB] : [childB]).map(id => ({
        [domain === 'node' ? 'id' : 'nodeId']: id,
        spawnedBy: callerId,
      })),
    )
    expect(result.requests.filter(r => r.id === 'system.whoami')).toHaveLength(1)
  },
)

it('describes ambiguous creators using their lookup project rather than the child-result project', async () => {
  const f = await fixture()
  const state = (await f.store.readAppState()) as NodeControlAppState
  const workspace = state.workspaces[0]
  workspace.nodes.find(n => n.id === parentId)!.title = 'Coordinator A'
  workspace.spaces[0].name = 'Caller Space'
  workspace.spaces[0].nodeIds = [callerId, childA]
  workspace.spaces.push({
    ...workspace.spaces[0],
    id: 'other-a',
    name: 'Parent Space',
    nodeIds: [parentId],
  })
  await f.store.writeAppState(state)
  const result = await f.cli([
    'node',
    'list',
    '--project',
    projectB,
    '--spawned-by',
    'Coordinator A',
  ])
  expect(result.code).toBe(6)
  expect(
    result
      .error()
      .details.candidates.map((n: { spaceName: string }) => n.spaceName)
      .sort(),
  ).toEqual(['Caller Space', 'Parent Space'])
})
