/* eslint-disable no-await-in-loop -- Each creation observes the prior admission and runtime lifecycle. */
import { describe, expect, it, vi } from 'vitest'
import { posix, win32 } from 'node:path'
import { toFileUri, fromFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
import {
  AgentSpawnAdmissionOwner,
  type AgentSpawnPermit,
} from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner'
import type { NodeRuntimeBinding } from '../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnRuntimePort'
import type { NodeLineageRecord } from '../../../src/contexts/workspace/domain/nodeLineage'
import type {
  NodeControlAppStateStore,
  NodeControlNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../../../src/contexts/workspace/application/nodeControl/nodeCreationTarget'
function fixture(paths?: typeof win32) {
  let revision = 0,
    generation = 0
  let nodes = [{ id: 'root', kind: 'agent', sessionId: 'root-session' }] as NodeControlNode[]
  let bindings: NodeRuntimeBinding[] = []
  const rows = new Map<string, NodeLineageRecord>()
  const state = () =>
    ({ workspaces: [{ nodes }] }) as Awaited<ReturnType<NodeControlAppStateStore['readAppState']>>
  const store = {
    readAppState: async () => state(),
    readAppStateRevision: async () => revision,
    isAppStateRevisionCurrent: (r: number) => r === revision,
    nodeLineage: { readMany: vi.fn(async () => new Map(rows)), readAll: async () => new Map(rows) },
    commitCreatedNodeState: vi.fn(),
  } as unknown as NodeControlAppStateStore
  const runtime = {
    snapshot: () => ({ revision: generation, bindings }),
    isCurrent: (r: number) => r === generation,
  }
  const owner = new AgentSpawnAdmissionOwner(runtime, paths)
  const target = {
    endpoint: { kind: 'local', endpointId: 'local' },
    workspace: { id: 'p' },
    workingDirectory: '/repo',
  } as ResolvedNodeCreationTarget
  const authority = { grantId: 'g', nodeId: 'root', sessionId: 'root-session' }
  const input = (nodeId: string) => ({
    nodeId,
    kind: 'agent' as const,
    authority,
    target,
    assertActive: vi.fn(),
  })
  const start = async (nodeId: string, fail = false) =>
    owner.runCreation(store, input(nodeId), async (_permit, lineage) => {
      bindings.push({
        nodeId,
        sessionId: nodeId + '-session',
        runtimeOwner: 'local',
        state: 'running',
      })
      generation++
      if (fail) {
        throw new Error('commit and kill failed')
      }
      rows.set(nodeId, lineage)
    })
  return {
    owner,
    target,
    authority,
    input,
    store,
    rows,
    start,
    replaceNodes: (value: NodeControlNode[]) => {
      nodes = value
      revision++
    },
    bind: (b: NodeRuntimeBinding) => {
      bindings.push(b)
      generation++
    },
    exit: (session: string) => {
      bindings = bindings.filter(b => b.sessionId !== session)
      generation++
    },
  }
}
describe('agent spawn admission owner', () => {
  it('retains uncommitted lineage through failed commit/kill, then releases on exact exit', async () => {
    const f = fixture()
    for (let i = 0; i < 5; i++) {
      await f.start('n' + i)
    }
    await expect(f.start('sixth', true)).rejects.toThrow('commit and kill failed')
    await expect(f.start('seventh')).rejects.toMatchObject({
      code: 'agent.spawn_concurrency_limit',
    })
    f.exit('sixth-session')
    await expect(f.start('replacement')).resolves.toBeUndefined()
  })
  it.each(['delete', 'rebind'])('rechecks caller %s during the lineage barrier', async action => {
    const f = fixture()
    vi.mocked(f.store.nodeLineage!.readMany).mockImplementationOnce(async () => {
      f.replaceNodes(
        action === 'delete'
          ? []
          : ([{ id: 'root', kind: 'terminal', sessionId: 'new' }] as NodeControlNode[]),
      )
      return new Map()
    })
    const create = vi.fn()
    await expect(f.owner.runCreation(f.store, f.input('child'), create)).rejects.toMatchObject({
      code: 'common.forbidden',
      details: { spawnReason: 'caller_session_mismatch' },
    })
    expect(create).not.toHaveBeenCalled()
  })
  it('refreshes the census when a runtime appears during lineage reads', async () => {
    const f = fixture()
    for (let i = 0; i < 5; i++) {
      await f.start('n' + i)
    }
    f.rows.set('revived', {
      nodeId: 'revived',
      spawnedBy: 'root',
      rootNodeId: 'root',
      lineageDepth: 2,
    })
    vi.mocked(f.store.nodeLineage!.readMany).mockImplementationOnce(async () => {
      f.bind({
        nodeId: 'revived',
        sessionId: 'human-revival',
        runtimeOwner: 'local',
        state: 'running',
      })
      return new Map(f.rows)
    })
    await expect(f.start('seventh')).rejects.toMatchObject({
      code: 'agent.spawn_concurrency_limit',
    })
  })
  it('deduplicates incarnations and retains occupancy until all have exited', async () => {
    const f = fixture()
    for (let i = 0; i < 6; i++) {
      await f.start('n' + i)
    }
    f.bind({ nodeId: 'n0', sessionId: 'new-incarnation', runtimeOwner: 'local', state: 'running' })
    f.exit('n0-session')
    f.exit('n0-session')
    await expect(f.start('seventh')).rejects.toMatchObject({
      code: 'agent.spawn_concurrency_limit',
    })
    f.exit('new-incarnation')
    await f.start('seventh')
  })
  it('excludes roots and unrelated trees; includes a descendant caller and both runtime kinds', async () => {
    const f = fixture()
    f.bind({ nodeId: 'root', sessionId: 'root-session', runtimeOwner: 'local', state: 'running' })
    f.rows.set('other', {
      nodeId: 'other',
      spawnedBy: 'elsewhere',
      rootNodeId: 'elsewhere',
      lineageDepth: 2,
    })
    f.bind({ nodeId: 'other', sessionId: 'other-session', runtimeOwner: 'local', state: 'running' })
    // Initialize before absent historical ancestry is introduced.
    f.replaceNodes([
      { id: 'root', kind: 'terminal', sessionId: 'root-session' },
      { id: 'other', kind: 'terminal', sessionId: 'other-session' },
    ] as NodeControlNode[])
    for (let i = 0; i < 6; i++) {
      await f.start('n' + i)
    }
    await expect(f.start('seventh')).rejects.toMatchObject({
      code: 'agent.spawn_concurrency_limit',
    })
  })
  it('derives transitive depth and shares one budget with descendant callers across targets', async () => {
    const f = fixture()
    await f.start('child')
    f.replaceNodes([
      { id: 'root', kind: 'agent', sessionId: 'root-session' },
      { id: 'child', kind: 'agent', sessionId: 'child-session' },
    ] as NodeControlNode[])
    const descendant = {
      ...f.input('grandchild'),
      authority: {
        ...f.authority,
        grantId: 'child-grant',
        nodeId: 'child',
        sessionId: 'child-session',
      },
      target: { ...f.target, workspace: { ...f.target.workspace, id: 'other-project' } },
    }
    await f.owner.runCreation(f.store, descendant, async (_permit, lineage) => {
      expect(lineage).toMatchObject({ rootNodeId: 'root', lineageDepth: 3 })
      f.rows.set('grandchild', lineage)
    })
    f.replaceNodes([
      { id: 'grandchild', kind: 'terminal', sessionId: 'grandchild-session' },
    ] as NodeControlNode[])
    await expect(
      f.owner.runCreation(
        f.store,
        {
          ...f.input('too-deep'),
          authority: { ...f.authority, nodeId: 'grandchild', sessionId: 'grandchild-session' },
        },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: 'agent.spawn_depth_limit' })
  })
  it('fences ambiguous remote or unknown runtimes and orphan ancestry on restart', async () => {
    for (const state of ['remote', 'unknown', 'orphan'] as const) {
      const f = fixture()
      f.rows.set('old', { nodeId: 'old', rootNodeId: 'root', spawnedBy: 'root', lineageDepth: 2 })
      if (state !== 'orphan') {
        f.replaceNodes([
          { id: 'root', kind: 'agent', sessionId: 'root-session' },
          { id: 'old', kind: 'terminal', sessionId: 'old-session' },
        ] as NodeControlNode[])
        f.bind({
          nodeId: 'old',
          sessionId: 'old-session',
          runtimeOwner: state === 'remote' ? 'remote' : 'local',
          state: state === 'unknown' ? 'unknown' : 'running',
        })
      }
      await expect(f.start('child')).rejects.toMatchObject({
        code: 'common.unavailable',
        details: { reason: 'spawn_accounting_unavailable' },
      })
    }
  })
  it('rejects node-less and delegated callers before creation', async () => {
    const f = fixture(),
      create = vi.fn()
    for (const authority of [
      { ...f.authority, nodeId: null },
      { ...f.authority, delegated: true },
    ]) {
      await expect(
        f.owner.runCreation(f.store, { ...f.input('child'), authority }, create),
      ).rejects.toMatchObject({ code: 'common.forbidden' })
    }
    expect(create).not.toHaveBeenCalled()
  })
  it('binds permits to owner, grant, child, kind and target, with one physical use', async () => {
    const f = fixture()
    let expired!: AgentSpawnPermit
    await f.owner.runCreation(f.store, f.input('child'), async permit => {
      expired = permit
      f.owner.authorize(permit, f.authority, 'session.launchAgent', 'child')
      for (const operation of [
        () =>
          f.owner.authorize({} as AgentSpawnPermit, f.authority, 'session.launchAgent', 'child'),
        () =>
          f.owner.authorize(
            permit,
            { ...f.authority, grantId: 'wrong' },
            'session.launchAgent',
            'child',
          ),
        () => f.owner.authorize(permit, f.authority, 'session.launchAgent', 'wrong'),
        () => f.owner.authorize(permit, f.authority, 'pty.spawn', 'child'),
        () => fixture().owner.authorize(permit, f.authority, 'session.launchAgent', 'child'),
        () => f.owner.assertTarget(permit, { ...f.target, workingDirectory: '/wrong' }),
        () => f.owner.assertExecution(permit, { cwd: '/wrong' }),
      ]) {
        expect(operation).toThrow()
      }
      f.owner.consume(permit)
      expect(() => f.owner.consume(permit)).toThrow()
    })
    expect(() => f.owner.authorize(expired, f.authority, 'session.launchAgent', 'child')).toThrow()
  })
})

it('does not infer live occupancy from saved sessions, but counts human revival', async () => {
  const f = fixture()
  const saved = Array.from({ length: 6 }, (_, i) => ({
    id: 'saved' + i,
    kind: 'terminal',
    sessionId: 'stale' + i,
  })) as NodeControlNode[]
  for (const node of saved) {
    f.rows.set(node.id, { nodeId: node.id, spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 })
  }
  f.replaceNodes([
    { id: 'root', kind: 'agent', sessionId: 'root-session' },
    ...saved,
  ] as NodeControlNode[])
  await expect(f.start('fresh')).resolves.toBeUndefined()
  for (const node of saved) {
    f.bind({
      nodeId: node.id,
      sessionId: 'recovered-' + node.id,
      runtimeOwner: 'local',
      state: 'running',
    })
  }
  await expect(f.start('after-recovery')).rejects.toMatchObject({
    code: 'agent.spawn_concurrency_limit',
  })
})

it('retains a remote descendant fence after initialization and deletion without a restart', async () => {
  const f = fixture()
  for (let i = 0; i < 5; i++) {
    await f.start('local' + i)
  }
  const localNodes = [
    { id: 'root', kind: 'agent', sessionId: 'root-session' },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: 'local' + i,
      kind: 'terminal',
      sessionId: 'local' + i + '-session',
    })),
  ] as NodeControlNode[]
  f.rows.set('remote', { nodeId: 'remote', spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 })
  f.replaceNodes([
    ...localNodes,
    {
      id: 'remote',
      kind: 'terminal',
      sessionId: 'remote-session',
      workerBinding: { endpointId: 'remote-worker', mountId: 'remote-mount' },
    } as NodeControlNode,
  ])
  await expect(f.start('before-delete')).rejects.toMatchObject({ code: 'common.unavailable' })
  // Persistence deletion succeeds, cleanup fails: no authoritative remote exit was observed.
  f.replaceNodes(localNodes)
  const create = vi.fn()
  await expect(f.owner.runCreation(f.store, f.input('after-delete'), create)).rejects.toMatchObject(
    { code: 'common.unavailable', details: { reason: 'spawn_accounting_unavailable' } },
  )
  expect(create).not.toHaveBeenCalled()
})

