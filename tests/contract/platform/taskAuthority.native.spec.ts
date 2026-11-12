// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { migrate } from '@platform/persistence/sqlite/migrate'
import { writeNormalizedAppState } from '@platform/persistence/sqlite/write'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { readAppStateFromDb } from '@platform/persistence/sqlite/read'
import {
  activateTaskAuthority,
  createTaskAuthorityRepository,
} from '@platform/persistence/sqlite/taskAuthorityStore'
import { TaskMutationOwner } from '@contexts/task/application/TaskMutationOwner'
import type { TaskAuthorityCommand } from '@shared/contracts/taskAuthority'
import { taskAuthorityState } from './taskAuthorityFixtures'

const databases: Database.Database[] = []
let root: string | undefined
const human = { kind: 'human', identityId: 'installation' } as const
const allow = () => {}
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close()
  }
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'opencove-task-authority-'))
  const file = join(root, 'state.db')
  const a = new Database(file)
  databases.push(a)
  migrate(a)
  writeNormalizedAppState(a, normalizePersistedAppState(taskAuthorityState())!)
  const b = new Database(file)
  databases.push(b)
  b.pragma('busy_timeout = 5000')
  const repo = (db: Database.Database) => createTaskAuthorityRepository(db)
  const owner = (db: Database.Database) =>
    new TaskMutationOwner(repo(db), { uuid: randomUUID, now: () => new Date().toISOString() })
  activateTaskAuthority(a, { uuid: randomUUID, now: () => new Date().toISOString() })
  const record = (id: string) => repo(a).transaction(tx => tx.read(id)!)
  const command = (
    id: string,
    data: Omit<TaskAuthorityCommand, 'requestId' | 'nodeId' | 'expectedAuthorityGeneration'>,
  ): TaskAuthorityCommand =>
    ({
      requestId: randomUUID(),
      nodeId: id,
      expectedAuthorityGeneration: record(id).generation,
      ...data,
    }) as TaskAuthorityCommand
  return { a, b, owner, repo, record, command }
}

