import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from '../contexts/workspacePixelLayer.fixtures'

const cleanup = vi.hoisted(() => ({ release: null as null | (() => void) }))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeLifecycle',
  () => ({
    killUnownedNodeRuntime: () =>
      new Promise<void>(resolve => {
        cleanup.release = resolve
      }),
  }),
)

import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { removeWorkspace } from '../../../src/app/renderer/shell/utils/removeWorkspace'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title: id })],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

describe('removeWorkspace', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [workspace('a'), workspace('b'), workspace('c')],
      activeWorkspaceId: 'a',
    })
  })

  afterEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('keeps a write to another workspace that lands while the runtime clean-up is in flight', async () => {
    const removal = removeWorkspace('a')
    await vi.waitFor(() => expect(cleanup.release).not.toBeNull())

    useAppStore.getState().setWorkspaceName('b', 'renamed meanwhile')
    cleanup.release?.()
    await removal

    const state = useAppStore.getState()
    expect(state.workspaces.map(item => item.id)).toEqual(['b', 'c'])
    expect(state.workspaces[0].name).toBe('renamed meanwhile')
    expect(state.activeWorkspaceId).toBe('b')
  })
})