it('re-audits a newly orphaned unknown descendant after initialization without observing its membership', async () => {
  const f = fixture()
  await f.start('local')
  // A human remote launch and deletion both finish between admission requests.
  f.rows.set('unobserved', {
    nodeId: 'unobserved',
    spawnedBy: 'root',
    rootNodeId: 'root',
    lineageDepth: 2,
  })
  f.replaceNodes([{ id: 'root', kind: 'agent', sessionId: 'root-session' }] as NodeControlNode[])
  await expect(f.start('after-delete')).rejects.toMatchObject({ code: 'common.unavailable' })
})

it.each([
  'C:/repo/with spaces',
  'C:\\repo\\with spaces',
  '//server/share/repo',
  '\\\\server\\share\\repo',
])('accepts Windows file-URI slash normalization with explicit win32 semantics: %s', async cwd => {
  const f = fixture(win32)
  const target = { ...f.target, workingDirectory: cwd }
  await f.owner.runCreation(f.store, { ...f.input('child'), target }, async permit => {
    const executed = fromFileUri(toFileUri(cwd))!
    expect(win32.normalize(executed)).toBe(win32.normalize(cwd))
    expect(() => f.owner.assertExecution(permit, { cwd: executed })).not.toThrow()
    expect(() =>
      f.owner.assertTarget(permit, { ...target, workingDirectory: executed }),
    ).not.toThrow()
    expect(() =>
      f.owner.assertExecution(permit, { cwd: win32.join(executed, 'different') }),
    ).toThrow()
  })
})

