// @vitest-environment node
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import {
  createPersistenceStore,
  type PersistenceStore,
} from '@platform/persistence/sqlite/PersistenceStore'
import {
  activateTaskAuthority,
  createTaskAuthorityRepository,
} from '@platform/persistence/sqlite/taskAuthorityStore'
import { TaskMutationOwner } from '@contexts/task/application/TaskMutationOwner'
import {
  SessionGrantRegistry,
  type SessionGrant,
} from '@app/main/controlSurface/http/sessionGrantRegistry'
import { createAppError } from '@shared/errors/appError'
import type { TaskAuthorityCommand, TaskPrincipal } from '@shared/contracts/taskAuthority'
import { taskAuthorityState } from './taskAuthorityFixtures'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { deleteNodeForNodeControl } from '@contexts/workspace/application/nodeControl/nodeControlDelete'

let root: string | undefined
let db: Database.Database | undefined
let store: PersistenceStore | undefined
const ids = { uuid: randomUUID, now: () => new Date().toISOString() }
const human = { kind: 'human', identityId: 'installation' } as const
const allow = () => {}
afterEach(async () => {
  store?.dispose()
  db?.close()
  store = undefined
  db = undefined
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})
async function setup(terminal = false) {
  root = await mkdtemp(join(tmpdir(), 'opencove-task-auth-'))
  const dbPath = join(root, 'state.db')
  const s = (store = await createPersistenceStore({ dbPath, strictRecovery: true }))
  const state = taskAuthorityState()
  if (terminal) {
    state.workspaces[0].nodes.find(n => n.id === 'a')!.kind = 'terminal'
  }
  expect(await s.writeAppState(state)).toMatchObject({ ok: true })
  const sql = (db = new Database(dbPath))
  activateTaskAuthority(sql, ids)
  const repo = createTaskAuthorityRepository(sql)
  const record = (nodeId: string) => repo.transaction(tx => tx.read(nodeId)!)
  const command = (nodeId: string, data: Record<string, unknown>) =>
    ({
      nodeId,
      requestId: randomUUID(),
      expectedAuthorityGeneration: record(nodeId).generation,
      ...data,
    }) as TaskAuthorityCommand
  const owner = new TaskMutationOwner(s.taskMutations!, ids)
  return { s, sql, owner, command, record, dbPath }
}
const principal = (grant: SessionGrant): TaskPrincipal => ({
  kind: 'session',
  nodeId: grant.nodeId!,
  sessionId: grant.sessionId,
  projectId: grant.projectId,
})
const issue = (registry: SessionGrantRegistry) =>
  registry.issue({ nodeId: 'a', sessionId: 'session-a', projectId: 'project', spaceId: 'main' })

