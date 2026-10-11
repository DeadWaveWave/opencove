// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import { registerSyncHandlers } from '../../../src/app/main/controlSurface/handlers/syncHandlers'
import { registerWorktreeHandlers } from '../../../src/app/main/controlSurface/handlers/worktreeHandlers'
import { deleteNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlDelete'
import { updateNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUpdate'
import { createNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import type {
  NodeControlAppState,
  NodeControlNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { GitWorktreePort } from '../../../src/contexts/worktree/application/ports'
import type {
  PersistenceStore,
  WriteAppStateOptions,
} from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

const ctx = { now: () => new Date('2026-09-30T00:00:00Z') }

function node(id: string, kind = 'note'): NodeControlNode {
  return {
    id,
    kind,
    title: id,
    sessionId: null,
    position: { x: 100, y: 100 },
    width: 400,
    height: 300,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    agent: null,
    task: kind === 'plugin' ? { pluginId: 'sample', schemaVersion: 1 } : { text: 'original' },
    scrollback: null,
  }
}

function fixture() {
  let state: NodeControlAppState = {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        worktreesRoot: '/worktrees',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: false,
        activeSpaceId: 'space',
        nodes: [node('original')],
        spaces: [
          {
            id: 'space',
            name: 'Space',
            directoryPath: '/repo',
            targetMountId: null,
            labelColor: null,
            nodeIds: ['original'],
            rect: { x: 0, y: 0, width: 1200, height: 900 },
          },
        ],
      },
    ],
  }
  let revision = 1
  const store = {
    readAppState: vi.fn(async () => structuredClone(state)),
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
  const advance = () => {
    state.workspaces[0].nodes.push(node('concurrent-plugin', 'plugin'))
    state.workspaces[0].spaces[0].nodeIds.push('concurrent-plugin')
    revision += 1
  }
  return {
    store,
    persistence: store as unknown as PersistenceStore,
    advance,
    state: () => state,
    conflictDuringRead: () => {
      store.readAppState.mockImplementationOnce(async () => {
        const snapshot = structuredClone(state)
        advance()
        return snapshot
      })
    },
  }
}

function expectPreserved(f: ReturnType<typeof fixture>) {
  expect(f.state().workspaces[0].nodes.map(item => item.id)).toEqual([
    'original',
    'concurrent-plugin',
  ])
  expect(f.store.writeAppState).toHaveBeenCalledTimes(1)
  expect(f.store.writeAppState.mock.calls[0]?.[1]).toEqual({ expectedRevision: 1 })
}

describe('control surface full-state mutation races', () => {
  it('rebases a single spawned session onto a concurrent writer without overwriting its node', async () => {
    const f = fixture()
    const spawnTerminal = vi.fn(async () => {
      f.advance()
      return {
        sessionId: 'orphan',
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        startedAt: ctx.now().toISOString(),
        profileId: 'default',
        runtimeKind: 'posix',
      }
    })
    const killSession = vi.fn(async () => undefined)
    const created = await createNodeForNodeControl({
      store: f.store,
      locatorDeps: {
        listEndpoints: async () => [],
        listMounts: async () => [],
        listWorktreesForMount: async () => [],
        listWorktreesForWorkspace: async () => [],
      },
      runtime: {
        spawnTerminal,
        killSession,
        launchAgent: async () => {
          throw new Error('unexpected agent launch')
        },
      },
      now: ctx.now(),
      input: { kind: 'terminal', space: { kind: 'spaceId', spaceId: 'space' }, data: {} },
    })
    expect(spawnTerminal).toHaveBeenCalledTimes(1)
    expect(killSession).not.toHaveBeenCalled()
    expect(f.state().workspaces[0].nodes.map(item => item.id)).toEqual([
      'original',
      'concurrent-plugin',
      created.node.id,
    ])
    expect(f.store.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.store.writeAppState.mock.calls[0]?.[1]).toEqual({ expectedRevision: 2 })
  })

  it.each(['update', 'delete'])(
    'rejects stale node %s without tearing down runtime',
    async operation => {
      const f = fixture()
      f.state().workspaces[0].nodes[0].sessionId = 'running'
      f.conflictDuringRead()
      const killSession = vi.fn()
      const closeWebsiteNode = vi.fn()
      const result =
        operation === 'update'
          ? updateNodeForNodeControl({
              store: f.store,
              input: { nodeId: 'original', kind: 'note', data: { text: 'changed' } },
            })
          : deleteNodeForNodeControl({
              store: f.store,
              input: { nodeId: 'original' },
              runtime: { killSession, closeWebsiteNode },
              now: ctx.now(),
            })
      await expect(result).rejects.toMatchObject({ code: 'persistence.invalid_state' })
      expect(killSession).not.toHaveBeenCalled()
      expect(closeWebsiteNode).not.toHaveBeenCalled()
      expect(f.state().workspaces[0].nodes[0].task).toEqual({ text: 'original' })
      expectPreserved(f)
    },
  )

  it.each(['space.createChild', 'note.create'])(
    'rejects %s when a newer write commits during the snapshot read',
    async id => {
      const f = fixture()
      f.conflictDuringRead()
      const control = createControlSurface()
      registerSpaceHandlers(control, async () => f.persistence)
      registerSyncHandlers(control, async () => f.persistence)
      const result = await control.invoke(ctx, {
        kind: 'command',
        id,
        payload: id === 'note.create' ? { spaceId: 'space' } : { parentSpaceId: 'space' },
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'persistence.invalid_state' } })
      expectPreserved(f)
      expect(f.state().workspaces[0].spaces).toHaveLength(1)
    },
  )

  it.each(['worktree.create', 'worktree.archive'])(
    'does not replay %s or overwrite a concurrent node after Git completes',
    async id => {
      const f = fixture()
      if (id === 'worktree.archive') {
        f.state().workspaces[0].spaces[0].directoryPath = '/worktrees/feature'
      }
      const createWorktree = vi.fn(async () => {
        f.advance()
        return { path: '/worktrees/feature', branch: 'feature', head: null }
      })
      const removeWorktree = vi.fn(async () => {
        f.advance()
        return { deletedBranchName: null, branchDeleteError: null, directoryCleanupError: null }
      })
      const port = { createWorktree, removeWorktree } as unknown as GitWorktreePort
      const control = createControlSurface()
      registerWorktreeHandlers(control, {
        getPersistenceStore: async () => f.persistence,
        approvedWorkspaces: {
          isPathApproved: async () => true,
          registerRoot: async () => undefined,
        },
        gitWorktreePort: port,
      })
      const result = await control.invoke(ctx, {
        kind: 'command',
        id,
        payload: { spaceId: 'space' },
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'persistence.invalid_state' } })
      expect(createWorktree).toHaveBeenCalledTimes(id === 'worktree.create' ? 1 : 0)
      expect(removeWorktree).toHaveBeenCalledTimes(id === 'worktree.archive' ? 1 : 0)
      expectPreserved(f)
    },
  )
})
