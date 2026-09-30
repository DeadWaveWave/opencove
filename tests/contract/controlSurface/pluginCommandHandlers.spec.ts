// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerPluginCommandHandlers } from '../../../src/app/main/controlSurface/handlers/pluginCommandHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PluginInstallationManager } from '../../../src/contexts/plugins/application/PluginInstallationManager'
import type { PluginLiveView } from '../../../src/contexts/plugins/domain/pluginRuntimeTypes'
import type { PluginManifest } from '../../../src/contexts/plugins/domain/pluginTypes'
import { createNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { listPluginWindows } from '../../../src/contexts/workspace/application/nodeControl/pluginWindows'
import type { NodeControlAppState } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type {
  PersistenceStore,
  WriteAppStateOptions,
} from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

const ctx = { now: () => new Date('2026-09-30T00:00:00Z') } as ControlSurfaceContext

function initial(): NodeControlAppState {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'first',
    settings: {},
    workspaces: ['first', 'second'].map(id => ({
      id,
      name: id,
      path: '/repo',
      worktreesRoot: '/repo',
      pullRequestBaseBranchOptions: [],
      environmentVariables: {},
      spaceArchiveRecords: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: false,
      activeSpaceId: null,
      nodes: [],
      spaces: [
        {
          id: `${id}-space`,
          name: 'Space',
          directoryPath: '/repo',
          targetMountId: null,
          nodeIds: [],
          rect: null,
          labelColor: null,
        },
      ],
    })),
  }
}

