import { describe, expect, it, vi } from 'vitest'
import {
  createPersistedWorkspaceApprovalGate,
  listPersistedWorkspaceApprovalRoots,
} from '../../../src/contexts/workspace/infrastructure/approval/PersistedWorkspaceApproval'

describe('PersistedWorkspaceApproval', () => {
  it('lists unique persisted workspace roots from app state', () => {
    expect(
      listPersistedWorkspaceApprovalRoots({
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            name: 'One',
            path: '/tmp/one',
            nodes: [],
            spaces: [
              {
                id: 'space-1',
                name: 'Feature',
                directoryPath: '/tmp/one/.opencove/worktrees/feature-a',
                nodeIds: [],
              },
              {
                id: 'space-2',
                name: 'External',
                directoryPath: '  /Users/me/.codex/worktrees/1234/project  ',
                nodeIds: [],
              },
            ],
          },
          { id: 'workspace-2', name: 'Two', path: '  /tmp/two  ', nodes: [], spaces: [] },
          { id: 'workspace-3', name: 'Three', path: '/tmp/one', nodes: [] },
          { id: 'workspace-4', name: 'Four', path: '   ', nodes: [] },
        ],
      }),
    ).toEqual([
      '/tmp/one',
      '/tmp/one/.opencove/worktrees/feature-a',
      '/Users/me/.codex/worktrees/1234/project',
      '/tmp/two',
    ])
  })

  it('waits for startup hydration before answering approvals or accepting writes', async () => {
    let releaseHydration: (() => void) | null = null
    const hydrationBarrier = new Promise<void>(resolve => {
      releaseHydration = resolve
    })

    const registeredRoots: string[] = []
    const approvedRoots = new Set<string>()
    const approvedWorkspaces = {
      registerRoot: vi.fn(async (rootPath: string) => {
        if (rootPath === '/tmp/persisted') {
          await hydrationBarrier
        }

        approvedRoots.add(rootPath)
        registeredRoots.push(rootPath)
      }),
      isPathApproved: vi.fn(async (targetPath: string) => approvedRoots.has(targetPath)),
    }

    const gate = createPersistedWorkspaceApprovalGate({
      approvedWorkspaces,
      readAppState: async () => ({
        activeWorkspaceId: 'workspace-1',
        workspaces: [{ id: 'workspace-1', name: 'One', path: '/tmp/persisted', nodes: [] }],
      }),
      extraRoots: ['/tmp/test-root'],
    })

    const isApprovedPromise = gate.approvedWorkspaces.isPathApproved('/tmp/persisted')
    const registerRootPromise = gate.approvedWorkspaces.registerRoot('/tmp/later')

    await Promise.resolve()
    expect(approvedWorkspaces.isPathApproved).not.toHaveBeenCalled()
    expect(registeredRoots).toEqual(['/tmp/test-root'])

    releaseHydration?.()

    await expect(isApprovedPromise).resolves.toBe(true)
    await expect(registerRootPromise).resolves.toBeUndefined()
    await expect(gate.ready).resolves.toBeUndefined()

    expect(registeredRoots).toEqual(['/tmp/test-root', '/tmp/persisted', '/tmp/later'])
    expect(approvedWorkspaces.isPathApproved).toHaveBeenCalledWith('/tmp/persisted')
  })

  it('registers extra roots even when the startup read fails', async () => {
    const approvedRoots = new Set<string>()
    const approvedWorkspaces = {
      registerRoot: vi.fn(async (rootPath: string) => {
        approvedRoots.add(rootPath)
      }),
      isPathApproved: vi.fn(async (targetPath: string) => approvedRoots.has(targetPath)),
    }
    const onError = vi.fn()

    const gate = createPersistedWorkspaceApprovalGate({
      approvedWorkspaces,
      readAppState: async () => {
        throw new Error('Storage is unavailable')
      },
      extraRoots: ['/tmp/test-root'],
      onError,
    })

    await expect(gate.ready).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    await expect(gate.approvedWorkspaces.isPathApproved('/tmp/test-root')).resolves.toBe(true)
  })

  it('re-reads on the next approval check after a failed startup read', async () => {
    const approvedRoots = new Set<string>()
    const approvedWorkspaces = {
      registerRoot: vi.fn(async (rootPath: string) => {
        approvedRoots.add(rootPath)
      }),
      isPathApproved: vi.fn(async (targetPath: string) => approvedRoots.has(targetPath)),
    }
    const onError = vi.fn()
    const readAppState = vi
      .fn()
      .mockRejectedValueOnce(new Error('Storage is unavailable'))
      .mockResolvedValue({
        activeWorkspaceId: 'workspace-1',
        workspaces: [{ id: 'workspace-1', name: 'One', path: '/tmp/persisted', nodes: [] }],
      })

    const gate = createPersistedWorkspaceApprovalGate({
      approvedWorkspaces,
      readAppState,
      onError,
    })

    await expect(gate.ready).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(readAppState).toHaveBeenCalledTimes(1)

    await expect(gate.approvedWorkspaces.isPathApproved('/tmp/persisted')).resolves.toBe(true)
    expect(readAppState).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)

    // Once hydrated, later checks do not read again.
    await expect(gate.approvedWorkspaces.isPathApproved('/tmp/persisted')).resolves.toBe(true)
    expect(readAppState).toHaveBeenCalledTimes(2)
  })

  it('re-reads on the next registerRoot after a failed startup read and shares one retry between concurrent checks', async () => {
    const approvedRoots = new Set<string>()
    const approvedWorkspaces = {
      registerRoot: vi.fn(async (rootPath: string) => {
        approvedRoots.add(rootPath)
      }),
      isPathApproved: vi.fn(async (targetPath: string) => approvedRoots.has(targetPath)),
    }
    const readAppState = vi
      .fn()
      .mockRejectedValueOnce(new Error('Storage is unavailable'))
      .mockResolvedValue({
        activeWorkspaceId: 'workspace-1',
        workspaces: [{ id: 'workspace-1', name: 'One', path: '/tmp/persisted', nodes: [] }],
      })

    const gate = createPersistedWorkspaceApprovalGate({
      approvedWorkspaces,
      readAppState,
    })

    await expect(gate.ready).resolves.toBeUndefined()
    expect(readAppState).toHaveBeenCalledTimes(1)

    const [firstCheck, secondCheck] = await Promise.all([
      gate.approvedWorkspaces.isPathApproved('/tmp/persisted'),
      gate.approvedWorkspaces.isPathApproved('/tmp/persisted'),
    ])

    expect(firstCheck).toBe(true)
    expect(secondCheck).toBe(true)
    expect(readAppState).toHaveBeenCalledTimes(2)

    await expect(gate.approvedWorkspaces.registerRoot('/tmp/later')).resolves.toBeUndefined()
    await expect(gate.approvedWorkspaces.isPathApproved('/tmp/later')).resolves.toBe(true)
    expect(readAppState).toHaveBeenCalledTimes(2)
  })
})
