// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { createManagedClaudeResumeRead } from '../../../src/platform/persistence/sqlite/managedClaudeResumeRead'
import { tupleA, stateWithAgent } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude launch lifecycle', () => {
  let root: string
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  let sql: Database.Database
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-managed-launch-'))
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

  it('observes row-only activation and first persistence without inventing a revision', async () => {
    expect(await activate()).toEqual({ status: 'committed' })
    expect(store.observeManagedClaudeNode('agent')).toMatchObject({
      binding: { nodeSeen: false, bindingRevision: 0, observedRevision: 0 },
      context: null,
    })
    expect(store.isManagedClaudeRuntimeReferenced('runtime')).toBe(true)
    await store.writeAppState(stateWithAgent())
    expect(store.observeManagedClaudeNode('agent')).toMatchObject({
      binding: { nodeSeen: true, observedRevision: 1 },
    })
  })
  it('observes deletion only after the outer commit and isolates observer errors', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const observer = vi.fn(() => {
      expect(store.observeManagedClaudeNode('agent').retired).toBe(true)
      throw new Error('observer')
    })
    store.onAppStateCommitted(observer)
    const state = stateWithAgent()
    state.workspaces[0].nodes = []
    expect(await store.writeWorkspaceStateRaw(JSON.stringify(state))).toMatchObject({
      ok: true,
      revision: 3,
    })
    expect(observer).toHaveBeenCalledWith({
      revision: 3,
      removedNodeIds: ['agent'],
      removedRuntimeSessionIds: ['runtime'],
      removedManagedRuntimeSessionIds: ['runtime'],
    })
  })
  it('outer raw rollback emits no deletion', async () => {
    await store.writeAppState(stateWithAgent())
    await activate()
    const observer = vi.fn()
    store.onAppStateCommitted(observer)
    sql.exec(
      "CREATE TRIGGER fail_scrollback BEFORE INSERT ON node_scrollback BEGIN SELECT RAISE(ABORT, 'injected'); END",
    )
    const state = stateWithAgent()
    const raw = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          nodes: [{ id: 'terminal', kind: 'terminal', scrollback: 'content' }],
        },
      ],
    }
    expect(await store.writeWorkspaceStateRaw(JSON.stringify(raw))).toMatchObject({ ok: false })
    expect(observer).not.toHaveBeenCalled()
    expect(store.observeManagedClaudeNode('agent').binding?.runtimeSessionId).toBe('runtime')
  })
  it('reconciles a lost commit with expected without replay and publishes its exact revision', async () => {
    await store.writeAppState(stateWithAgent())
    const { ManagedClaudeLaunchOwner } =
      await import('../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner')
    const { createManagedClaudeResumeStore } =
      await import('../../../src/platform/persistence/sqlite/managedClaudeResumeStore')
    const reads = createManagedClaudeResumeRead(sql)
    const publish = vi.fn(),
      kill = vi.fn(async () => {})
    const activateLost = vi.fn(async input => {
      const original = sql.transaction.bind(sql)
      const spy = vi.spyOn(sql, 'transaction').mockImplementationOnce(((body: () => unknown) => ({
        immediate: () => {
          original(body).immediate()
          throw new Error('lost commit result')
        },
      })) as typeof sql.transaction)
      let result
      try {
        result = await createManagedClaudeResumeStore(sql, () => null).activateManagedClaudeRuntime(
          input,
        )
      } finally {
        spy.mockRestore()
      }
      await store.writeAppState(stateWithAgent())
      return result
    })
    const owner = new ManagedClaudeLaunchOwner({
      createId: () => 'lost',
      observeNode: reads.observeManagedClaudeNode,
      isRuntimeReferenced: reads.isManagedClaudeRuntimeReferenced,
      activateManagedClaudeRuntime: activateLost,
      killExactRuntime: kill,
      publishCommittedActivation: publish,
    })
    const attempt = owner.reserve('agent')
    attempt.expected = {
      activationId: null,
      tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
    }
    const receipt = await owner.complete(attempt, {
      runtimeSessionId: 'lost-runtime',
      tuple: tupleA,
    })
    expect(receipt).toMatchObject({ commitRevision: 2, binding: { observedRevision: 3 } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
    expect(activateLost).toHaveBeenCalledTimes(1)
    expect(kill).not.toHaveBeenCalled()
    owner.dispose()
  })
  it('refuses definitive reads inside an unresolved transaction', async () => {
    const read = createManagedClaudeResumeRead(sql)
    sql.exec('BEGIN IMMEDIATE')
    try {
      expect(() => read.observeManagedClaudeNode('agent')).toThrow()
      expect(() => read.isManagedClaudeRuntimeReferenced('runtime')).toThrow()
    } finally {
      sql.exec('ROLLBACK')
    }
    expect(read.observeManagedClaudeNode('agent').binding).toBeNull()
  })
  it('observes deletion before first adoption even without a ledger row', async () => {
    await store.writeAppState(stateWithAgent())
    const observer = vi.fn()
    store.onAppStateCommitted(observer)
    const state = stateWithAgent()
    state.workspaces[0].nodes = []
    await store.writeAppState(state)
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({ removedNodeIds: ['agent'] }))
  })
})

