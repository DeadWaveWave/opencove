import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

const workspaceCanvasRenderSpy = vi.fn()

// Mirrors the real export: WorkspaceCanvas is React.memo, so a render reaches it only when a prop changes identity.
vi.mock('../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas', () => {
  return {
    WorkspaceCanvas: React.memo((props: { workspaceId: string }) => {
      workspaceCanvasRenderSpy(props)
      return <div data-testid="workspace-canvas">{props.workspaceId}</div>
    }),
  }
})

import { WorkspaceMain } from '../../../src/app/renderer/shell/components/WorkspaceMain'

function createWorkspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    nodes: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

afterEach(() => {
  workspaceCanvasRenderSpy.mockReset()
})

describe('WorkspaceMain canvas props', () => {
  it('does not re-render the canvas when WorkspaceMain re-renders for a prop the canvas does not take', () => {
    const props = {
      activeWorkspace: createWorkspace('workspace-1'),
      agentSettings: DEFAULT_AGENT_SETTINGS,
      terminalDisplayCalibration: null,
      focusRequest: null,
      isFocusNodeTargetZoomPreviewing: false,
      shortcutsEnabled: true,
      onAddWorkspace: vi.fn(),
      onShowMessage: vi.fn(),
      onAppendSpaceArchiveRecord: vi.fn(),
      onViewportChange: vi.fn(),
      onMinimapVisibilityChange: vi.fn(),
      onChangePreserveWindowSizesOnArrange: vi.fn(),
      onActiveSpaceChange: vi.fn(),
      onOpenProjectContextMenu: vi.fn(),
    }

    const { rerender } = render(<WorkspaceMain {...props} />)
    expect(workspaceCanvasRenderSpy).toHaveBeenCalledTimes(1)

    // What an AppShell render does today: a fresh onAddWorkspace, every other prop unchanged.
    rerender(<WorkspaceMain {...props} onAddWorkspace={vi.fn()} />)
    rerender(<WorkspaceMain {...props} onAddWorkspace={vi.fn()} isSettingsPageOpen />)
    expect(workspaceCanvasRenderSpy).toHaveBeenCalledTimes(1)

    // The Space context menu still opens for the workspace the canvas shows.
    const { onOpenSpaceContextMenu } = workspaceCanvasRenderSpy.mock.calls[0]![0] as {
      onOpenSpaceContextMenu: (spaceId: string, anchor: { x: number; y: number }) => void
    }
    onOpenSpaceContextMenu('space-1', { x: 10, y: 20 })
    expect(props.onOpenProjectContextMenu).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      x: 10,
      y: 20,
      target: { kind: 'space', workspaceId: 'workspace-1', spaceId: 'space-1' },
    })

    // A different workspace gets a callback bound to it.
    rerender(<WorkspaceMain {...props} activeWorkspace={createWorkspace('workspace-2')} />)
    const latest = workspaceCanvasRenderSpy.mock.lastCall![0] as {
      onOpenSpaceContextMenu: (spaceId: string, anchor: { x: number; y: number }) => void
    }
    latest.onOpenSpaceContextMenu('space-2', { x: 1, y: 2 })
    expect(props.onOpenProjectContextMenu).toHaveBeenLastCalledWith({
      workspaceId: 'workspace-2',
      x: 1,
      y: 2,
      target: { kind: 'space', workspaceId: 'workspace-2', spaceId: 'space-2' },
    })
  })
})
