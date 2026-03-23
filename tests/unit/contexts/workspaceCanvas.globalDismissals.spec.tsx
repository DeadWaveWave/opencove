import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvasView } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/WorkspaceCanvasView'

vi.mock('@xyflow/react', () => {
  return {
    Background: () => null,
    Controls: () => null,
    useStoreApi: () => ({
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      subscribe: vi.fn(),
    }),
    ReactFlow: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="workspace-react-flow">{children}</div>
    ),
    SelectionMode: {
      Partial: 'partial',
    },
    PanOnScrollMode: {
      Free: 'free',
    },
    BackgroundVariant: {
      Dots: 'dots',
    },
  }
})

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceContextMenu',
  () => {
    return {
      WorkspaceContextMenu: ({ contextMenu }: { contextMenu: unknown }) => {
        if (!contextMenu) {
          return null
        }

        return (
          <div className="workspace-context-menu">
            <button type="button" data-testid="workspace-context-menu-button">
              Menu
            </button>
          </div>
        )
      },
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceSwitcher',
  () => {
    return {
      WorkspaceSpaceSwitcher: () => <input data-testid="workspace-dummy-input" />,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceMinimapDock',
  () => {
    return {
      WorkspaceMinimapDock: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSelectionDraftOverlay',
  () => {
    return {
      WorkspaceSelectionDraftOverlay: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSnapGuidesOverlay',
  () => {
    return {
      WorkspaceSnapGuidesOverlay: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceActionMenu',
  () => {
    return {
      WorkspaceSpaceActionMenu: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceRegionsOverlay',
  () => {
    return {
      WorkspaceSpaceRegionsOverlay: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/TaskCreatorWindow',
  () => {
    return {
      TaskCreatorWindow: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/TaskEditorWindow',
  () => {
    return {
      TaskEditorWindow: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/NodeDeleteConfirmationWindow',
  () => {
    return {
      NodeDeleteConfirmationWindow: () => null,
    }
  },
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/SpaceWorktreeWindow',
  () => {
    return {
      SpaceWorktreeWindow: () => null,
    }
  },
)

const switcherSpace = {
  id: 'space-1',
  name: 'Space 1',
  directoryPath: '/tmp/space-1',
  nodeIds: [],
  rect: null,
} as const

function createBaseProps(
  overrides: Partial<React.ComponentProps<typeof WorkspaceCanvasView>> = {},
): React.ComponentProps<typeof WorkspaceCanvasView> {
  const canvasRef = React.createRef<HTMLDivElement>()

  return {
    canvasRef,
    resolvedCanvasInputMode: 'mouse',
    onCanvasClick: () => undefined,
    handleCanvasPointerDownCapture: () => undefined,
    handleCanvasPointerMoveCapture: () => undefined,
    handleCanvasPointerUpCapture: () => undefined,
    handleCanvasDoubleClickCapture: () => undefined,
    handleCanvasWheelCapture: () => undefined,
    nodes: [],
    edges: [],
    nodeTypes: {},
    onNodesChange: () => undefined,
    onPaneClick: () => undefined,
    onPaneContextMenu: () => undefined,
    onNodeClick: () => undefined,
    onNodeContextMenu: () => undefined,
    onSelectionContextMenu: () => undefined,
    onSelectionChange: () => undefined,
    onNodeDragStart: () => undefined,
    onSelectionDragStart: () => undefined,
    onNodeDragStop: () => undefined,
    onSelectionDragStop: () => undefined,
    onMoveEnd: () => undefined,
    viewport: { x: 0, y: 0, zoom: 1 },
    isTrackpadCanvasMode: false,
    useManualCanvasWheelGestures: false,
    isShiftPressed: false,
    selectionDraft: null,
    snapGuides: null,
    spaceVisuals: [],
    spaceFramePreview: null,
    selectedSpaceIds: [],
    handleSpaceDragHandlePointerDown: () => undefined,
    editingSpaceId: null,
    spaceRenameInputRef: React.createRef<HTMLInputElement>(),
    spaceRenameDraft: '',
    setSpaceRenameDraft: () => undefined,
    commitSpaceRename: () => undefined,
    cancelSpaceRename: () => undefined,
    startSpaceRename: () => undefined,
    selectedNodeCount: 0,
    isMinimapVisible: false,
    minimapNodeColor: () => '#000000',
    setIsMinimapVisible: () => undefined,
    onMinimapVisibilityChange: () => undefined,
    spaces: [],
    focusSpaceInViewport: () => undefined,
    focusAllInViewport: () => undefined,
    contextMenu: null,
    closeContextMenu: () => undefined,
    magneticSnappingEnabled: true,
    onToggleMagneticSnapping: () => undefined,
    createTerminalNode: async () => undefined,
    createNoteNodeFromContextMenu: () => undefined,
    arrangeAll: () => undefined,
    arrangeCanvas: () => undefined,
    arrangeInSpace: () => undefined,
    openTaskCreator: () => undefined,
    openAgentLauncher: () => undefined,
    createSpaceFromSelectedNodes: () => undefined,
    clearNodeSelection: () => undefined,
    canConvertSelectedNoteToTask: false,
    isConvertSelectedNoteToTaskDisabled: false,
    convertSelectedNoteToTask: () => undefined,
    taskCreator: null,
    taskTitleProviderLabel: '',
    taskTitleModelLabel: '',
    taskTagOptions: [],
    setTaskCreator: () => undefined,
    closeTaskCreator: () => undefined,
    generateTaskTitle: async () => undefined,
    createTask: async () => undefined,
    taskEditor: null,
    setTaskEditor: () => undefined,
    closeTaskEditor: () => undefined,
    generateTaskEditorTitle: async () => undefined,
    saveTaskEdits: async () => undefined,
    nodeDeleteConfirmation: null,
    setNodeDeleteConfirmation: () => undefined,
    confirmNodeDelete: async () => undefined,
    agentSettings: DEFAULT_AGENT_SETTINGS,
    workspacePath: '/tmp',
    spaceActionMenu: null,
    availablePathOpeners: [],
    openSpaceActionMenu: () => undefined,
    closeSpaceActionMenu: () => undefined,
    copySpacePath: () => undefined,
    openSpacePath: () => undefined,
    spaceWorktreeDialog: null,
    worktreesRoot: '',
    openSpaceCreateWorktree: () => undefined,
    openSpaceArchive: () => undefined,
    closeSpaceWorktree: () => undefined,
    updateSpaceDirectory: () => undefined,
    getSpaceBlockingNodes: () => ({ agentNodeIds: [], terminalNodeIds: [] }),
    closeNodesById: async () => undefined,
    ...overrides,
  }
}

describe('WorkspaceCanvasView global pointer/click handlers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('closes the context menu when left-clicking outside of it', async () => {
    const closeContextMenu = vi.fn()

    render(
      <WorkspaceCanvasView
        {...createBaseProps({
          contextMenu: { kind: 'selection', x: 12, y: 12 },
          closeContextMenu,
          spaces: [switcherSpace],
        })}
      />,
    )

    await act(async () => {})

    const menuButton = screen.getByTestId('workspace-context-menu-button')
    fireEvent(menuButton, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(closeContextMenu).not.toHaveBeenCalled()

    const dummyInput = screen.getByTestId('workspace-dummy-input')
    fireEvent(dummyInput, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(closeContextMenu).toHaveBeenCalled()
  })

  it('clears selection when a node is selected and user clicks an editable target', async () => {
    const clearNodeSelection = vi.fn()

    render(
      <WorkspaceCanvasView
        {...createBaseProps({
          selectedNodeCount: 1,
          clearNodeSelection,
          spaces: [switcherSpace],
        })}
      />,
    )

    await act(async () => {})

    fireEvent.click(screen.getByTestId('workspace-dummy-input'))
    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(clearNodeSelection).toHaveBeenCalledTimes(1)
  })
})
