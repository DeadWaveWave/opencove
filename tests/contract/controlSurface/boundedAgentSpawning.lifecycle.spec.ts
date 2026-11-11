/* eslint-disable no-await-in-loop -- Each creation observes the prior admission and runtime lifecycle. */
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
async function fixture() {
  const store = createInMemoryPersistenceStore(),
    surface = createControlSurface()
  const state = createMinimalState('/repo', 'project', 'space')
  state.workspaces[0].nodes = [
    { id: 'root', kind: 'agent', sessionId: 'root-session', title: 'Root' },
  ]
  await store.writeAppState(state)
  const exits = new Set<(e: { sessionId: string; exitCode: number }) => void>()
  const spawn = vi.fn(async () => ({ sessionId: 's' + spawn.mock.calls.length }))
  const kill = vi.fn()
  const tracked = createAgentSpawnRuntime({
    spawnSession: spawn,
    kill,
    write: () => {},
    onData: () => () => {},
    onExit: fn => {
      exits.add(fn)
      return () => {
        exits.delete(fn)
      }
    },
    resize: async () => ({ status: 'session_not_found' }) as never,
  })
  const ctx = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  const grant = {
    grantId: 'g',
    nodeId: 'root',
    sessionId: 'root-session',
    projectId: 'project',
    spaceId: 'space',
    tier: 'interact' as const,
    createdAt: '',
  }
  const granted = { ...ctx, requestAuth: { kind: 'session-grant' as const, grant } }
  const topology = {
    listEndpoints: async () => ({ endpoints: [{ endpointId: 'local', kind: 'local' }] }),
    listMounts: async () => ({ mounts: [] }),
  } as unknown as WorkerTopologyStore
  registerNodeControlHandlers(surface, {
    topology,
    getPersistenceStore: async () => store,
    agentSpawnRuntime: tracked.port,
    killExactSession: id => tracked.runtime.kill(id),
  })
  const afterLaunch = vi.fn((value: object) => value)
  const launch = async (context: ControlSurfaceContext) => {
    const run = async () => ({
      ...(await tracked.runtime.spawnSession({
        command: 'fixture',
        args: [],
        cwd: '/repo',
        cols: 80,
        rows: 24,
      })),
      provider: 'codex',
      startedAt: new Date().toISOString(),
      executionContext: { workingDirectory: '/repo' },
      runtimeKind: 'posix',
    })
    return afterLaunch(
      await (context.spawnIdentity ? canvasSpawnIdentity.run(context.spawnIdentity, run) : run()),
    )
  }
  for (const id of ['session.launchAgent', 'pty.spawn']) {
    surface.register(id, {
      kind: 'command',
      validate: value => value,
      handle: launch,
      defaultErrorCode: 'agent.launch_failed',
    })
  }
  surface.register('session.kill', {
    kind: 'command',
    validate: value => value as { sessionId: string },
    handle: (_ctx, input) => kill(input.sessionId),
    defaultErrorCode: 'common.unexpected',
  })
  const create = (kind = 'agent', context = granted) =>
    surface.invoke(context, {
      kind: 'command',
      id: 'node.create',
      payload: {
        kind,
        space: { kind: 'spaceId', spaceId: 'space' },
        data:
          kind === 'agent'
            ? { provider: 'codex', prompt: 'Help me' }
            : kind === 'note'
              ? { text: 'note' }
              : {},
      },
    })
  return {
    afterLaunch,
    create,
    ctx,
    granted,
    store,
    spawn,
    kill,
    tracked,
    surface,
    exit: (id: string) => exits.forEach(fn => fn({ sessionId: id, exitCode: 0 })),
  }
}
it('serializes two creates at five live descendants and reopens a slot only on exact exit', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 5; i++) {
      expect(await f.create(i % 2 ? 'terminal' : 'agent')).toMatchObject({ ok: true })
    }
    let release!: () => void
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    f.spawn.mockImplementationOnce(async () => {
      await barrier
      return { sessionId: 'sixth' }
    })
    const first = f.create(),
      second = f.create('terminal')
    await vi.waitFor(() => expect(f.spawn).toHaveBeenCalledTimes(6))
    release()
    expect(await first).toMatchObject({ ok: true })
    expect(await second).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    f.tracked.runtime.kill('sixth')
    expect(await f.create()).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    f.exit('sixth')
    expect(await f.create()).toMatchObject({ ok: true })
    expect(f.spawn).toHaveBeenCalledTimes(7)
    // The exited node remains on canvas. Non-runtime nodes and user launch remain exempt.
    expect(await f.create('note')).toMatchObject({ ok: true })
    expect(await f.create('agent', f.ctx as typeof f.granted)).toMatchObject({ ok: true })
  } finally {
    f.tracked.dispose()
  }
})
it('counts a sixth runtime after failed commit and failed cleanup, including after node deletion', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 5; i++) {
      await f.create()
    }
    const commit = vi.spyOn(f.store, 'commitCreatedNodeState')
    commit.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: 'persistence.io_failed' },
    }))
    f.kill.mockImplementation(() => {
      throw new Error('kill failed')
    })
    expect(await f.create()).toMatchObject({ ok: false, error: { code: 'persistence.io_failed' } })
    expect(await f.create()).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    f.exit('s6')
    expect(await f.create()).toMatchObject({ ok: true })
    const node = (await f.store.readAppState())!.workspaces[0].nodes.find(
      n => n.sessionId === 's7',
    )!
    expect(
      await f.surface.invoke(f.ctx, {
        kind: 'command',
        id: 'node.delete',
        payload: { nodeId: node.id },
      }),
    ).toMatchObject({ ok: true })
    expect(await f.create()).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    f.exit('s7')
    expect(await f.create()).toMatchObject({ ok: true })
  } finally {
    f.tracked.dispose()
  }
})
it('retries insertion without relaunching and retains a running session after an uncertain commit response', async () => {
  const f = await fixture()
  try {
    const original = f.store.commitCreatedNodeState!
    const commit = vi.spyOn(f.store, 'commitCreatedNodeState')
    commit.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'persistence.invalid_state',
        debugMessage: 'App state revision conflict (fixture)',
      },
    })
    expect(await f.create()).toMatchObject({ ok: true })
    expect(f.spawn).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledTimes(2)
    commit.mockImplementationOnce(async (state, options) => {
      await original(state, options)
      throw new Error('response lost')
    })
    expect(await f.create()).toMatchObject({ ok: false })
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.tracked.port.snapshot().bindings).toHaveLength(2)
  } finally {
    f.tracked.dispose()
  }
})