describeWithElectronNativeModules('task authority transactions', () => {
  it('installs empty schema without adopting or interfering with existing UI writes', () => {
    const db = new Database(':memory:')
    databases.push(db)
    migrate(db)
    const state = taskAuthorityState()
    writeNormalizedAppState(db, normalizePersistedAppState(state)!)
    state.workspaces[0].nodes[2].task!.text = 'UI edit'
    expect(writeNormalizedAppState(db, normalizePersistedAppState(state)!).corrected).toBe(false)
    expect(db.prepare('SELECT count(*) AS count FROM task_field_authority').get()).toEqual({
      count: 0,
    })
  })
  it('arbitrates independent callers on the same database and preserves the losing prompt boundary', async () => {
    const { a, b, owner, command, record } = await setup()
    expect(a.name).toBe(b.name)
    let ready = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    let dispatches = 0
    const contenders = [a, b].map(async (db, i) => {
      const input = command('task', {
        operation: 'task.claim',
        holderNodeId: i ? 'b' : 'a',
        note: null,
      })
      if (++ready === 2) {
        release()
      }
      await barrier
      const receipt = owner(db).execute(human, input, allow)
      dispatches++
      return receipt
    })
    const results = await Promise.allSettled(contenders)
    expect(ready).toBe(2)
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({
      reason: { code: 'task.claimed' },
    })
    expect(dispatches).toBe(1)
    expect(record('task').claim?.holderNodeId).toBe('a')
    expect(readAppStateFromDb(drizzle(b))).toMatchObject({
      workspaces: [
        {
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'a',
              agent: expect.objectContaining({ taskId: 'task' }),
            }),
          ]),
        },
      ],
    })
  })
  it('stores exact historical receipts across reopen and rejects mismatched input', async () => {
    const { a, b, owner, command, record } = await setup()
    const input = command('note', { operation: 'task.note.append', text: 'Progress' })
    const first = owner(a).execute(human, input, allow)
    owner(b).execute(
      human,
      command('note', { operation: 'task.note.append', text: 'Later' }),
      allow,
    )
    const reopened = new Database(a.name)
    databases.push(reopened)
    expect(owner(reopened).execute(human, input, allow)).toEqual({ ...first, replayed: true })
    expect(() =>
      owner(b).execute(human, { ...input, text: 'Changed' } as TaskAuthorityCommand, allow),
    ).toThrowError(expect.objectContaining({ code: 'task.request_mismatch' }))
    expect(record('note').text).toBe('Original 🌊\nProgress\nLater')
    expect(first.totalBytes).toBe(Buffer.byteLength('Original 🌊\nProgress'))
  })
  it.each([false, true])(
    'corrects stale protected fields while retaining layout (raw=%s)',
    async raw => {
      const { a, owner, command } = await setup()
      const stale = readAppStateFromDb(drizzle(a))!
      owner(a).execute(
        human,
        command('task', { operation: 'task.claim', holderNodeId: 'a', note: 'Working' }),
        allow,
      )
      owner(a).execute(
        human,
        command('note', { operation: 'task.note.append', text: 'Accepted' }),
        allow,
      )
      const node = stale.workspaces[0].nodes.find(n => n.id === 'task')!
      node.position.x = 700
      expect((node.task as Record<string, unknown>).claim).toBeNull()
      const submitted = raw ? JSON.parse(JSON.stringify(stale)) : stale
      expect((submitted.workspaces[0].nodes[2].task as Record<string, unknown>).text).toBe(
        'Original 🌊',
      )
      const written = writeNormalizedAppState(a, normalizePersistedAppState(submitted)!)
      expect(written.corrected).toBe(true)
      expect(written.effectiveState.workspaces[0].nodes[0]).toMatchObject({
        position: { x: 700 },
        task: { status: 'doing', claim: { holderNodeId: 'a' } },
      })
      expect(written.effectiveState.workspaces[0].nodes[2]).toMatchObject({
        task: { text: 'Original 🌊\nAccepted' },
      })
    },
  )
  it('rejects omission, kind/project changes, unregistered creation and holder deletion or rebinding', async () => {
    const { a, owner, command } = await setup()
    owner(a).execute(
      human,
      command('task', { operation: 'task.claim', holderNodeId: 'a', note: null }),
      allow,
    )
    for (const mutate of [
      (s: ReturnType<typeof taskAuthorityState>) => {
        s.workspaces[0].nodes.splice(0, 1)
      },
      (s: ReturnType<typeof taskAuthorityState>) => {
        s.workspaces[0].nodes[0].kind = 'note'
      },
      (s: ReturnType<typeof taskAuthorityState>) => {
        s.workspaces[0].id = 'other'
      },
      (s: ReturnType<typeof taskAuthorityState>) => {
        s.workspaces[0].nodes.push({ ...s.workspaces[0].nodes[0], id: 'forged' })
      },
      (s: ReturnType<typeof taskAuthorityState>) => {
        s.workspaces[0].nodes = s.workspaces[0].nodes.filter(n => n.id !== 'a')
      },
      (s: ReturnType<typeof taskAuthorityState>) => {
        s.workspaces[0].nodes.find(n => n.id === 'a')!.sessionId = 'rebound'
      },
    ]) {
      const state = structuredClone(readAppStateFromDb(drizzle(a))) as ReturnType<
        typeof taskAuthorityState
      >
      mutate(state)
      expect(() => writeNormalizedAppState(a, normalizePersistedAppState(state)!)).toThrowError(
        expect.objectContaining({ code: 'persistence.owned_node_identity_conflict' }),
      )
    }
  })
  it('rolls back authority, projection, revision and receipt if a later statement fails', async () => {
    const { a, owner, command, record } = await setup()
    const before = readAppStateFromDb(drizzle(a))
    a.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON task_command_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END",
    )
    expect(() =>
      owner(a).execute(
        human,
        command('note', { operation: 'task.note.append', text: 'Rejected' }),
        allow,
      ),
    ).toThrow('injected')
    expect(record('note').text).toBe('Original 🌊')
    expect(readAppStateFromDb(drizzle(a))).toEqual(before)
    expect(a.prepare('SELECT count(*) AS count FROM task_command_receipts').get()).toEqual({
      count: 0,
    })
  })
  it('does not let observer failure change a successful commit', async () => {
    const { a, command, record } = await setup()
    const repository = createTaskAuthorityRepository(a, () => {
      throw Error('observer')
    })
    const owner = new TaskMutationOwner(repository, {
      uuid: randomUUID,
      now: () => new Date().toISOString(),
    })
    const result = owner.execute(
      human,
      command('note', { operation: 'task.note.append', text: 'Accepted' }),
      allow,
    )
    expect(result.changed).toBe(true)
    expect(record('note').text).toContain('Accepted')
  })
})

