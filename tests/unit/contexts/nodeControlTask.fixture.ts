import { vi } from 'vitest'
import { createNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import { makeNode } from '../../../src/contexts/workspace/application/nodeControl/nodeDataFactory'
import type {
  NodeControlAppState,
  NodeControlAppStateStore,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

export const now = new Date('2026-11-12T00:00:00.000Z')
export function fixture() {
  let state: NodeControlAppState = {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [
      {
        id: 'project',
        name: 'Test Workspace',
        path: '/repo',
        worktreesRoot: '/repo',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        activeSpaceId: 'space',
        nodes: [],
        spaces: [
          {
            id: 'space',
            name: 'Main',
            directoryPath: '/repo',
            targetMountId: null,
            labelColor: null,
            nodeIds: [],
            rect: null,
          },
        ],
      },
    ],
  }
  let revision = 1
  const task = makeNode({
    id: 'task',
    kind: 'task',
    title: 'Task',
    now: '2026-01-01T00:00:00.000Z',
    frame: { x: 0, y: 0, width: 320, height: 240 },
    data: {
      kind: 'task',
      requirement: 'Implement it',
      status: 'todo',
      priority: 'medium',
      tags: [],
    },
  })
  state.workspaces[0].nodes = [task]
  state.workspaces[0].spaces[0].nodeIds = ['task']
  const write = vi.fn<NodeControlAppStateStore['writeAppState']>(async (next, options) => {
    if (options?.expectedRevision !== revision) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_state', {
          debugMessage: `App state revision conflict (expected=${options?.expectedRevision}, current=${revision}).`,
        }),
      }
    }
    state = structuredClone(next)
    return { ok: true, level: 'full', bytes: 1, revision: ++revision }
  })
  const store: NodeControlAppStateStore = {
    readAppState: async () => structuredClone(state),
    readAppStateRevision: async () => revision,
    writeAppState: write,
    nodeLineage: { readMany: async () => new Map() },
    commitCreatedNodeState: vi.fn((next, options) => write(next, options)),
  }
  let launchNumber = 0
  const runtime = {
    launchAgent: vi.fn(async () => ({
      sessionId: ++launchNumber === 1 ? 'session' : `session-${launchNumber}`,
      provider: 'codex' as const,
      prompt: 'Inspect',
      model: null,
      effectiveModel: null,
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      startedAt: now.toISOString(),
      profileId: null,
      runtimeKind: null,
      workerBinding: { endpointId: 'local', mountId: null },
    })),
    spawnTerminal: vi.fn(),
    killSession: vi.fn(),
  }
  const run = (
    data: Record<string, unknown> = { taskNodeId: 'task' },
    root = false,
    callerNodeId?: string,
  ) =>
    createNodeForNodeControl({
      store,
      runtime,
      now,
      callerNodeId,
      locatorDeps: {
        listEndpoints: async () => [
          {
            endpointId: 'local',
            kind: 'local',
            displayName: 'Local',
            createdAt: '',
            updatedAt: '',
            remote: null,
            access: null,
          },
        ],
        listMounts: async () => [
          {
            mountId: 'local-mount',
            projectId: 'project',
            endpointId: 'local',
            targetId: 'local',
            name: 'Local',
            sortOrder: 0,
            rootPath: '/repo',
            rootUri: 'file:///repo',
            createdAt: '',
            updatedAt: '',
          },
        ],
        listWorktreesForMount: async () => [],
        listWorktreesForWorkspace: async () => [],
      },
      input: {
        kind: 'agent',
        ...(root ? { projectId: 'project' } : { space: { kind: 'spaceId', spaceId: 'space' } }),
        data,
      },
    })
  return {
    store,
    runtime,
    write,
    run,
    state: () => state,
    advance: (change: (state: NodeControlAppState) => void) => {
      change(state)
      revision++
    },
  }
}