it('allows actual agent recovery at a full tree, then counts its extra live incarnation', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 6; i++) {
      await f.create()
    }
    expect(await f.create()).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    const { prepareAgentNode } =
      await import('../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation')
    const { normalizePersistedAppState } =
      await import('../../../src/platform/persistence/sqlite/normalize')
    const { normalizeAgentSettings } =
      await import('../../../src/contexts/settings/domain/agentSettings')
    const state = normalizePersistedAppState(await f.store.readAppState())!
    const workspace = state.workspaces[0]
    const node = workspace.nodes.find(n => n.sessionId === 's1')!
    f.surface.register('mount.list', {
      kind: 'query',
      validate: value => value,
      handle: () => ({ mounts: [] }),
      defaultErrorCode: 'common.unexpected',
    })
    const prepared = await prepareAgentNode({
      controlSurface: f.surface,
      ctx: f.ctx,
      store: f.store,
      workspace,
      node: { ...node, status: 'standby' },
      space: null,
      agent: {
        ...node.agent!,
        provider: 'codex',
        prompt: '',
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        resumeSessionId: null,
        resumeSessionIdVerified: false,
      },
      settings: normalizeAgentSettings({}),
    })
    expect(prepared.sessionId).toBe('s7')
    expect(f.spawn).toHaveBeenCalledTimes(7)
    f.exit('s1')
    expect(await f.create()).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    f.exit('s7')
    expect(await f.create()).toMatchObject({ ok: true })
  } finally {
    f.tracked.dispose()
  }
})

it('cleans a post-spawn callback failure and keeps uncommitted occupancy when cleanup fails', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 5; i++) {
      await f.create()
    }
    f.kill.mockImplementation(() => {
      throw new Error('cleanup failed')
    })
    f.afterLaunch.mockImplementationOnce(() => {
      throw new Error('metadata failed after spawn')
    })
    expect(await f.create()).toMatchObject({ ok: false })
    expect(f.kill).toHaveBeenCalledWith('s6')
    expect(await f.create()).toMatchObject({
      ok: false,
      error: { code: 'agent.spawn_concurrency_limit' },
    })
    f.exit('s6')
    expect(await f.create()).toMatchObject({ ok: true })
  } finally {
    f.tracked.dispose()
  }
})
