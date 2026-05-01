import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { MountDto, WorkerEndpointDto } from '../../../src/shared/contracts/dto'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'
import {
  createNodeForNodeControl,
  type NodeControlRuntimeDeps,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { resolveCanvasFocusTargetForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlFocus'
import {
  resolveSpaceLocatorForNodeControl,
  type SpaceLocatorResolverDeps,
} from '../../../src/contexts/workspace/application/nodeControl/spaceLocator'
import type {
  NodeControlAppState,
  NodeControlAppStateStore,
  NodeControlNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-04-25T00:00:00.000Z'),
}

const localEndpoint: WorkerEndpointDto = {
  endpointId: 'local',
  kind: 'local',
  displayName: 'Local',
  createdAt: '2026-04-25T00:00:00.000Z',
  updatedAt: '2026-04-25T00:00:00.000Z',
  remote: null,
}

function createSpace(
  overrides: Partial<NodeControlAppState['workspaces'][number]['spaces'][number]>,
) {
  return {
    id: 'space-1',
    name: 'Space',
    directoryPath: '/repo',
    targetMountId: null,
    labelColor: null,
    nodeIds: [],
    rect: null,
    ...overrides,
  }
}

function createNode(overrides: Partial<NodeControlNode>): NodeControlNode {
  return {
    id: 'node-1',
    sessionId: null,
    title: 'Node',
    titlePinnedByUser: false,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    kind: 'note',
    profileId: null,
    runtimeKind: null,
    terminalProviderHint: null,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    executionDirectory: null,
    expectedDirectory: null,
    agent: null,
    task: { text: '' },
    scrollback: null,
    ...overrides,
  }
}

function createAppState(overrides: Partial<NodeControlAppState> = {}): NodeControlAppState {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'project-1',
    workspaces: [
      {
        id: 'project-1',
        name: 'Project',
        path: '/repo',
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [createSpace({ id: 'space-1' })],
        activeSpaceId: 'space-1',
        nodes: [],
      },
    ],
    settings: {},
    ...overrides,
  }
}

function createLocatorDeps(
  overrides: Partial<SpaceLocatorResolverDeps> = {},
): SpaceLocatorResolverDeps {
  return {
    listEndpoints: async () => [localEndpoint],
    listMounts: async () => [],
    listWorktreesForMount: async () => [],
    listWorktreesForWorkspace: async () => [],
    ...overrides,
  }
}

function createStateStore(initial: NodeControlAppState): {
  store: NodeControlAppStateStore
  getState: () => NodeControlAppState
  getWrites: () => NodeControlAppState[]
} {
  let state = initial
  let revision = 1
  const writes: NodeControlAppState[] = []

  return {
    store: {
      readAppState: async () => state,
      readAppStateRevision: async () => revision,
      writeAppState: async next => {
        state = next
        writes.push(next)
        revision += 1
        return { ok: true, level: 'full', bytes: 1, revision }
      },
    },
    getState: () => state,
    getWrites: () => writes,
  }
}

describe('node control application use cases', () => {
  it('returns structured ambiguity for duplicate space names', async () => {
    const state = createAppState({
      workspaces: [
        {
          ...createAppState().workspaces[0],
          spaces: [
            createSpace({ id: 'space-a', name: 'Review', directoryPath: '/repo/a' }),
            createSpace({ id: 'space-b', name: 'Review', directoryPath: '/repo/b' }),
          ],
        },
      ],
    })

    await expect(
      resolveSpaceLocatorForNodeControl(state, createLocatorDeps(), {
        kind: 'spaceName',
        name: 'Review',
      }),
    ).rejects.toMatchObject({
      code: 'space.ambiguous',
      details: {
        candidates: [
          expect.objectContaining({ spaceId: 'space-a', matchReason: 'space-name' }),
          expect.objectContaining({ spaceId: 'space-b', matchReason: 'space-name' }),
        ],
      },
    } satisfies Partial<OpenCoveAppError>)
  })

  it('creates a terminal node in the uniquely resolved worker path space', async () => {
    const { store, getState } = createStateStore(
      createAppState({
        workspaces: [
          {
            ...createAppState().workspaces[0],
            spaces: [
              createSpace({ id: 'space-root', directoryPath: '/repo' }),
              createSpace({ id: 'space-app', directoryPath: '/repo/packages/app' }),
            ],
          },
        ],
      }),
    )
    const spawnTerminal = vi.fn(async () => ({
      sessionId: 'term-1',
      executionDirectory: '/repo/packages/app',
      expectedDirectory: '/repo/packages/app',
      startedAt: '2026-04-25T00:00:00.000Z',
      profileId: 'default',
      runtimeKind: 'posix',
    }))
    const runtime: NodeControlRuntimeDeps = {
      launchAgent: async () => {
        throw new Error('unexpected agent launch')
      },
      spawnTerminal,
      killSession: async () => undefined,
    }

    const result = await createNodeForNodeControl({
      store,
      locatorDeps: createLocatorDeps(),
      runtime,
      now: ctx.now(),
      input: {
        kind: 'terminal',
        space: {
          kind: 'workerPath',
          worker: 'local',
          path: '/repo/packages/app/src',
        },
        data: { profileId: 'default' },
      },
    })

    expect(result.spaceId).toBe('space-app')
    expect(result.node.kind).toBe('terminal')
    expect(result.node.sessionId).toBe('term-1')
    expect(spawnTerminal).toHaveBeenCalledTimes(1)
    expect(getState().workspaces[0].spaces[1].nodeIds).toEqual([result.node.id])
  })

  it('resolves node focus targets without writing app state', async () => {
    const writeAppState = vi.fn(async () => {
      throw new Error('unexpected write')
    })
    const store: NodeControlAppStateStore = {
      readAppState: async () =>
        createAppState({
          workspaces: [
            {
              ...createAppState().workspaces[0],
              spaces: [createSpace({ id: 'space-1', nodeIds: ['node-1'] })],
              nodes: [createNode({ id: 'node-1' })],
            },
          ],
        }),
      readAppStateRevision: async () => 1,
      writeAppState,
    }

    const result = await resolveCanvasFocusTargetForNodeControl({
      store,
      locatorDeps: createLocatorDeps(),
      target: { kind: 'node', nodeId: 'node-1' },
    })

    expect(result).toEqual({
      projectId: 'project-1',
      target: { kind: 'node', nodeId: 'node-1', spaceId: 'space-1' },
    })
    expect(writeAppState).not.toHaveBeenCalled()
  })
})

describe('node control handlers', () => {
  it('rejects generic agent and terminal updates at validation time', async () => {
    const controlSurface = createControlSurface()
    const topology: WorkerTopologyStore = {
      listEndpoints: async () => ({ endpoints: [localEndpoint] }),
      listMounts: async () => ({ mounts: [] as MountDto[] }),
    } as WorkerTopologyStore
    registerNodeControlHandlers(controlSurface, {
      topology,
      getPersistenceStore: async () => {
        throw new Error('unexpected persistence access')
      },
    })

    const results = await Promise.all(
      ['agent', 'terminal'].map(kind =>
        controlSurface.invoke(ctx, {
          kind: 'command',
          id: 'node.update',
          payload: { kind, nodeId: 'node-1' },
        }),
      ),
    )

    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('node.unsupported_operation')
      }
    }
  })

  it('persists launched agent runtime metadata from the session owner', async () => {
    const controlSurface = createControlSurface()
    const { store, getState } = createStateStore(createAppState())
    const launchAgent = vi.fn(async () => ({
      sessionId: 'agent-session-1',
      provider: 'codex' as const,
      startedAt: '2026-04-25T00:00:00.000Z',
      executionContext: {
        workingDirectory: '/repo',
      },
      profileId: null,
      runtimeKind: 'windows' as const,
      resumeSessionId: null,
      effectiveModel: 'gpt-5.4',
      command: 'cmd.exe',
      args: ['/d', '/c', 'codex.cmd'],
    }))
    const topology: WorkerTopologyStore = {
      listEndpoints: async () => ({ endpoints: [localEndpoint] }),
      listMounts: async () => ({ mounts: [] as MountDto[] }),
    } as WorkerTopologyStore

    controlSurface.register('session.launchAgent', {
      kind: 'command',
      validate: payload => payload,
      handle: launchAgent,
      defaultErrorCode: 'agent.launch_failed',
    })
    registerNodeControlHandlers(controlSurface, {
      topology,
      getPersistenceStore: async () => store as never,
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'node.create',
      payload: {
        kind: 'agent',
        space: { kind: 'spaceId', spaceId: 'space-1' },
        data: {
          prompt: '',
          provider: 'codex',
          model: null,
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.node).toMatchObject({
      kind: 'agent',
      sessionId: 'agent-session-1',
    })
    expect(getState().workspaces[0].nodes[0]).toMatchObject({
      sessionId: 'agent-session-1',
      profileId: null,
      runtimeKind: 'windows',
    })
    expect(launchAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spaceId: 'space-1',
        provider: 'codex',
      }),
    )
  })
})
