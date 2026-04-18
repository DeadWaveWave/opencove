import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerWorktreeHandlers } from '../../../src/app/main/controlSurface/handlers/worktreeHandlers'
import type {
  CreateGitWorktreeInput,
  GitWorktreeInfo,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
} from '../../../src/shared/contracts/dto'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
}

function createStubStore(state: unknown) {
  let writtenState: unknown | null = null

  return {
    store: {
      readWorkspaceStateRaw: async () => null,
      writeWorkspaceStateRaw: async () => ({ ok: true, level: 'full', bytes: 0 }),
      readAppState: async () => state,
      writeAppState: async (next: unknown) => {
        writtenState = next
        return { ok: true, level: 'full', bytes: 1 }
      },
      readNodeScrollback: async () => null,
      writeNodeScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
      consumeRecovery: () => null,
      dispose: () => undefined,
    },
    getWrittenState: () => writtenState,
  }
}

describe('control surface worktree handlers', () => {
  it('lists worktrees for a project', async () => {
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [
        {
          id: 'ws1',
          name: 'Workspace',
          path: '/repo',
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: null,
          nodes: [],
          spaceArchiveRecords: [],
        },
      ],
      settings: {},
    }

    const { store } = createStubStore(appState)

    const controlSurface = createControlSurface()
    registerWorktreeHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => store,
      gitWorktreePort: {
        listBranches: async () => ({ current: null, branches: [] }),
        listWorktrees: async (_input: ListGitWorktreesInput): Promise<ListGitWorktreesResult> => ({
          worktrees: [{ path: '/repo', head: null, branch: 'main' }],
        }),
        getStatusSummary: async () => ({ changedFileCount: 0 }),
        getDefaultBranch: async () => 'main',
        createWorktree: async (_input: CreateGitWorktreeInput): Promise<GitWorktreeInfo> => ({
          path: '/worktrees/wt1',
          head: null,
          branch: 'feature-a',
        }),
        removeWorktree: async (
          _input: RemoveGitWorktreeInput,
        ): Promise<RemoveGitWorktreeResult> => ({
          deletedBranchName: null,
          branchDeleteError: null,
          directoryCleanupError: null,
        }),
        renameBranch: async () => undefined,
        suggestNames: async () => ({
          branchName: 'feature-a',
          worktreeName: 'worktree',
          provider: 'codex',
          effectiveModel: null,
        }),
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'worktree.list',
      payload: null,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.projectId).toBe('ws1')
      expect(result.value.repoPath).toBe('/repo')
      expect(result.value.worktrees.length).toBe(1)
    }
  })

  it('creates a worktree and updates the bound space directory', async () => {
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [
        {
          id: 'ws1',
          name: 'Workspace',
          path: '/repo',
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: 's1',
              name: 'Space A',
              directoryPath: '/repo',
              labelColor: null,
              nodeIds: [],
              rect: null,
            },
          ],
          activeSpaceId: null,
          nodes: [],
          spaceArchiveRecords: [],
        },
      ],
      settings: {},
    }

    const { store, getWrittenState } = createStubStore(appState)

    const controlSurface = createControlSurface()
    registerWorktreeHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => store,
      gitWorktreePort: {
        listBranches: async () => ({ current: null, branches: [] }),
        listWorktrees: async () => ({ worktrees: [] }),
        getStatusSummary: async () => ({ changedFileCount: 0 }),
        getDefaultBranch: async () => 'main',
        createWorktree: async (): Promise<GitWorktreeInfo> => ({
          path: '/worktrees/wt1',
          head: null,
          branch: 'feature-a',
        }),
        removeWorktree: async (): Promise<RemoveGitWorktreeResult> => ({
          deletedBranchName: null,
          branchDeleteError: null,
          directoryCleanupError: null,
        }),
        renameBranch: async () => undefined,
        suggestNames: async () => ({
          branchName: 'feature-a',
          worktreeName: 'worktree',
          provider: 'codex',
          effectiveModel: null,
        }),
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'worktree.create',
      payload: { spaceId: 's1', name: 'feature-a' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.spaceDirectoryPath).toBe('/worktrees/wt1')
      expect(result.value.spaceName).toBe('feature-a')
    }

    const written = getWrittenState() as unknown as {
      workspaces: Array<{
        spaces: Array<{
          directoryPath: string
          name: string
        }>
      }>
    }
    expect(written.workspaces[0].spaces[0].directoryPath).toBe('/worktrees/wt1')
    expect(written.workspaces[0].spaces[0].name).toBe('feature-a')
  })

  it('rejects invalid payloads', async () => {
    const { store } = createStubStore({
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: {},
    })

    const controlSurface = createControlSurface()
    registerWorktreeHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
      getPersistenceStore: async () => store,
      gitWorktreePort: {
        listBranches: async () => ({ current: null, branches: [] }),
        listWorktrees: async () => ({ worktrees: [] }),
        getStatusSummary: async () => ({ changedFileCount: 0 }),
        getDefaultBranch: async () => 'main',
        createWorktree: async (): Promise<GitWorktreeInfo> => ({
          path: '/worktrees/wt1',
          head: null,
          branch: 'feature-a',
        }),
        removeWorktree: async (): Promise<RemoveGitWorktreeResult> => ({
          deletedBranchName: null,
          branchDeleteError: null,
          directoryCleanupError: null,
        }),
        renameBranch: async () => undefined,
        suggestNames: async () => ({
          branchName: 'feature-a',
          worktreeName: 'worktree',
          provider: 'codex',
          effectiveModel: null,
        }),
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'worktree.create',
      payload: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.invalid_input')
    }
  })
})
