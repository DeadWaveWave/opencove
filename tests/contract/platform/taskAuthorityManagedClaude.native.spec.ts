// @vitest-environment node
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { migrate } from '@platform/persistence/sqlite/migrate'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { writeNormalizedAppState } from '@platform/persistence/sqlite/write'
import { readAppStateFromDb } from '@platform/persistence/sqlite/read'
import { createManagedClaudeResumeStore } from '@platform/persistence/sqlite/managedClaudeResumeStore'
import {
  activateTaskAuthority,
  createTaskAuthorityRepository,
} from '@platform/persistence/sqlite/taskAuthorityStore'
import { enforceTaskAuthority } from '@platform/persistence/sqlite/taskAuthorityGate'
import { TaskMutationOwner } from '@contexts/task/application/TaskMutationOwner'
import { taskAuthorityState } from './taskAuthorityFixtures'

let db: Database.Database | undefined
afterEach(() => {
  db?.close()
  db = undefined
})
async function setup() {
  const sql = (db = new Database(':memory:'))
  migrate(sql)
  const state = normalizePersistedAppState(taskAuthorityState())!
  state.workspaces[0].nodes.find(n => n.id === 'a')!.agent = {
    provider: 'claude-code',
    executionDirectory: '/repo',
  }
  writeNormalizedAppState(sql, state)
  const read = () => readAppStateFromDb(drizzle(sql))!
  const managed = createManagedClaudeResumeStore(sql, read)
  expect(
    await managed.activateManagedClaudeRuntime({
      nodeId: 'a',
      activationId: 'initial',
      runtimeSessionId: 'initial-runtime',
      tuple: { resumeSessionId: 'initial-conversation', resumeSessionIdVerified: true },
    }),
  ).toMatchObject({ status: 'committed' })
  activateTaskAuthority(sql, { uuid: randomUUID, now: () => new Date().toISOString() })
  const repo = createTaskAuthorityRepository(sql)
  const task = () => repo.transaction(tx => tx.read('task')!)
  const receipt = new TaskMutationOwner(repo, {
    uuid: randomUUID,
    now: () => new Date().toISOString(),
  }).execute(
    { kind: 'human', identityId: 'installation' },
    {
      operation: 'task.claim',
      nodeId: 'task',
      requestId: randomUUID(),
      expectedAuthorityGeneration: task().generation,
      holderNodeId: 'a',
      note: 'Working',
    },
    () => {},
  )
  const holder = () => sql.prepare('SELECT * FROM task_claim_holders WHERE node_id = ?').get('a')
  const activate = () =>
    managed.activateManagedClaudeRuntime({
      nodeId: 'a',
      activationId: 'next',
      runtimeSessionId: 'next-runtime',
      tuple: { resumeSessionId: 'next-conversation', resumeSessionIdVerified: true },
    })
  return { sql, read, task, receipt, holder, activate, managed }
}
describeWithElectronNativeModules('task claim and managed Claude runtime coexistence', () => {
  it('publishes a fresh snapshot after a trusted runtime rebind without replacing the lease', async () => {
    const { sql, read, task, holder, activate } = await setup()
    const beforeTask = task()
    expect(await activate()).toMatchObject({ status: 'committed' })
    expect(() => writeNormalizedAppState(sql, read())).not.toThrow()
    expect(holder()).toMatchObject({ session_id: 'next-runtime' })
    expect(task()).toEqual(beforeTask)
    const forged = structuredClone(read())
    forged.workspaces[0].nodes.find(n => n.id === 'a')!.sessionId = 'forged-runtime'
    expect(() => enforceTaskAuthority(sql, forged)).toThrowError(
      expect.objectContaining({ code: 'persistence.owned_node_identity_conflict' }),
    )
    // Composed writes let W8 correct its owned runtime, never rewrite the task fence from input.
    expect(writeNormalizedAppState(sql, forged)).toMatchObject({ corrected: true })
    expect(holder()).toMatchObject({ session_id: 'next-runtime' })
    expect(read().workspaces[0].nodes.find(n => n.id === 'a')!.sessionId).toBe('next-runtime')
    expect(task()).toEqual(beforeTask)
  })
  it('rolls back both owners and the snapshot if holder coordination fails', async () => {
    const { sql, read, task, holder, activate } = await setup()
    const before = {
      state: read(),
      task: task(),
      holder: holder(),
      binding: sql.prepare('SELECT * FROM managed_claude_resume_bindings').all(),
      revision: sql.prepare("SELECT value FROM app_meta WHERE key = 'app_state_revision'").get(),
    }
    sql.exec(
      "CREATE TRIGGER fail_holder_rebind BEFORE UPDATE OF session_id ON task_claim_holders BEGIN SELECT RAISE(ABORT, 'injected holder failure'); END",
    )
    expect(await activate()).toMatchObject({ status: 'retryableFailure', outcome: 'notCommitted' })
    expect(read()).toEqual(before.state)
    expect(task()).toEqual(before.task)
    expect(holder()).toEqual(before.holder)
    expect(sql.prepare('SELECT * FROM managed_claude_resume_bindings').all()).toEqual(
      before.binding,
    )
    expect(
      sql.prepare("SELECT value FROM app_meta WHERE key = 'app_state_revision'").get(),
    ).toEqual(before.revision)
  })
  it('keeps holder fencing current across conversation-only rebind and rejects superseded activation', async () => {
    const { sql, managed, read, task, activate } = await setup()
    const beforeTask = task()
    expect(await activate()).toMatchObject({ status: 'committed' })
    expect(
      await managed.commitManagedClaudeRebind({
        nodeId: 'a',
        activationId: 'conversation',
        runtimeSessionId: 'next-runtime',
        expected: { resumeSessionId: 'next-conversation', resumeSessionIdVerified: true },
        next: { resumeSessionId: 'third-conversation', resumeSessionIdVerified: true },
      }),
    ).toMatchObject({ status: 'committed' })
    expect(
      await managed.activateManagedClaudeRuntime({
        nodeId: 'a',
        activationId: 'stale',
        runtimeSessionId: 'stale-runtime',
        tuple: { resumeSessionId: 'stale-conversation', resumeSessionIdVerified: true },
        expected: {
          activationId: 'initial',
          tuple: { resumeSessionId: 'initial-conversation', resumeSessionIdVerified: true },
        },
      }),
    ).toMatchObject({ status: 'superseded' })
    expect(() => writeNormalizedAppState(sql, read())).not.toThrow()
    expect(task()).toEqual(beforeTask)
  })
})
