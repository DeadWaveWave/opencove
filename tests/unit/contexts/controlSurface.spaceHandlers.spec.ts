import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-05-12T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: {
      state: true,
      events: true,
    },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: {
        viewer: true,
        controller: true,
      },
      webAuth: {
        ticketToCookie: true,
        cookieSession: true,
      },
    },
  },
}

function createStore(
  initialState: unknown,
): PersistenceStore & { readWrittenState: () => unknown } {
  let state = initialState

  return {
    readWorkspaceStateRaw: async () => null,
    writeWorkspaceStateRaw: async () => ({ ok: true, level: 'full', bytes: 0 }),
    readAppState: async () => state,
    readAppStateRevision: async () => 0,
    writeAppState: async nextState => {
      state = nextState
      return { ok: true, level: 'full', bytes: 1 }
    },
    readNodeScrollback: async () => null,
    writeNodeScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
    readAgentNodePlaceholderScrollback: async () => null,
    writeAgentNodePlaceholderScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
    consumeRecovery: () => null,
    dispose: () => undefined,
    readWrittenState: () => state,
  }
}

describe('control surface space handlers', () => {
  it('reports a persisted folder window as a folder in space summaries', async () => {
    const store = createStore({
      formatVersion: 1,
      activeWorkspaceId: 'workspace-1',
      settings: {},
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/repo',
          nodes: [
            {
              id: 'folder-1',
              title: 'docs',
              kind: 'folder',
              position: { x: 0, y: 0 },
              width: 480,
              height: 400,
              task: {
                uri: 'file:///repo/docs',
                rootUri: 'file:///repo',
                viewMode: 'icons',
                expandedDirectoryUris: [],
              },
            },
          ],
          spaces: [{ id: 'space-1', name: 'Space', nodeIds: ['folder-1'] }],
        },
      ],
    })
    const controlSurface = createControlSurface()
    registerSpaceHandlers(controlSurface, async () => store)

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'space.get',
      payload: { spaceId: 'space-1' },
    })

    expect(result).toMatchObject({
      ok: true,
      value: { space: { nodes: [{ id: 'folder-1', kind: 'folder', title: 'docs' }] } },
    })
  })

  it('creates a child space, moves selected nodes, and updates execution expectations', async () => {
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'workspace-1',
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/repo',
          worktreesRoot: '/repo',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: 'parent-space',
              name: 'Parent',
              directoryPath: '/repo',
              targetMountId: 'mount-1',
              boundary: {
                allowedMountIds: ['mount-1'],
                scopesByMountId: {
                  'mount-1': {
                    rootPath: '/repo/packages/app',
                    rootUri: 'file:///repo/packages/app',
                  },
                },
                allowedPluginIds: null,
                capabilities: null,
                trustLevel: null,
              },
              labelColor: null,
              nodeIds: ['agent-1', 'terminal-1'],
              rect: { x: 0, y: 0, width: 1200, height: 800 },
            },
          ],
          activeSpaceId: 'parent-space',
          nodes: [
            {
              id: 'agent-1',
              kind: 'agent',
              title: 'Agent',
              position: { x: 120, y: 140 },
              width: 360,
              height: 240,
              agent: {
                expectedDirectory: '/repo',
              },
            },
            {
              id: 'terminal-1',
              kind: 'terminal',
              title: 'Terminal',
              position: { x: 540, y: 140 },
              width: 360,
              height: 240,
              executionDirectory: null,
              expectedDirectory: '/repo',
            },
          ],
          spaceArchiveRecords: [],
        },
      ],
      settings: {},
    }
    const store = createStore(appState)
    const controlSurface = createControlSurface()
    registerSpaceHandlers(controlSurface, async () => store)

    const created = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'space.createChild',
      payload: {
        parentSpaceId: 'parent-space',
        initialNodeIds: ['agent-1', 'terminal-1'],
      },
    })

    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }

    const childSpace = created.value.childSpace
    expect(childSpace).toMatchObject({
      name: 'Space 1',
      directoryPath: '/repo/packages/app',
      targetMountId: 'mount-1',
      parentSpaceId: 'parent-space',
      nodeIds: ['agent-1', 'terminal-1'],
    })
    expect(created.value.movedNodeIds).toEqual(['agent-1', 'terminal-1'])

    const writtenState = store.readWrittenState() as typeof appState
    const workspace = writtenState.workspaces[0]!
    expect(workspace.spaces.find(space => space.id === 'parent-space')?.nodeIds).toEqual([])
    expect(workspace.spaces.find(space => space.id === childSpace.id)?.nodeIds).toEqual([
      'agent-1',
      'terminal-1',
    ])
    expect(workspace.nodes.find(node => node.id === 'agent-1')?.agent).toMatchObject({
      expectedDirectory: '/repo/packages/app',
    })
    expect(workspace.nodes.find(node => node.id === 'agent-1')?.expectedDirectory).toBe(
      '/repo/packages/app',
    )
    expect(workspace.nodes.find(node => node.id === 'terminal-1')?.executionDirectory).toBe('/repo')
    expect(workspace.nodes.find(node => node.id === 'terminal-1')?.expectedDirectory).toBe(
      '/repo/packages/app',
    )
  })
})