describeWithElectronNativeModules('task authority authentication and production adapters', () => {
  it('replays with a new registry and credential after reopening the production store', async () => {
    const { s, command, dbPath, record } = await setup()
    const registry = new SessionGrantRegistry(() => true)
    const old = issue(registry)
    const input = command('note', { operation: 'task.note.append', text: 'Progress' })
    const owner = new TaskMutationOwner(s.taskMutations!, ids)
    const first = owner.execute(principal(old.grant), input, () => {
      expect(registry.isActive(old.grant.grantId)).toBe(true)
    })
    registry.clear()
    s.dispose()
    const nextRegistry = new SessionGrantRegistry(() => true)
    const next = issue(nextRegistry)
    expect(next.token).not.toBe(old.token)
    expect(next.grant.grantId).not.toBe(old.grant.grantId)
    const reopened = (store = await createPersistenceStore({ dbPath, strictRecovery: true }))
    const receipt = new TaskMutationOwner(reopened.taskMutations!, ids).execute(
      principal(next.grant),
      input,
      () => {
        if (!nextRegistry.isActive(next.grant.grantId)) {
          throw createAppError('control_surface.unauthorized')
        }
      },
    )
    expect(receipt).toEqual({ ...first, replayed: true })
    expect(record('note').text).toBe('Original 🌊\nProgress')
  })
  it('reauthorizes historical receipt lookup, including revocation', async () => {
    const { owner, command, record } = await setup()
    const registry = new SessionGrantRegistry(() => true)
    const { grant } = issue(registry)
    const input = command('note', { operation: 'task.note.append', text: 'Accepted' })
    const check = () => {
      if (!registry.isActive(grant.grantId)) {
        throw createAppError('control_surface.unauthorized')
      }
    }
    owner.execute(principal(grant), input, check)
    registry.clear()
    expect(() => owner.execute(principal(grant), input, check)).toThrowError(
      expect.objectContaining({ code: 'control_surface.unauthorized' }),
    )
    expect(record('note').text).toBe('Original 🌊\nAccepted')
  })
  it('rejects project/session mismatch and impersonation without any mutation', async () => {
    const { owner, command, record } = await setup()
    const registry = new SessionGrantRegistry(() => true)
    const { grant } = issue(registry)
    for (const actor of [
      { ...principal(grant), projectId: 'other' },
      { ...principal(grant), sessionId: 'old' },
    ]) {
      expect(() =>
        owner.execute(
          actor as TaskPrincipal,
          command('note', { operation: 'task.note.append', text: 'Denied' }),
          allow,
        ),
      ).toThrowError(expect.objectContaining({ code: 'common.forbidden' }))
    }
    expect(() =>
      owner.execute(
        principal(grant),
        command('task', { operation: 'task.claim', holderNodeId: 'b', note: null }),
        allow,
      ),
    ).toThrowError(expect.objectContaining({ code: 'common.forbidden' }))
    expect(record('task').claim).toBeNull()
    expect(record('note').text).toBe('Original 🌊')
  })
  it('requires an exact non-degraded observation for a terminal first claim, but not release', async () => {
    const { owner, command, record } = await setup(true)
    const input = command('task', { operation: 'task.claim', holderNodeId: 'a', note: null })
    for (const evidence of [
      undefined,
      { observedAgent: { nodeId: 'a', projectId: 'project', sessionId: 'old', degraded: false } },
      {
        observedAgent: {
          nodeId: 'a',
          projectId: 'project',
          sessionId: 'session-a',
          degraded: true,
        },
      },
    ]) {
      expect(() => owner.execute(human, input, () => evidence)).toThrowError(
        expect.objectContaining({ code: 'common.forbidden' }),
      )
    }
    const receipt = owner.execute(human, input, () => ({
      observedAgent: { nodeId: 'a', projectId: 'project', sessionId: 'session-a', degraded: false },
    }))
    expect(owner.execute(human, input, allow)).toMatchObject({ replayed: true })
    expect(
      owner.execute(
        human,
        command('task', { operation: 'task.release', leaseId: receipt.lease!.leaseId }),
        allow,
      ),
    ).toMatchObject({ changed: true, lease: null })
    expect(record('task').claim).toBeNull()
  })
  it.each([false, true])('enforces the production persistence adapter for raw=%s', async raw => {
    const { s, owner, command } = await setup()
    const stale = normalizePersistedAppState(await s.readAppState())!
    owner.execute(
      human,
      command('note', { operation: 'task.note.append', text: 'Accepted' }),
      allow,
    )
    stale.workspaces[0].nodes[2].position.x = 800
    expect((stale.workspaces[0].nodes[2].task as { text: string }).text).toBe('Original 🌊')
    const result = raw
      ? await s.writeWorkspaceStateRaw(JSON.stringify(stale))
      : await s.writeAppState(stale)
    expect(result).toMatchObject({ ok: true, corrected: true })
    expect(await s.readAppState()).toMatchObject({
      workspaces: [
        {
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'note',
              position: { x: 800, y: 2 },
              task: expect.objectContaining({ text: 'Original 🌊\nAccepted' }),
            }),
          ]),
        },
      ],
    })
  })
  it('blocks a real node.delete holder bypass before runtime cleanup', async () => {
    const { s, owner, command, record } = await setup()
    owner.execute(
      human,
      command('task', { operation: 'task.claim', holderNodeId: 'a', note: null }),
      allow,
    )
    const killSession = vi.fn()
    await expect(
      deleteNodeForNodeControl({
        store: {
          ...s,
          readAppState: async () => normalizePersistedAppState(await s.readAppState()),
        },
        runtime: { killSession },
        input: { nodeId: 'a' },
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'persistence.owned_node_identity_conflict' })
    expect(killSession).not.toHaveBeenCalled()
    expect(record('task').claim?.holderNodeId).toBe('a')
  })
  it('publishes exactly the committed revision once, and not for replay or no-op', async () => {
    const { s, owner, command } = await setup()
    const events: number[] = []
    const unsubscribe = s.onAppStateCommitted!(event => {
      events.push(event.revision)
      throw new Error('subscriber')
    })
    try {
      const input = command('note', { operation: 'task.note.append', text: 'Accepted' })
      const receipt = owner.execute(human, input, allow)
      owner.execute(human, input, allow)
      owner.execute(human, command('note', { operation: 'task.note.append', text: '' }), allow)
      expect(events).toEqual([receipt.revision])
    } finally {
      unsubscribe()
    }
  })
  it('reads authority over a stale snapshot projection', async () => {
    const { s, sql, owner, command } = await setup()
    owner.execute(
      human,
      command('note', { operation: 'task.note.append', text: 'Canonical' }),
      allow,
    )
    sql
      .prepare('UPDATE nodes SET task_json = ? WHERE id = ?')
      .run(JSON.stringify({ text: 'stale' }), 'note')
    expect(await s.readAppState()).toMatchObject({
      workspaces: [
        {
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'note',
              task: expect.objectContaining({ text: 'Original 🌊\nCanonical' }),
            }),
          ]),
        },
      ],
    })
  })
})