describeWithElectronNativeModules('task authority fencing and historical results', () => {
  it('preserves the original lease and annotation for same-holder claims, and prevents a second open task', async () => {
    const { a, owner, command, record } = await setup()
    const first = owner(a).execute(
      human,
      command('task', { operation: 'task.claim', holderNodeId: 'a', note: 'Original' }),
      allow,
    )
    const noop = owner(a).execute(
      human,
      command('task', { operation: 'task.claim', holderNodeId: 'a', note: 'Different' }),
      allow,
    )
    expect(noop).toMatchObject({
      changed: false,
      revision: first.revision,
      lease: first.lease,
      claimNote: 'Original',
    })
    expect(() =>
      owner(a).execute(
        human,
        command('other-task', { operation: 'task.claim', holderNodeId: 'a', note: null }),
        allow,
      ),
    ).toThrowError(expect.objectContaining({ code: 'task.holder_busy' }))
    expect(record('other-task').claim).toBeNull()
  })
  it('rejects old incarnation and text version without changing durable text', async () => {
    const { a, owner, command, record } = await setup()
    const stale = command('note', {
      operation: 'task.note.replace',
      text: 'Old draft',
      expectedTextVersion: 1,
    })
    owner(a).execute(
      human,
      command('note', { operation: 'task.note.append', text: 'Append' }),
      allow,
    )
    expect(() => owner(a).execute(human, stale, allow)).toThrowError(
      expect.objectContaining({ code: 'task.text_stale' }),
    )
    expect(() =>
      owner(a).execute(
        human,
        {
          ...command('note', { operation: 'task.note.append', text: 'Wrong incarnation' }),
          expectedAuthorityGeneration: randomUUID(),
        },
        allow,
      ),
    ).toThrowError(expect.objectContaining({ code: 'task.stale' }))
    expect(record('note').text).toBe('Original 🌊\nAppend')
  })
  it('retains an authorized historical receipt after deletion and rejects snapshot resurrection', async () => {
    const { a, owner, command, record } = await setup()
    const before = readAppStateFromDb(drizzle(a))!
    const input = command('note', { operation: 'task.note.append', text: 'Historical' })
    const first = owner(a).execute(human, input, allow)
    owner(a).execute(
      human,
      command('note', { operation: 'task.retire', expectedVersion: record('note').version }),
      allow,
    )
    expect(owner(a).execute(human, input, allow)).toEqual({ ...first, replayed: true })
    expect(() => writeNormalizedAppState(a, before)).toThrowError(
      expect.objectContaining({ code: 'persistence.owned_node_identity_conflict' }),
    )
    expect(record('note').retired).toBe(true)
  })
})

describeWithElectronNativeModules('unowned task marker publication', () => {
  it('strips forged ownership before activation while preserving ordinary legacy editing', () => {
    const db = new Database(':memory:')
    databases.push(db)
    migrate(db)
    const state = normalizePersistedAppState(taskAuthorityState())!
    Object.assign(state.workspaces[0].nodes[0].task as object, {
      status: 'done',
      taskAuthority: { generation: randomUUID(), version: 999, textVersion: 999 },
      claim: { holderNodeId: 'a', leaseId: randomUUID(), acquiredAt: 'now' },
      claimNote: 'Forged',
      claimGeneration: 999,
    })
    const result = writeNormalizedAppState(db, state)
    expect(result.corrected).toBe(true)
    expect(result.effectiveState.workspaces[0].nodes[0].task).toMatchObject({
      status: 'done',
      requirement: 'Keep requirement',
    })
    expect(result.effectiveState.workspaces[0].nodes[0].task).not.toHaveProperty('taskAuthority')
    expect(result.effectiveState.workspaces[0].nodes[0].task).not.toHaveProperty('claim')
    expect(readAppStateFromDb(drizzle(db))!.workspaces[0].nodes[0].task).not.toHaveProperty(
      'taskAuthority',
    )
  })
})

describeWithElectronNativeModules('compact task receipts', () => {
  it('stores a digest instead of a second copy of submitted text', async () => {
    const { a, owner, command } = await setup()
    const text = 'Sensitive note text '.repeat(100)
    owner(a).execute(human, command('note', { operation: 'task.note.append', text }), allow)
    const row = a.prepare('SELECT fingerprint, result_json FROM task_command_receipts').get() as {
      fingerprint: string
      result_json: string
    }
    expect(row.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(row.result_json).not.toContain('Sensitive note text')
    expect(row.result_json.length).toBeLessThan(1024)
  })
})
