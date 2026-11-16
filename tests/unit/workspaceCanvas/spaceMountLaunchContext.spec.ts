import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MountDto } from '@shared/contracts/dto'
import { createTerminalNodeAtFlowPosition } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.paneNodeCreation'
import { resolveSpaceMountLaunchContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/spaceMountLaunchContext'
import { replaceWorkspaceSpaces } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasDocumentCommands,
  type CanvasDocumentHarness,
} from '../../support/canvasDocumentHarness'

// A launch repairs the mount of its target Space after `mount.list` answers. The repair is written
// as a recipe over the Spaces the store holds when it runs, so a Space that changed during the
// await survives it (#702).

const WORKSPACE_ID = 'workspace-1'
const ROOT = '/repo'
const WORKTREE = '/repo/worktrees/feature-a'

const mount: MountDto = {
  mountId: 'mount-1',
  projectId: WORKSPACE_ID,
  name: 'Primary',
  sortOrder: 0,
  endpointId: 'local',
  targetId: 'target-1',
  rootPath: ROOT,
  rootUri: `file://${ROOT}`,
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
}

function spaceOf(id: string, overrides: Partial<WorkspaceSpaceState> = {}): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: WORKTREE,
    targetMountId: 'mount-stale',
    labelColor: null,
    nodeIds: [],
    rect: { x: 0, y: 0, width: 1200, height: 800 },
    ...overrides,
  }
}

// `mount.list` answers when the test says so; any other request is a spawn.
function stubControlSurface(): { resolveMounts: () => void; invoke: ReturnType<typeof vi.fn> } {
  let resolveMounts!: () => void
  const mountsAnswer = new Promise<{ projectId: string; mounts: MountDto[] }>(resolve => {
    resolveMounts = () => resolve({ projectId: WORKSPACE_ID, mounts: [mount] })
  })
  const invoke = vi.fn(async (request: { id: string }) =>
    request.id === 'mount.list'
      ? await mountsAnswer
      : { sessionId: 'session-1', profileId: null, runtimeKind: 'posix' as const },
  )
  window.opencoveApi = { controlSurface: { invoke } } as unknown as typeof window.opencoveApi
  return { resolveMounts, invoke }
}

// The committer of the lifecycle path.
function lifecycleCommitter(harness: CanvasDocumentHarness) {
  const commands = renderCanvasDocumentCommands(harness.workspaceId)
  return (recipe: Parameters<typeof commands.updateSpaces>[0]) =>
    commands.updateSpaces(recipe, { flush: true })
}

describe('resolveSpaceMountLaunchContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a Space that was renamed in the store while mount.list was pending', async () => {
    const target = spaceOf('space-1')
    const other = spaceOf('space-2', { name: 'Docs', targetMountId: null })
    const harness = createCanvasDocumentHarness({ spaces: [target, other] })
    const commitSpaceRepair = lifecycleCommitter(harness)
    const { resolveMounts } = stubControlSurface()

    const pending = resolveSpaceMountLaunchContext({
      workspaceId: WORKSPACE_ID,
      workspacePath: ROOT,
      space: target,
      commitSpaceRepair,
    })
    act(() => {
      replaceWorkspaceSpaces(WORKSPACE_ID, [
        { ...target, name: 'Renamed target' },
        { ...other, name: 'Renamed other' },
      ])
    })
    harness.notifications.mockClear()
    resolveMounts()
    const resolved = await pending

    expect(harness.readStoreDocument().spaces).toEqual([
      { ...target, name: 'Renamed target', targetMountId: 'mount-1', directoryPath: WORKTREE },
      { ...other, name: 'Renamed other' },
    ])
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(resolved.space).toEqual({
      ...target,
      name: 'Renamed target',
      targetMountId: 'mount-1',
      directoryPath: WORKTREE,
    })
    expect(resolved.mountId).toBe('mount-1')
    expect(resolved.workingDirectory).toBe(WORKTREE)
  })

  it('writes nothing and does not flush when the Space needs no repair', async () => {
    const target = spaceOf('space-1', { targetMountId: 'mount-1' })
    const harness = createCanvasDocumentHarness({ spaces: [target] })
    const commitSpaceRepair = vi.fn(lifecycleCommitter(harness))
    const { resolveMounts } = stubControlSurface()
    resolveMounts()

    const resolved = await resolveSpaceMountLaunchContext({
      workspaceId: WORKSPACE_ID,
      workspacePath: ROOT,
      space: target,
      commitSpaceRepair,
    })

    expect(commitSpaceRepair).not.toHaveBeenCalled()
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(resolved.space).toBe(target)
  })

  it('hands one recipe to the committer per repair, and the lifecycle committer flushes once', async () => {
    const target = spaceOf('space-1')
    const harness = createCanvasDocumentHarness({ spaces: [target] })
    const commitSpaceRepair = vi.fn(lifecycleCommitter(harness))
    const { resolveMounts } = stubControlSurface()
    resolveMounts()

    await resolveSpaceMountLaunchContext({
      workspaceId: WORKSPACE_ID,
      workspacePath: ROOT,
      space: target,
      commitSpaceRepair,
    })

    expect(commitSpaceRepair).toHaveBeenCalledTimes(1)
    expect(commitSpaceRepair).toHaveBeenCalledWith(expect.any(Function))
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('does not write back a Space that was deleted while mount.list was pending, and returns it repaired', async () => {
    const target = spaceOf('space-1')
    const other = spaceOf('space-2', { name: 'Docs' })
    const harness = createCanvasDocumentHarness({ spaces: [target, other] })
    const commitSpaceRepair = lifecycleCommitter(harness)
    const { resolveMounts } = stubControlSurface()

    const pending = resolveSpaceMountLaunchContext({
      workspaceId: WORKSPACE_ID,
      workspacePath: ROOT,
      space: target,
      commitSpaceRepair,
    })
    act(() => {
      replaceWorkspaceSpaces(WORKSPACE_ID, [other])
    })
    harness.notifications.mockClear()
    resolveMounts()
    const resolved = await pending

    expect(harness.readStoreDocument().spaces).toEqual([other])
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(resolved.space).toEqual({
      ...target,
      targetMountId: 'mount-1',
      directoryPath: WORKTREE,
    })
    expect(resolved.mountId).toBe('mount-1')
  })

  it('writes nothing without a committer and returns the Space with the repair applied', async () => {
    const target = spaceOf('space-1')
    const harness = createCanvasDocumentHarness({ spaces: [target] })
    const { resolveMounts } = stubControlSurface()
    resolveMounts()

    const resolved = await resolveSpaceMountLaunchContext({
      workspaceId: WORKSPACE_ID,
      workspacePath: ROOT,
      space: target,
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces).toEqual([target])
    expect(resolved.space).toEqual({ ...target, targetMountId: 'mount-1', directoryPath: WORKTREE })
  })
})

describe('the mount repair of a terminal created from the pane', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  })

  function launchOnPane(
    harness: CanvasDocumentHarness,
    persistedSpaces: WorkspaceSpaceState[],
    onSpacesChange = vi.fn(),
  ) {
    const updateSpaces = renderCanvasDocumentCommands(harness.workspaceId).updateSpaces
    ;(window.opencoveApi as unknown as Record<string, unknown>).persistence = {
      readAppState: vi.fn(async () => ({
        state: {
          activeWorkspaceId: WORKSPACE_ID,
          workspaces: [
            {
              id: WORKSPACE_ID,
              path: ROOT,
              activeSpaceId: 'space-1',
              spaces: persistedSpaces,
            },
          ],
        },
        recovery: null,
      })),
    }
    ;(window.opencoveApi as unknown as Record<string, unknown>).pty = { spawn: vi.fn() }
    return createTerminalNodeAtFlowPosition({
      anchor: { x: 320, y: 180 },
      workspaceId: WORKSPACE_ID,
      defaultTerminalProfileId: null,
      standardWindowSizeBucket: 'regular',
      workspacePath: ROOT,
      spacesRef: {
        get current() {
          return harness.readStoreDocument().spaces
        },
      },
      nodesRef: { current: [] },
      setNodes: vi.fn(),
      onSpacesChange,
      updateSpaces,
      createNodeForSession: vi.fn(
        async () => ({ id: '00000000-0000-4000-8000-000000000001' }) as never,
      ),
    } as Parameters<typeof createTerminalNodeAtFlowPosition>[0])
  }

  it('adds a target that only the persisted snapshot holds, with the repair, and does not flush', async () => {
    const local = spaceOf('space-local', {
      targetMountId: null,
      directoryPath: '/repo/scratch',
      rect: { x: 1400, y: 0, width: 800, height: 600 },
    })
    const persistedTarget = spaceOf('space-1')
    const persistedOther = spaceOf('space-2', {
      directoryPath: '/repo/docs',
      rect: { x: 2300, y: 0, width: 800, height: 600 },
    })
    const harness = createCanvasDocumentHarness({ spaces: [local] })
    stubControlSurface().resolveMounts()
    ;(window.opencoveApi.controlSurface.invoke as ReturnType<typeof vi.fn>).mockClear()

    await launchOnPane(harness, [persistedTarget, persistedOther])

    expect(harness.readStoreDocument().spaces).toEqual([
      local,
      { ...persistedTarget, targetMountId: 'mount-1', directoryPath: WORKTREE },
      persistedOther,
    ])
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('keeps a Space that was renamed in the store while mount.list was pending', async () => {
    const target = spaceOf('space-1')
    const other = spaceOf('space-2', {
      name: 'Docs',
      rect: { x: 2300, y: 0, width: 800, height: 600 },
    })
    const harness = createCanvasDocumentHarness({ spaces: [target, other] })
    const { resolveMounts } = stubControlSurface()

    const launched = launchOnPane(harness, [target, other])
    await vi.waitFor(() =>
      expect(window.opencoveApi.controlSurface.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mount.list' }),
      ),
    )
    act(() => {
      replaceWorkspaceSpaces(WORKSPACE_ID, [target, { ...other, name: 'Renamed other' }])
    })
    harness.notifications.mockClear()
    resolveMounts()
    await launched

    expect(harness.readStoreDocument().spaces).toEqual([
      { ...target, targetMountId: 'mount-1', directoryPath: WORKTREE },
      { ...other, name: 'Renamed other' },
    ])
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
  })

  // The repair writes nothing for a Space that is gone, but the launch goes on in the repaired
  // mount; the node assignment that follows puts the Space back from the Space it was handed, so
  // that Space must carry the repair.
  it('hands the node assignment the repaired Space when the target was deleted while mount.list was pending', async () => {
    const target = spaceOf('space-1')
    const other = spaceOf('space-2', {
      name: 'Docs',
      rect: { x: 2300, y: 0, width: 800, height: 600 },
    })
    const harness = createCanvasDocumentHarness({ spaces: [target, other] })
    const { resolveMounts } = stubControlSurface()

    const launched = launchOnPane(harness, [other], spaces =>
      replaceWorkspaceSpaces(WORKSPACE_ID, spaces),
    )
    await vi.waitFor(() =>
      expect(window.opencoveApi.controlSurface.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mount.list' }),
      ),
    )
    act(() => {
      replaceWorkspaceSpaces(WORKSPACE_ID, [other])
    })
    resolveMounts()
    await launched

    const restored = harness.readStoreDocument().spaces.find(item => item.id === 'space-1')
    expect(restored).toMatchObject({
      targetMountId: 'mount-1',
      directoryPath: WORKTREE,
      nodeIds: ['00000000-0000-4000-8000-000000000001'],
    })
  })

  it('writes nothing when the Space needs no repair', async () => {
    const target = spaceOf('space-1', { targetMountId: 'mount-1' })
    const harness = createCanvasDocumentHarness({ spaces: [target] })
    stubControlSurface().resolveMounts()

    await launchOnPane(harness, [target])

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })
})
