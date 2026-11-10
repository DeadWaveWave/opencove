// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { deriveNodeLineage } from '../../../src/contexts/workspace/domain/nodeLineage'
import { stateWithAgent, tupleB } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('node creation with managed Claude resume bindings', () => {
  let root: string
  let sql: Database.Database
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  const lineage = deriveNodeLineage({ nodeId: 'child', callerNodeId: 'agent', parent: null })
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-lineage-resume-'))
    const dbPath = join(root, 'state.db')
    store = await createPersistenceStore({ dbPath, strictRecovery: true })
    sql = new Database(dbPath)
  })
  afterEach(async () => {
    sql?.close()
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  async function pendingChild() {
    const state = stateWithAgent()
    expect(await store.writeAppState(state)).toMatchObject({ ok: true, revision: 1 })
    expect(
      await store.activateManagedClaudeRuntime({
        nodeId: 'child',
        activationId: 'child-activation',
        runtimeSessionId: 'child-runtime',
        tuple: tupleB,
      }),
    ).toEqual({ status: 'committed' })
    state.workspaces[0].nodes.push({
      ...structuredClone(state.workspaces[0].nodes[0]),
      id: 'child',
    })
    return state
  }

  it('applies the ledger gate and returns the effective creation receipt with lineage', async () => {
    const state = await pendingChild()
    const result = await store.commitCreatedNodeState!(state, { expectedRevision: 1, lineage })
    expect(result).toMatchObject({ ok: true, revision: 2, corrected: true })
    expect(result.effectiveState).toMatchObject({
      workspaces: [
        { nodes: [{ id: 'agent' }, { id: 'child', sessionId: 'child-runtime', agent: tupleB }] },
      ],
    })
    if (!result.ok) {
      throw Error('Creation commit failed')
    }
    expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(result.effectiveState)))
    expect(await store.readAppStateSnapshot!()).toEqual({
      revision: 2,
      state: result.effectiveState,
    })
    expect((await store.nodeLineage!.readMany(['child'])).get('child')).toEqual(lineage)
    expect(
      sql
        .prepare('SELECT node_seen FROM managed_claude_resume_bindings WHERE node_id = ?')
        .get('child'),
    ).toEqual({ node_seen: 1 })
  })

  it('keeps retirement and lineage when a creation snapshot tries to resurrect a retired ID', async () => {
    const state = await pendingChild()
    expect(
      await store.commitCreatedNodeState!(state, { expectedRevision: 1, lineage }),
    ).toMatchObject({ ok: true })
    expect(await store.writeAppState(stateWithAgent(), { expectedRevision: 2 })).toMatchObject({
      ok: true,
      revision: 3,
    })
    expect(sql.prepare('SELECT node_id FROM retired_managed_nodes').all()).toEqual([
      { node_id: 'child' },
    ])
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').all()).toEqual([])
    state.workspaces[0].nodes.push({
      ...structuredClone(state.workspaces[0].nodes[0]),
      id: 'new-child',
    })
    const next = deriveNodeLineage({ nodeId: 'new-child', callerNodeId: 'agent', parent: null })
    expect(
      await store.commitCreatedNodeState!(state, { expectedRevision: 3, lineage: next }),
    ).toMatchObject({
      ok: false,
      reason: 'unknown',
      error: {
        code: 'persistence.owned_node_identity_conflict',
        details: { nodeId: 'child', reason: 'retired' },
      },
    })
    expect(await store.readAppStateRevision()).toBe(3)
    expect((await store.nodeLineage!.readMany(['new-child'])).size).toBe(0)
    expect((await store.nodeLineage!.readMany(['child'])).get('child')).toEqual(lineage)
    expect(await store.readAppState()).toMatchObject({ workspaces: [{ nodes: [{ id: 'agent' }] }] })
  })

  it('rolls back ledger first-seen, node state and revision when lineage insertion fails', async () => {
    const state = await pendingChild()
    const binding = sql.prepare('SELECT * FROM managed_claude_resume_bindings').all()
    sql.exec(
      "CREATE TRIGGER reject_lineage BEFORE INSERT ON node_lineage BEGIN SELECT RAISE(ABORT, 'lineage failure'); END",
    )
    expect(
      await store.commitCreatedNodeState!(state, { expectedRevision: 1, lineage }),
    ).toMatchObject({ ok: false })
    expect(await store.readAppStateRevision()).toBe(1)
    expect(sql.prepare('SELECT id FROM nodes').all()).toEqual([{ id: 'agent' }])
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').all()).toEqual(binding)
    expect(sql.prepare('SELECT node_seen FROM managed_claude_resume_bindings').get()).toEqual({
      node_seen: 0,
    })
    expect((await store.nodeLineage!.readMany(['child'])).size).toBe(0)
  })
})
