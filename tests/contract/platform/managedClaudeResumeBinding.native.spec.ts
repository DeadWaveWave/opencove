// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createManagedClaudeResumeStore } from '../../../src/platform/persistence/sqlite/managedClaudeResumeStore'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

import { tupleA, tupleB, stateWithAgent } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude resume binding storage', () => {
  let root: string
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  let sql: Database.Database
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-resume-ledger-'))
    store = await createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
    sql = new Database(join(root, 'state.db'))
  })
  afterEach(async () => {
    sql?.close()
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const activate = () =>
    store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'launch',
      runtimeSessionId: 'runtime',
      tuple: tupleA,
    })
  const rebind = () =>
    store.commitManagedClaudeRebind({
      nodeId: 'agent',
      activationId: 'rebind',
      runtimeSessionId: 'runtime',
      expected: tupleA,
      next: tupleB,
    })

  it('keeps unowned writes unchanged and returns the exact effective receipt', async () => {
    const state = stateWithAgent()
    const result = await store.writeAppState(state)
    expect(result).toMatchObject({ ok: true, revision: 1, corrected: false })
    expect(await store.readAppStateSnapshot()).toEqual({
      revision: 1,
      state: await store.readAppState(),
    })
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').all()).toEqual([])
  })
  it('corrects stale tuples and runtime while saving independent edits', async () => {
    await store.writeAppState(stateWithAgent())
    expect(await activate()).toMatchObject({ status: 'committed', revision: 2 })
    expect(await rebind()).toMatchObject({ status: 'committed', revision: 3 })
    const stale = stateWithAgent()
    Object.assign(stale.workspaces[0].nodes[0], {
      title: 'Edited',
      titlePinnedByUser: true,
      titleIsLiteral: true,
      position: { x: 9, y: 8 },
    })
    stale.workspaces[0].nodes[0].agent.model = 'new'
    Object.assign(stale.workspaces[0].nodes[0].agent, { prompt: 'Edited prompt' })
    const result = await store.writeAppState(stale, { expectedRevision: 3 })
    expect(result).toMatchObject({
      ok: true,
      revision: 4,
      corrected: true,
      effectiveState: {
        workspaces: [
          {
            nodes: [
              {
                sessionId: 'runtime',
                title: 'Edited',
                titlePinnedByUser: true,
                titleIsLiteral: true,
                position: { x: 9, y: 8 },
                agent: { ...tupleB, model: 'new', prompt: 'Edited prompt' },
              },
            ],
          },
        ],
      },
    })
    expect(await store.writeWorkspaceStateRaw(JSON.stringify(stale))).toMatchObject({
      ok: true,
      revision: 5,
      corrected: true,
    })
  })
  it.each([
    ['agent', { agent: null }],
    ['agent', { agent: [] }],
    ['agent.provider', { agent: { provider: 'codex' } }],
    ['kind', { kind: 'terminal' }],
    ['workerBinding', { workerBinding: { endpointId: 'remote', mountId: null } }],
  ])('rejects identity changes to %s without writing anything', async (field, patch) => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const before = await store.readAppStateSnapshot()
    const state = stateWithAgent()
    Object.assign(state.workspaces[0].nodes[0], patch)
    for (const result of [
      await store.writeAppState(state),
      await store.writeWorkspaceStateRaw(JSON.stringify(state)),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        reason: 'unknown',
        error: {
          code: 'persistence.owned_node_identity_conflict',
          details: { nodeId: 'agent', field },
        },
      })
    }
    expect(await store.readAppStateSnapshot()).toEqual(before)
  })
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['invalid', { endpointId: '' }],
  ])(
    'rejects %s owned route inside a remote-targeted Space atomically',
    async (_label, binding) => {
      const base = stateWithAgent()
      const state = {
        ...base,
        workspaces: [
          {
            ...base.workspaces[0],
            nodes: [
              {
                ...base.workspaces[0].nodes[0],
                sessionId: 'runtime',
                workerBinding: { endpointId: 'local', mountId: null },
              },
            ],
            spaces: [
              {
                id: 'space',
                name: 'Remote Space',
                directoryPath: '/repo',
                targetMountId: 'remote-mount',
                nodeIds: ['agent'],
              },
            ],
          },
        ],
      }
      expect(await store.writeAppState(state)).toMatchObject({ ok: true })
      await activate()
      const before = await store.readAppStateSnapshot()
      const rowBefore = sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()
      const candidate = structuredClone(state)
      const node: Record<string, unknown> = candidate.workspaces[0].nodes[0]
      delete node.workerBinding
      if (binding !== undefined) {
        node.workerBinding = binding
      }
      node.title = 'Must not be committed'
      const expectRejectedWrite = async (mode: 'revisioned' | 'raw') => {
        const result =
          mode === 'raw'
            ? await store.writeWorkspaceStateRaw(JSON.stringify(candidate))
            : await store.writeAppState(candidate, { expectedRevision: 2 })
        expect(result).toMatchObject({
          ok: false,
          reason: 'unknown',
          error: {
            code: 'persistence.owned_node_identity_conflict',
            details: { nodeId: 'agent', field: 'workerBinding', reason: 'incompatible' },
          },
        })
        expect(await store.readAppStateSnapshot()).toEqual(before)
        expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()).toEqual(rowBefore)
        expect(sql.prepare('SELECT * FROM retired_managed_nodes').all()).toEqual([])
      }
      await expectRejectedWrite('revisioned')
      await expectRejectedWrite('raw')
      expect(before).toMatchObject({
        revision: 2,
        state: {
          workspaces: [
            {
              nodes: [{ workerBinding: { endpointId: 'local', mountId: null } }],
              spaces: [{ targetMountId: 'remote-mount', nodeIds: ['agent'] }],
            },
          ],
        },
      })
    },
  )
  it('retires deleted identities and rejects snapshot and lifecycle resurrection', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const deleted = stateWithAgent()
    deleted.workspaces[0].nodes = []
    expect(await store.writeAppState(deleted)).toMatchObject({ ok: true, revision: 3 })
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').all()).toEqual([])
    expect(sql.prepare('SELECT * FROM retired_managed_nodes').get()).toMatchObject({
      node_id: 'agent',
      retired_revision: 3,
    })
    for (const result of [
      await store.writeAppState(stateWithAgent(), { expectedRevision: 3 }),
      await store.writeWorkspaceStateRaw(JSON.stringify(stateWithAgent())),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'persistence.owned_node_identity_conflict',
          details: { field: 'id', reason: 'retired' },
        },
      })
    }
    expect(await activate()).toEqual({ status: 'nodeGone' })
    expect(await rebind()).toEqual({ status: 'nodeGone' })
    expect(await store.readAppStateRevision()).toBe(3)
  })
  it('orders runtime fencing, expected values and idempotent activation IDs', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    expect(await activate()).toMatchObject({ status: 'alreadyApplied', revision: 2 })
    expect(
      await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'launch',
        runtimeSessionId: 'changed',
        tuple: tupleA,
      }),
    ).toEqual({ status: 'conflict' })
    expect(
      await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'later',
        runtimeSessionId: 'later',
        tuple: tupleB,
        expected: { activationId: 'stale', tuple: tupleA },
      }),
    ).toEqual({ status: 'superseded' })
    expect(
      await store.commitManagedClaudeRebind({
        nodeId: 'agent',
        activationId: 'r',
        runtimeSessionId: 'stale',
        expected: tupleA,
        next: tupleB,
      }),
    ).toEqual({ status: 'superseded' })
    expect(
      await store.commitManagedClaudeRebind({
        nodeId: 'agent',
        activationId: 'r',
        runtimeSessionId: 'runtime',
        expected: tupleB,
        next: tupleB,
      }),
    ).toEqual({ status: 'conflict' })
    await rebind()
    expect(await rebind()).toMatchObject({ status: 'alreadyApplied', revision: 3 })
    expect(
      await store.commitManagedClaudeRebind({
        nodeId: 'agent',
        activationId: 'rebind',
        runtimeSessionId: 'runtime',
        expected: tupleB,
        next: tupleA,
      }),
    ).toEqual({ status: 'conflict' })
    expect(await store.readAppStateRevision()).toBe(3)
  })
  it('rolls back ledger, node and revision on an injected node update failure', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const before = await store.readAppStateSnapshot()
    const row = sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()
    sql.exec(
      "CREATE TRIGGER fail_update BEFORE UPDATE ON nodes BEGIN SELECT RAISE(ABORT, 'injected'); END",
    )
    expect(await rebind()).toEqual({ status: 'retryableFailure', outcome: 'notCommitted' })
    expect(await store.readAppStateSnapshot()).toEqual(before)
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()).toEqual(row)
  })
  it('rolls back first-seen ownership and revision when reinsertion fails', async () => {
    await activate()
    sql.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON nodes BEGIN SELECT RAISE(ABORT, 'injected'); END",
    )
    expect(await store.writeAppState(stateWithAgent())).toMatchObject({ ok: false })
    expect(await store.readAppStateRevision()).toBe(0)
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()).toMatchObject({
      node_seen: 0,
      updated_revision: 0,
    })
    sql.exec('DROP TRIGGER fail_insert')
    expect(await store.writeAppState(stateWithAgent())).toMatchObject({
      ok: true,
      corrected: true,
      revision: 1,
    })
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()).toMatchObject({
      node_seen: 1,
      updated_revision: 1,
    })
  })
  it('rolls back the outer raw transaction when scrollback insertion fails', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const before = await store.readAppStateSnapshot()
    const row = sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()
    const state = stateWithAgent()
    state.workspaces[0].nodes = []
    const raw = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          nodes: [{ id: 'terminal', kind: 'terminal', scrollback: 'content' }],
        },
      ],
    }
    sql.exec(
      "CREATE TRIGGER fail_scrollback BEFORE INSERT ON node_scrollback BEGIN SELECT RAISE(ABORT, 'injected'); END",
    )
    expect(await store.writeWorkspaceStateRaw(JSON.stringify(raw))).toMatchObject({ ok: false })
    expect(await store.readAppStateSnapshot()).toEqual(before)
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').get()).toEqual(row)
    expect(sql.prepare('SELECT * FROM retired_managed_nodes').all()).toEqual([])
  })
  it('preserves settled tuples without forcing a runtime onto later snapshots', async () => {
    await store.writeAppState(stateWithAgent())
    expect(
      await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'settled',
        runtimeSessionId: null,
        tuple: tupleB,
      }),
    ).toMatchObject({ status: 'committed', revision: 2 })
    expect(await store.writeAppState(stateWithAgent())).toMatchObject({ ok: true, corrected: true })
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ sessionId: 'old', agent: tupleB }] }],
    })
  })
  it('keeps equivalent explicit local routes and rejects mount changes', async () => {
    const state = stateWithAgent()
    Object.assign(state.workspaces[0].nodes[0], {
      workerBinding: { endpointId: 'local', mountId: null },
    })
    await store.writeAppState(state)
    await activate()
    Object.assign(state.workspaces[0].nodes[0], {
      workerBinding: { endpointId: ' local ', mountId: '' },
    })
    expect(await store.writeAppState(state)).toMatchObject({ ok: true })
    Object.assign(state.workspaces[0].nodes[0], {
      workerBinding: { endpointId: 'local', mountId: 'mount' },
    })
    expect(await store.writeAppState(state)).toMatchObject({
      ok: false,
      error: { details: { field: 'workerBinding' } },
    })
  })
  it('reports unknown after a lost commit result and resolves a retry without another revision', async () => {
    await store.writeAppState(stateWithAgent())
    const original = sql.transaction.bind(sql)
    const driver = vi.spyOn(sql, 'transaction').mockImplementationOnce(((body: () => unknown) => ({
      immediate: () => {
        original(body).immediate()
        throw new Error('lost commit result')
      },
    })) as typeof sql.transaction)
    const input = {
      nodeId: 'agent',
      activationId: 'unknown',
      runtimeSessionId: 'runtime',
      tuple: tupleB,
    }
    try {
      const result = await createManagedClaudeResumeStore(
        sql,
        () => null,
      ).activateManagedClaudeRuntime(input)
      expect(result).toEqual({ status: 'retryableFailure', outcome: 'unknown' })
    } finally {
      driver.mockRestore()
    }
    expect(await store.activateManagedClaudeRuntime(input)).toMatchObject({
      status: 'alreadyApplied',
      revision: 2,
    })
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ agent: tupleB }] }],
    })
  })
  it('updates activation with a matching expected row and protects the full tuple including null', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const empty = { resumeSessionId: null, resumeSessionIdVerified: false }
    expect(
      await store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'next',
        runtimeSessionId: 'next-runtime',
        tuple: empty,
        expected: { activationId: 'launch', tuple: tupleA },
      }),
    ).toMatchObject({ status: 'committed', revision: 3 })
    expect(await store.writeAppState(stateWithAgent(), { expectedRevision: 3 })).toMatchObject({
      ok: true,
      revision: 4,
      corrected: true,
      effectiveState: { workspaces: [{ nodes: [{ sessionId: 'next-runtime', agent: empty }] }] },
    })
  })
})