function fixture() {
  let state = initial()
  let revision = 1
  const manifest: PluginManifest = {
    id: 'sample',
    version: '1.0.0',
    revision: 'one',
    runtimeGeneration: 1,
    displayName: 'Sample',
    description: 'Fixture',
    source: 'local',
    enabled: true,
    status: 'ready',
    nodeKinds: ['sample'],
    actionBar: true,
    contextMenu: true,
    view: {
      entry: 'index.html',
      instances: 'single',
      width: 440,
      height: 320,
      minWidth: 320,
      minHeight: 220,
    },
    commands: [{ id: 'select', title: 'Select', description: 'Select item', target: 'window' }],
  }
  const store = {
    readAppState: vi.fn(async (): Promise<NodeControlAppState | null> => structuredClone(state)),
    readAppStateRevision: vi.fn(async () => revision),
    writeAppState: vi.fn(
      async (next: unknown, options?: WriteAppStateOptions): Promise<PersistWriteResult> => {
        if (options?.expectedRevision !== undefined && options.expectedRevision !== revision) {
          return {
            ok: false,
            reason: 'unknown',
            error: createAppErrorDescriptor('persistence.invalid_state', {
              debugMessage: 'App state revision conflict',
            }),
          }
        }
        state = structuredClone(next as NodeControlAppState)
        revision += 1
        return { ok: true, level: 'full', bytes: 1, revision }
      },
    ),
  }
  const plugins = {
    list: vi.fn(async () => [structuredClone(manifest)]),
    listViews: vi.fn(async (): Promise<PluginLiveView[]> => []),
    runCommand: vi.fn(async () => ({ executed: true })),
    skill: vi.fn(),
  }
  const publish = vi.fn(() => 1)
  const control = createControlSurface()
  registerPluginCommandHandlers(control, {
    plugins: plugins as unknown as PluginInstallationManager,
    getPersistenceStore: async () => store as unknown as PersistenceStore,
    publishSyncEvent: publish,
  })
  const call = (id: string, payload: Record<string, unknown> = {}) =>
    control.invoke(ctx, {
      kind: id === 'plugin.window.list' ? 'query' : 'command',
      id,
      payload: { pluginId: 'sample', ...payload },
    })
  return {
    manifest,
    store,
    plugins,
    publish,
    call,
    state: () => state,
    replace: (next: NodeControlAppState) => {
      state = structuredClone(next)
      revision += 1
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('plugin command facade ownership', () => {
  it.each([1, 2])(
    'requires an explicit project to create with %i available projects',
    async count => {
      const f = fixture()
      const state = f.state()
      state.workspaces = state.workspaces.slice(0, count)
      f.replace(state)
      const results = await Promise.all([
        f.call('plugin.window.open'),
        f.call('plugin.command.run', { commandId: 'select' }),
      ])
      for (const result of results) {
        expect(result).toMatchObject({
          ok: false,
          error: { debugMessage: expect.stringContaining('--project') },
        })
      }
      expect(f.store.writeAppState).not.toHaveBeenCalled()
      expect(f.plugins.runCommand).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['plugin.window.list', { nodeId: 'ignored-node' }],
    ['plugin.window.list', { spaceId: 'ignored-space' }],
    ['plugin.window.open', { nodeId: 'existing', spaceId: 'ignored-space' }],
    ['plugin.window.open', { nodeId: 'existing', anchor: { x: 1, y: 2 } }],
    ['plugin.window.open', { projectId: 'first', viewId: 'ignored-view' }],
    ['plugin.command.run', { commandId: 'select', spaceId: 'ignored-space' }],
    ['plugin.command.run', { commandId: 'select', anchor: { x: 1, y: 2 } }],
  ])(
    'rejects unused selectors for %s before reading or changing canvas state',
    async (id, input) => {
      const f = fixture()
      expect(await f.call(id, input)).toMatchObject({ ok: false })
      expect(f.store.readAppState).not.toHaveBeenCalled()
      expect(f.store.writeAppState).not.toHaveBeenCalled()
      expect(f.plugins.runCommand).not.toHaveBeenCalled()
    },
  )
  it('reports the original singleton destination when a creation gesture supplies placement hints', async () => {
    const f = fixture()
    await f.call('plugin.window.open', { projectId: 'first' })
    f.store.writeAppState.mockClear()
    expect(
      await f.call('plugin.window.open', { projectId: 'second', spaceId: 'second-space' }),
    ).toMatchObject({ ok: true, value: { created: false, projectId: 'first' } })
    expect(f.store.writeAppState).not.toHaveBeenCalled()
  })
  it('lists no windows on a fresh Worker without creating workspace state', async () => {
    const f = fixture()
    f.store.readAppState.mockResolvedValueOnce(null)
    expect(await f.call('plugin.window.list')).toMatchObject({ ok: true, value: { windows: [] } })
    expect(f.store.writeAppState).not.toHaveBeenCalled()
    expect(f.publish).not.toHaveBeenCalled()
  })
  it('serializes simultaneous singleton opens across projects and publishes only one creation', async () => {
    const f = fixture()
    const results = await Promise.all([
      f.call('plugin.window.open', { projectId: 'first' }),
      f.call('plugin.window.open', { projectId: 'second' }),
    ])
    expect(results.every(result => result.ok)).toBe(true)
    expect(f.store.writeAppState).toHaveBeenCalledTimes(1)
    expect(listPluginWindows(f.state(), 'sample')).toHaveLength(1)
    const values = results.map(result =>
      result.ok ? (result.value as { nodeId: string; created: boolean }) : null,
    )
    expect(values[0]?.nodeId).toBe(values[1]?.nodeId)
    expect(values.map(value => value?.created)).toEqual([true, false])
  })

  it('does not publish or focus a failed write and recovers its mutation queue for the next open', async () => {
    const f = fixture()
    f.store.writeAppState.mockResolvedValueOnce({
      ok: false,
      reason: 'io',
      error: createAppErrorDescriptor('persistence.io_failed', { debugMessage: 'disk full' }),
    })
    expect(await f.call('plugin.window.open', { projectId: 'first' })).toMatchObject({ ok: false })
    expect(f.publish).not.toHaveBeenCalled()
    expect(listPluginWindows(f.state(), 'sample')).toEqual([])
    expect(await f.call('plugin.window.open', { projectId: 'first' })).toMatchObject({ ok: true })
    expect(f.store.writeAppState).toHaveBeenCalledTimes(2)
  })

  it('replans a revision conflict without losing the outside writer or replaying a command', async () => {
    const f = fixture()
    const write = f.store.writeAppState.getMockImplementation()!
    f.store.writeAppState.mockImplementationOnce(async (next, options) => {
      const external = structuredClone(f.state())
      external.workspaces[1].name = 'Changed by another writer'
      f.replace(external)
      return await write(next, options)
    })
    expect(await f.call('plugin.window.open', { projectId: 'first' })).toMatchObject({ ok: true })
    expect(f.state().workspaces[1].name).toBe('Changed by another writer')
    expect(f.store.writeAppState).toHaveBeenCalledTimes(2)
    expect(listPluginWindows(f.state(), 'sample')).toHaveLength(1)
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
  })

  it('does not retry a dispatched command after its view disconnects', async () => {
    const f = fixture()
    await f.call('plugin.window.open', { projectId: 'first' })
    const nodeId = listPluginWindows(f.state(), 'sample')[0].nodeId
    f.plugins.listViews.mockResolvedValue([{ nodeId, viewId: 'view', ready: true }])
    f.plugins.runCommand.mockRejectedValueOnce(
      new Error('Plugin window disconnected; command was not retried.'),
    )
    expect(
      await f.call('plugin.command.run', { commandId: 'select', nodeId, viewId: 'view' }),
    ).toMatchObject({ ok: false })
    expect(f.plugins.runCommand).toHaveBeenCalledTimes(1)
    expect(f.plugins.runCommand).toHaveBeenCalledWith(
      'sample',
      'select',
      null,
      { nodeId, viewId: 'view' },
      expect.objectContaining({ revision: 'one', runtimeGeneration: 1 }),
    )
  })

  it('does not create an unrelated window for a stale explicit view selector', async () => {
    const f = fixture()
    f.publish.mockReturnValue(0)
    expect(
      await f.call('plugin.command.run', { commandId: 'select', viewId: 'stale-view' }),
    ).toMatchObject({ ok: false })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
    expect(f.store.writeAppState).not.toHaveBeenCalled()
  })

  it('rechecks durable node existence after asynchronous readiness before dispatch', async () => {
    const f = fixture()
    await f.call('plugin.window.open', { projectId: 'first' })
    const nodeId = listPluginWindows(f.state(), 'sample')[0].nodeId
    f.plugins.listViews.mockImplementationOnce(async () => {
      const closed = structuredClone(f.state())
      closed.workspaces[0].nodes = []
      f.replace(closed)
      // Renderer teardown can lag behind the durable close.
      return [{ nodeId, viewId: 'closing-view', ready: true }]
    })
    expect(await f.call('plugin.command.run', { commandId: 'select', nodeId })).toMatchObject({
      ok: false,
    })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
  })

  it('does not publish a new window if the installation was disabled while reading canvas state', async () => {
    const f = fixture()
    f.store.readAppState.mockImplementationOnce(async () => {
      f.manifest.enabled = false
      f.manifest.status = 'disabled'
      return structuredClone(f.state())
    })
    expect(await f.call('plugin.window.open', { projectId: 'first' })).toMatchObject({ ok: false })
    expect(f.store.writeAppState).not.toHaveBeenCalled()
  })

  it('does not dispatch a command against a replacement installation after asynchronous readiness', async () => {
    const f = fixture()
    await f.call('plugin.window.open', { projectId: 'first' })
    const nodeId = listPluginWindows(f.state(), 'sample')[0].nodeId
    f.plugins.listViews.mockImplementationOnce(async () => {
      f.manifest.revision = 'two'
      return [{ nodeId, viewId: 'replacement-view', ready: true }]
    })
    expect(await f.call('plugin.command.run', { commandId: 'select', nodeId })).toMatchObject({
      ok: false,
    })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
  })

  it('fences installation replacement while the final durable-node check is reading state', async () => {
    const f = fixture()
    await f.call('plugin.window.open', { projectId: 'first' })
    const nodeId = listPluginWindows(f.state(), 'sample')[0].nodeId
    f.plugins.listViews.mockResolvedValue([{ nodeId, viewId: 'view', ready: true }])
    f.store.readAppState
      .mockResolvedValueOnce(structuredClone(f.state()))
      .mockImplementationOnce(async () => {
        f.manifest.runtimeGeneration = 2
        return structuredClone(f.state())
      })
    expect(await f.call('plugin.command.run', { commandId: 'select', nodeId })).toMatchObject({
      ok: false,
    })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
  })

  it('preserves a committed plugin node when an already-running terminal creation later persists', async () => {
    const f = fixture()
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    const spawn = vi.fn(async () => {
      await waiting
      return {
        sessionId: 'terminal-session',
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        startedAt: ctx.now().toISOString(),
        workerBinding: { endpointId: 'local', mountId: null },
      }
    })
    const terminal = createNodeForNodeControl({
      store: f.store,
      input: { kind: 'terminal', space: { kind: 'spaceId', spaceId: 'first-space' }, data: {} },
      now: ctx.now(),
      locatorDeps: {
        listEndpoints: async () => [
          {
            endpointId: 'local',
            kind: 'local',
            displayName: 'Local',
            createdAt: '',
            updatedAt: '',
            remote: null,
          },
        ],
        listMounts: async () => [],
        listWorktreesForMount: async () => [],
        listWorktreesForWorkspace: async () => [],
      },
      runtime: { spawnTerminal: spawn, launchAgent: vi.fn(), killSession: vi.fn() },
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(await f.call('plugin.window.open', { projectId: 'first' })).toMatchObject({ ok: true })
    const committed = listPluginWindows(f.state(), 'sample')[0].nodeId
    release()
    await terminal.catch(() => undefined)
    expect(listPluginWindows(f.state(), 'sample').map(node => node.nodeId)).toContain(committed)
  })
})

describe('declared host menu dispatch', () => {
  it('never creates a window for a menu and rejects stale declared identities', async () => {
    const f = fixture()
    expect(
      await f.call('plugin.command.run', {
        commandId: 'select',
        context: { surface: 'commandCenter', projectId: 'first' },
      }),
    ).toMatchObject({ ok: false })
    expect(f.store.writeAppState).not.toHaveBeenCalled()
    expect(f.publish).not.toHaveBeenCalled()
    expect(
      await f.call('plugin.command.run', {
        commandId: 'select',
        expectedRevision: 'old',
        context: { surface: 'commandCenter' },
      }),
    ).toMatchObject({ ok: false })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
  })
  it('uses the shared dispatcher for a concrete menu view and rejects mismatched context', async () => {
    const f = fixture()
    f.manifest.commands![0].menus = ['node', 'space', 'canvas']
    await f.call('plugin.window.open', { projectId: 'first', spaceId: 'first-space' })
    const nodeId = listPluginWindows(f.state(), 'sample')[0].nodeId
    f.plugins.listViews.mockResolvedValue([{ nodeId, viewId: 'view', ready: true }])
    const context = { surface: 'space', projectId: 'first', spaceId: 'first-space' }
    expect(
      await f.call('plugin.command.run', { commandId: 'select', nodeId, viewId: 'view', context }),
    ).toMatchObject({ ok: true })
    expect(f.plugins.runCommand).toHaveBeenCalledWith(
      'sample',
      'select',
      null,
      { nodeId, viewId: 'view', context },
      expect.objectContaining({ revision: 'one' }),
    )
    f.plugins.runCommand.mockClear()
    expect(
      await f.call('plugin.command.run', {
        commandId: 'select',
        nodeId,
        viewId: 'view',
        context: { ...context, projectId: 'second', spaceId: 'second-space' },
      }),
    ).toMatchObject({ ok: false })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
  })
  it('passes verified host context to a plugin backend without a window target', async () => {
    const f = fixture()
    f.manifest.commands = [
      {
        id: 'inspect',
        title: 'Inspect',
        description: 'Inspect context',
        target: 'plugin',
        menus: ['canvas', 'space'],
      },
    ]
    const context = { surface: 'space', projectId: 'first', spaceId: 'first-space' }
    expect(await f.call('plugin.command.run', { commandId: 'inspect', context })).toMatchObject({
      ok: true,
    })
    expect(f.plugins.runCommand).toHaveBeenCalledWith(
      'sample',
      'inspect',
      null,
      { nodeId: undefined, viewId: undefined, context },
      expect.anything(),
    )
    expect(f.store.writeAppState).not.toHaveBeenCalled()
    expect(
      await f.call('plugin.command.run', {
        commandId: 'inspect',
        context: { ...context, spaceId: 'missing' },
      }),
    ).toMatchObject({ ok: false })
    expect(
      await f.call('plugin.command.run', {
        commandId: 'inspect',
        context: { surface: 'canvas', projectId: 'first', nodeIds: ['irrelevant'] },
      }),
    ).toMatchObject({ ok: false })
  })
})
