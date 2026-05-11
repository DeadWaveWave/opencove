import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
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
      name: 'Child Space 1',
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
