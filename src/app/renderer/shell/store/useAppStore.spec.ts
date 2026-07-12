import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useAppStore, type AppStoreState } from './useAppStore'

type ReorderWorkspacesAction = (activeId: string, overId: string) => void

const initialState = useAppStore.getInitialState()

function createWorkspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

afterEach(() => {
  useAppStore.setState(initialState, true)
})

describe('useAppStore', () => {
  it('reorders workspaces when dragging one item over another', () => {
    useAppStore.setState(
      {
        workspaces: [
          createWorkspace('workspace-1'),
          createWorkspace('workspace-2'),
          createWorkspace('workspace-3'),
        ],
      },
      false,
    )

    const state = useAppStore.getState() as AppStoreState & {
      reorderWorkspaces?: ReorderWorkspacesAction
    }

    expect(state.reorderWorkspaces).toBeTypeOf('function')

    state.reorderWorkspaces?.('workspace-3', 'workspace-1')

    expect(useAppStore.getState().workspaces.map(workspace => workspace.id)).toEqual([
      'workspace-3',
      'workspace-1',
      'workspace-2',
    ])
  })

  it('ignores reorder requests when either workspace id is missing', () => {
    useAppStore.setState(
      {
        workspaces: [
          createWorkspace('workspace-1'),
          createWorkspace('workspace-2'),
          createWorkspace('workspace-3'),
        ],
      },
      false,
    )

    const state = useAppStore.getState() as AppStoreState & {
      reorderWorkspaces?: ReorderWorkspacesAction
    }

    state.reorderWorkspaces?.('workspace-missing', 'workspace-1')
    state.reorderWorkspaces?.('workspace-1', 'workspace-missing')

    expect(useAppStore.getState().workspaces.map(workspace => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ])
  })

  it('treats dragging a workspace onto itself as a no-op', () => {
    useAppStore.setState(
      {
        workspaces: [
          createWorkspace('workspace-1'),
          createWorkspace('workspace-2'),
          createWorkspace('workspace-3'),
        ],
      },
      false,
    )

    const state = useAppStore.getState() as AppStoreState & {
      reorderWorkspaces?: ReorderWorkspacesAction
    }

    state.reorderWorkspaces?.('workspace-2', 'workspace-2')

    expect(useAppStore.getState().workspaces.map(workspace => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ])
  })

  it('pins a root space and moves it ahead of unpinned spaces', () => {
    const workspace = createWorkspace('workspace-1')
    workspace.spaces = [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: workspace.path,
        targetMountId: null,
        sortOrder: 0,
        labelColor: null,
        nodeIds: [],
        rect: null,
      },
      {
        id: 'space-b',
        name: 'Space B',
        directoryPath: workspace.path,
        targetMountId: null,
        sortOrder: 1,
        labelColor: null,
        nodeIds: [],
        rect: null,
      },
    ]
    useAppStore.setState({ workspaces: [workspace] }, false)

    expect(useAppStore.getState().setWorkspaceSpacePinned('workspace-1', 'space-b', true)).toBe(
      true,
    )
    expect(
      [...useAppStore.getState().workspaces[0]!.spaces]
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map(space => [space.id, space.pinned]),
    ).toEqual([
      ['space-b', true],
      ['space-a', undefined],
    ])
  })
})
