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

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas', () => {
  return {
    WorkspaceCanvas: (props: { workspaceId: string }) => {
      workspaceCanvasRenderSpy(props)
      return <div data-testid="workspace-canvas">{props.workspaceId}</div>
    },
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

describe('WorkspaceMain memoization', () => {
  it('does not re-render the workspace canvas when props are referentially unchanged', () => {
    const activeWorkspace = createWorkspace('workspace-1')
    const onShowMessage = vi.fn()
    const onRequestPersistFlush = vi.fn()
    const onAppendSpaceArchiveRecord = vi.fn()
    const onNodesChange = vi.fn()
    const onViewportChange = vi.fn()
    const onMinimapVisibilityChange = vi.fn()
    const onSpacesChange = vi.fn()
    const onActiveSpaceChange = vi.fn()

    const props = {
      activeWorkspace,
      agentSettings: DEFAULT_AGENT_SETTINGS,
      focusRequest: null,
      isFocusNodeTargetZoomPreviewing: false,
      shortcutsEnabled: true,
      onAddWorkspace: vi.fn(),
      onShowMessage,
      onRequestPersistFlush,
      onAppendSpaceArchiveRecord,
      onNodesChange,
      onViewportChange,
      onMinimapVisibilityChange,
      onSpacesChange,
      onActiveSpaceChange,
    }

    const { rerender } = render(<WorkspaceMain {...props} />)
    expect(workspaceCanvasRenderSpy).toHaveBeenCalledTimes(1)

    rerender(<WorkspaceMain {...props} />)
    expect(workspaceCanvasRenderSpy).toHaveBeenCalledTimes(1)

    rerender(<WorkspaceMain {...props} shortcutsEnabled={false} />)
    expect(workspaceCanvasRenderSpy).toHaveBeenCalledTimes(2)
  })
})