// The adapter must reject uncommitted visibility even if every activation field matches.
describeWithElectronNativeModules('managed Claude uncertain transaction visibility', () => {
  it('retains an unknown runtime while the connection remains in a transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-managed-uncertain-'))
    const dbPath = join(root, 'state.db')
    const store = await createPersistenceStore({ dbPath, strictRecovery: true })
    const sql = new Database(dbPath)
    try {
      await store.writeAppState(stateWithAgent())
      const { ManagedClaudeLaunchOwner } =
        await import('../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner')
      const { createManagedClaudeResumeStore } =
        await import('../../../src/platform/persistence/sqlite/managedClaudeResumeStore')
      const reads = createManagedClaudeResumeRead(sql)
      const kill = vi.fn(async () => {}),
        publish = vi.fn()
      const owner = new ManagedClaudeLaunchOwner({
        createId: () => 'uncertain',
        observeNode: reads.observeManagedClaudeNode,
        isRuntimeReferenced: reads.isManagedClaudeRuntimeReferenced,
        killExactRuntime: kill,
        publishCommittedActivation: publish,
        activateManagedClaudeRuntime: async input => {
          const original = sql.transaction.bind(sql)
          const spy = vi.spyOn(sql, 'transaction').mockImplementationOnce(((
            body: () => unknown,
          ) => ({
            immediate: () => {
              sql.exec('BEGIN IMMEDIATE')
              body()
              throw new Error('commit and rollback unavailable')
            },
          })) as typeof sql.transaction)
          try {
            return await createManagedClaudeResumeStore(
              sql,
              () => null,
            ).activateManagedClaudeRuntime(input)
          } finally {
            spy.mockRestore()
            sql.transaction = original
          }
        },
      })
      await expect(
        owner.complete(owner.reserve('agent'), {
          runtimeSessionId: 'uncertain-runtime',
          tuple: tupleA,
        }),
      ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
      expect(sql.inTransaction).toBe(true)
      expect(sql.prepare('SELECT activation_id FROM managed_claude_resume_bindings').get()).toEqual(
        { activation_id: 'uncertain' },
      )
      await expect(owner.assertReady(owner.reserve('agent'))).rejects.toMatchObject({
        details: { outcome: 'unknown' },
      })
      expect(kill).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      sql.exec('ROLLBACK')
      expect(reads.observeManagedClaudeNode('agent').binding).toBeNull()
      owner.dispose()
    } finally {
      if (sql.inTransaction) {
        sql.exec('ROLLBACK')
      }
      sql.close()
      store.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