it('uses retained local completion provenance when an exited node is deleted before the first admission', async () => {
  const f = fixture()
  f.rows.set('exited-local', {
    nodeId: 'exited-local',
    spawnedBy: 'root',
    rootNodeId: 'root',
    lineageDepth: 2,
  })
  const owner = new AgentSpawnAdmissionOwner({
    snapshot: () => ({ revision: 1, bindings: [], knownLocalNodeIds: ['exited-local'] }),
    isCurrent: () => true,
  })
  await expect(
    owner.runCreation(f.store, f.input('child'), async () => {}),
  ).resolves.toBeUndefined()
})

it('retains warm-start runtime bindings when both node membership and public hub registration disappear', async () => {
  const f = fixture()
  const locals = Array.from({ length: 6 }, (_, i) => ({
    id: 'warm' + i,
    kind: 'terminal',
    sessionId: 'warm-session' + i,
  })) as NodeControlNode[]
  for (const node of locals) {
    f.rows.set(node.id, { nodeId: node.id, spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 })
  }
  const root = { id: 'root', kind: 'agent', sessionId: 'root-session' } as NodeControlNode
  f.replaceNodes([root, ...locals])
  const completedSessionIds: string[] = []
  let publicHubActive = true,
    generation = 0
  const owner = new AgentSpawnAdmissionOwner({
    snapshot: () => ({ revision: generation, bindings: [], completedSessionIds }),
    isCurrent: revision => revision === generation,
    isSessionActive: () => publicHubActive,
  })
  await expect(owner.runCreation(f.store, f.input('full'), async () => {})).rejects.toMatchObject({
    code: 'agent.spawn_concurrency_limit',
  })
  f.replaceNodes([root, ...locals.slice(1)])
  publicHubActive = false
  f.rows.delete('warm0') // A missing row cannot downgrade an already classified runtime to a root.
  await expect(
    owner.runCreation(f.store, f.input('deleted'), async () => {}),
  ).rejects.toMatchObject({ code: 'agent.spawn_concurrency_limit' })
  completedSessionIds.push('warm-session0')
  generation++
  await expect(
    owner.runCreation(f.store, f.input('after-exit'), async () => {}),
  ).resolves.toBeUndefined()
})

it('keeps POSIX literal backslashes distinct with explicit posix semantics', async () => {
  const f = fixture(posix)
  const target = { ...f.target, workingDirectory: '/repo/literal\\name' }
  await f.owner.runCreation(f.store, { ...f.input('child'), target }, async permit => {
    expect(() => f.owner.assertExecution(permit, { cwd: '/repo/literal/name' })).toThrow()
    expect(() =>
      f.owner.assertTarget(permit, { ...target, workingDirectory: '/repo/literal/name' }),
    ).toThrow()
  })
})
