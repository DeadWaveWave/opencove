import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useAppStore } from '../store/useAppStore'
import { useAddWorkspaceAction } from './useAddWorkspaceAction'

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

function HookHost(): React.JSX.Element {
  const addWorkspace = useAddWorkspaceAction()

  return (
    <button type="button" onClick={() => void addWorkspace()}>
      Add workspace
    </button>
  )
}

afterEach(() => {
  useAppStore.setState(initialState, true)
  vi.restoreAllMocks()
})

describe('useAddWorkspaceAction', () => {
  it('appends a newly selected workspace to the end of the list', async () => {
    const selectedWorkspace = {
      id: 'workspace-3',
      name: 'workspace-3',
      path: '/tmp/workspace-3',
    }

    useAppStore.setState(
      {
        workspaces: [createWorkspace('workspace-1'), createWorkspace('workspace-2')],
        activeWorkspaceId: 'workspace-1',
      },
      false,
    )

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        workspace: {
          selectDirectory: vi.fn(async () => selectedWorkspace),
        },
      },
    })

    render(<HookHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }))

    await waitFor(() => {
      expect(useAppStore.getState().workspaces.map(workspace => workspace.id)).toEqual([
        'workspace-1',
        'workspace-2',
        'workspace-3',
      ])
    })

    expect(useAppStore.getState().activeWorkspaceId).toBe('workspace-3')
  })
})
