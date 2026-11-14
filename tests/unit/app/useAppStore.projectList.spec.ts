import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

describe('app store project list actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [workspace('a'), workspace('b')],
      activeWorkspaceId: 'a',
    })
  })

  afterEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('appends a workspace without touching the others or the active workspace', () => {
    const before = useAppStore.getState().workspaces
    const added = workspace('c')

    useAppStore.getState().addWorkspace(added)

    const after = useAppStore.getState()
    expect(after.workspaces).toEqual([...before, added])
    expect(after.workspaces[0]).toBe(before[0])
    expect(after.activeWorkspaceId).toBe('a')
  })

  it('removes a workspace from the current list and returns what remains', () => {
    const before = useAppStore.getState().workspaces

    const remaining = useAppStore.getState().removeWorkspaceFromList('a')

    expect(remaining).toEqual([before[1]])
    expect(useAppStore.getState().workspaces).toBe(remaining)
    expect(useAppStore.getState().activeWorkspaceId).toBe('a')
  })

  it('renames one workspace and reports whether anything changed', () => {
    const before = useAppStore.getState().workspaces
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    expect(useAppStore.getState().setWorkspaceName('b', 'Renamed')).toBe(true)
    expect(useAppStore.getState().setWorkspaceName('b', 'Renamed')).toBe(false)
    expect(useAppStore.getState().setWorkspaceName('missing', 'x')).toBe(false)
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    const after = useAppStore.getState().workspaces
    expect(after[1].name).toBe('Renamed')
    expect(after[0]).toBe(before[0])
  })
})
