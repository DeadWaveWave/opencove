// @vitest-environment node
import Database from 'better-sqlite3'
import * as stateReader from '../../../src/platform/persistence/sqlite/read'
import { withAgentRunBindings } from '../../../src/app/main/controlSurface/agentRunStatePersistence'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSyncHandlers } from '../../../src/app/main/controlSurface/handlers/syncHandlers'
import { registerPersistenceIpcHandlers } from '../../../src/platform/persistence/sqlite/ipc/register'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from '../ipc/ipcTestUtils'
import { tupleA, tupleB, stateWithAgent } from './managedClaudeResumeBindingFixtures'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))
const ctx = { now: () => new Date() }

describeWithElectronNativeModules('managed Claude resume persistence boundaries', () => {
  let root: string
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-resume-sync-'))
    store = await createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
  })
  afterEach(async () => {
    store?.dispose()
    handlers.clear()
    await rm(root, { recursive: true, force: true })
  })
  async function own() {
    await store.writeAppState(stateWithAgent())
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'launch',
      runtimeSessionId: 'runtime',
      tuple: tupleA,
    })
    await store.commitManagedClaudeRebind({
      nodeId: 'agent',
      activationId: 'rebind',
      runtimeSessionId: 'runtime',
      expected: tupleA,
      next: tupleB,
    })
  }
  it('returns its own revision after a callback commits another write and passes effective state', async () => {
    await own()
    const control = createControlSurface()
    const seen = vi.fn(async (_state: unknown) => {
      await store.writeAppState(stateWithAgent())
    })
    registerSyncHandlers(control, async () => store, { onStatePersisted: seen })
    const result = await control.invoke(ctx, {
      kind: 'command',
      id: 'sync.writeState',
      payload: { state: stateWithAgent(), baseRevision: 3 },
    })
    expect(result).toMatchObject({ ok: true, value: { revision: 4, corrected: true } })
    expect(await store.readAppStateRevision()).toBe(5)
    expect(seen.mock.calls[0]?.[0]).toMatchObject({
      workspaces: [{ nodes: [{ sessionId: 'runtime', agent: tupleB }] }],
    })
  })
  it('passes the raw effective state to callbacks without exposing it on the wire', async () => {
    await own()
    const seen = vi.fn(async (_state: unknown) => {})
    const control = createControlSurface()
    registerSyncHandlers(control, async () => store, { onStatePersisted: seen })
    const result = await control.invoke(ctx, {
      kind: 'command',
      id: 'sync.writeWorkspaceStateRaw',
      payload: { raw: JSON.stringify(stateWithAgent()) },
    })
    expect(result).toMatchObject({ ok: true, value: { revision: 4, corrected: true } })
    if (result.ok) {
      expect(result.value).not.toHaveProperty('effectiveState')
    }
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ workspaces: [{ nodes: [{ agent: tupleB }] }] })
  })
  it('preserves no-ledger persisted bytes and exposes only additive wire fields for all writes', async () => {
    const control = createControlSurface()
    registerSyncHandlers(control, async () => store)
    registerPersistenceIpcHandlers(async () => store)
    const state = stateWithAgent()
    const revised = await control.invoke(ctx, {
      kind: 'command',
      id: 'sync.writeState',
      payload: { state, baseRevision: 0 },
    })
    expect(revised).toMatchObject({ ok: true, value: { revision: 1, corrected: false } })
    const golden = JSON.stringify(await store.readAppState())
    expect(JSON.parse(golden)).toMatchSnapshot('unowned app state')
    const raw = await control.invoke(ctx, {
      kind: 'command',
      id: 'sync.writeWorkspaceStateRaw',
      payload: { raw: JSON.stringify(state) },
    })
    expect(raw).toMatchObject({ ok: true, value: { revision: 2, corrected: false } })
    expect(JSON.stringify(await store.readAppState())).toBe(golden)
    const ipc = await invokeHandledIpc(handlers.get(IPC_CHANNELS.persistenceWriteAppState), null, {
      state,
    })
    expect(ipc).toMatchObject({ ok: true, revision: 3, corrected: false })
    expect(ipc).not.toHaveProperty('effectiveState')
    expect(JSON.stringify(await store.readAppState())).toBe(golden)
    expect(
      await invokeHandledIpc(handlers.get(IPC_CHANNELS.persistenceReadAppState)),
    ).toMatchObject({ revision: 3, state: JSON.parse(golden) })
  })
  it('corrects IPC writes and returns typed identity failures through IPC and revisioned sync', async () => {
    await own()
    registerPersistenceIpcHandlers(async () => store)
    expect(
      await invokeHandledIpc(handlers.get(IPC_CHANNELS.persistenceWriteAppState), null, {
        state: stateWithAgent(),
        baseRevision: 3,
      }),
    ).toMatchObject({ ok: true, revision: 4, corrected: true })
    expect(await store.readAppState()).toMatchObject({
      workspaces: [{ nodes: [{ agent: tupleB }] }],
    })
    const bad = stateWithAgent()
    Object.assign(bad.workspaces[0].nodes[0], { agent: null })
    expect(
      await invokeHandledIpc(handlers.get(IPC_CHANNELS.persistenceWriteAppState), null, {
        state: bad,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'unknown',
      error: { code: 'persistence.owned_node_identity_conflict' },
    })
    const control = createControlSurface()
    registerSyncHandlers(control, async () => store)
    expect(
      await control.invoke(ctx, {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: bad, baseRevision: 4 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'persistence.owned_node_identity_conflict' } })
    expect(await store.readAppStateRevision()).toBe(4)
  })
  it('reads revision and state from one SQLite snapshot despite a concurrent commit', async () => {
    await store.writeAppState(stateWithAgent())
    const other = new Database(join(root, 'state.db'))
    const original = stateReader.readAppStateFromDb
    const spy = vi.spyOn(stateReader, 'readAppStateFromDb').mockImplementationOnce(db => {
      other.transaction(() => {
        other.prepare("UPDATE nodes SET title = 'Concurrent'").run()
        other.prepare("UPDATE app_meta SET value = '2' WHERE key = 'app_state_revision'").run()
      })()
      return original(db)
    })
    try {
      expect(await store.readAppStateSnapshot!()).toMatchObject({
        revision: 1,
        state: { workspaces: [{ nodes: [{ title: 'Claude' }] }] },
      })
      expect(await store.readAppStateSnapshot!()).toMatchObject({
        revision: 2,
        state: { workspaces: [{ nodes: [{ title: 'Concurrent' }] }] },
      })
    } finally {
      spy.mockRestore()
      other.close()
    }
  })
  it('reports unavailable storage, not an unexpected error, when the atomic read fails', async () => {
    const closed = await createPersistenceStore({
      dbPath: join(root, 'closed.db'),
      strictRecovery: true,
    })
    closed.dispose()
    await expect(closed.readAppStateSnapshot!()).rejects.toMatchObject({
      code: 'persistence.unavailable',
    })
    const control = createControlSurface()
    registerSyncHandlers(control, async () => closed)
    const result = await control.invoke(ctx, { kind: 'query', id: 'sync.state', payload: null })
    expect(result).toMatchObject({ ok: false, error: { code: 'persistence.unavailable' } })
  })
  it.each(['state', 'raw'])(
    'projects effective runtime bindings after a corrected %s write',
    async mode => {
      await own()
      const registry = new AgentRunStateRegistry({
        epoch: 'test',
        now: () => 1,
        createTurnId: () => 'turn',
        schedule: () => () => {},
      })
      const runtime = new AgentRunStateRuntime(registry, () => 1)
      const project = vi.spyOn(runtime, 'setBindings')
      try {
        const wrapped = await withAgentRunBindings(async () => store, runtime)()
        if (mode === 'state') {
          await wrapped.writeAppState(stateWithAgent())
        } else {
          await wrapped.writeWorkspaceStateRaw(JSON.stringify(stateWithAgent()))
        }
        expect(project.mock.lastCall?.[0]).toMatchObject([
          { sessionId: 'runtime', nodeId: 'agent', projectId: 'project' },
        ])
      } finally {
        runtime.dispose()
      }
    },
  )
})