it('shares compact task state with node list/get and excludes note contents', async () => {
  const { toCanvasNodeDetail, toCanvasNodeSummary } =
    await import('../../../src/contexts/workspace/application/nodeControl/nodeDtos')
  const { normalizePersistedAppState } =
    await import('../../../src/platform/persistence/sqlite/normalize')
  const state = {
    formatVersion: 1,
    activeWorkspaceId: 'p',
    settings: {},
    workspaces: [
      {
        id: 'p',
        name: 'P',
        path: '/repo',
        spaces: [
          { id: 's', name: 'Main', nodeIds: ['task', 'note', 'website', 'agent', 'terminal'] },
        ],
        nodes: [
          {
            id: 'task',
            title: 'Task',
            kind: 'task',
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            task: { requirement: 'Fix', status: 'doing', priority: 'high', tags: ['a'] },
          },
          {
            id: 'note',
            title: 'Note',
            kind: 'note',
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            task: { text: 'private long note' },
          },
          ...['website', 'agent', 'terminal'].map(kind => ({
            id: kind,
            kind,
            title: kind,
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            status: kind === 'website' ? null : 'running',
            task: kind === 'website' ? { url: 'https://example.com', pinned: true } : null,
          })),
        ],
      },
    ],
  }
  const normalized = normalizePersistedAppState(state)!
  const workspace = normalized.workspaces[0]
  const node = workspace.nodes.find(n => n.id === 'task')!
  const list = toCanvasNodeSummary({ node, workspace })
  const get = toCanvasNodeDetail({ node, workspace })
  const surface = createControlSurface()
  const store = createStore(state)
  registerSpaceHandlers(surface, async () => store)
  registerNodeControlHandlers(surface, {
    topology: {
      listEndpoints: async () => ({ endpoints: [] }),
      listMounts: async () => ({ mounts: [] }),
    } as unknown as WorkerTopologyStore,
    getPersistenceStore: async () => store,
  })
  const listed = await surface.invoke(ctx, {
    kind: 'query',
    id: 'node.list',
    payload: { projectId: 'p' },
  })
  const detail = await surface.invoke(ctx, {
    kind: 'query',
    id: 'node.get',
    payload: { nodeId: 'task' },
  })
  expect(listed.ok, JSON.stringify(listed)).toBe(true)
  expect(listed).toMatchObject({
    ok: true,
    value: {
      nodes: [
        {
          id: 'task',
          data: {
            kind: 'task',
            requirement: 'Fix',
            status: 'doing',
            priority: 'high',
            tags: ['a'],
          },
        },
        { id: 'note', data: { kind: 'note' } },
        { id: 'website', data: { kind: 'website', url: 'https://example.com' } },
        { id: 'agent', data: { kind: 'agent' } },
        { id: 'terminal', data: { kind: 'terminal' } },
      ],
    },
  })
  expect(detail).toMatchObject({ ok: true, value: { node: { data: list.data } } })
  const result = await surface.invoke(ctx, {
    kind: 'query',
    id: 'space.get',
    payload: { spaceId: 's' },
  })
  expect(result).toMatchObject({
    ok: true,
    value: {
      space: {
        nodes: [
          { id: 'task', data: list.data },
          { id: 'note', data: { kind: 'note' } },
          { id: 'website', data: { kind: 'website', url: 'https://example.com' } },
          { id: 'agent', data: { kind: 'agent' } },
          { id: 'terminal', data: { kind: 'terminal' } },
        ],
      },
    },
  })
  expect(list.data).toMatchObject({
    kind: 'task',
    requirement: 'Fix',
    status: 'doing',
    priority: 'high',
    tags: ['a'],
  })
  expect(get.data).toMatchObject(list.data!)
  expect(JSON.stringify(result)).not.toContain('private long note')
  expect(JSON.stringify(listed)).not.toContain('private long note')
})
