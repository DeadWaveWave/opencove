import React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvasView } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/WorkspaceCanvasView'
import { renderWithCanvasStore } from '../../support/canvasStoreTestHarness'

vi.mock('@xyflow/react', () => {
  return {
    Background: () => null,
    Controls: () => null,
    useReactFlow: () => ({ fitView: vi.fn(), fitBounds: vi.fn() }),
    useStoreApi: () => ({
      setState: vi.fn(),
      getState: vi.fn(() => ({ transform: [0, 0, 1] })),
      subscribe: vi.fn(() => () => undefined),
    }),
    useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 1] }),
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

// Window signals subscribe to the PTY event hub, which this view test does not provide.
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
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
      WorkspaceSpaceActionMenu: ({ menu }: { menu: unknown }) =>
        menu ? <div className="workspace-context-menu" data-testid="space-action-menu" /> : null,
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
  pinned: true,
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
    activateSpaceTitle: () => undefined,
    selectedNodeCount: 0,
    isMinimapVisible: false,
    minimapNodeColor: () => '#000000',
    onMinimapVisibilityChange: () => undefined,
    spaces: [],
    activateSpace: () => undefined,
    activateAllSpaces: () => undefined,
    magneticSnappingEnabled: true,
    onToggleMagneticSnapping: () => undefined,
    createTerminalNode: async () => undefined,
    createNoteNodeFromContextMenu: () => undefined,
    arrangeAll: () => undefined,
    arrangeCanvas: () => undefined,
    arrangeInSpace: () => undefined,
    createTaskFromContextMenu: () => undefined,
    openAgentLauncher: () => undefined,
    createSpaceFromSelectedNodes: () => undefined,
    clearNodeSelection: () => undefined,
    canConvertSelectedNoteToTask: false,
    isConvertSelectedNoteToTaskDisabled: false,
    convertSelectedNoteToTask: () => undefined,
    taskTitleProviderLabel: '',
    taskTitleModelLabel: '',
    taskTagOptions: [],
    closeTaskEditor: () => undefined,
    generateTaskEditorTitle: async () => undefined,
    saveTaskEdits: async () => undefined,
    confirmNodeDelete: async () => undefined,
    agentSettings: DEFAULT_AGENT_SETTINGS,
    workspacePath: '/tmp',
    openSpaceActionMenu: () => undefined,
    copySpacePath: () => undefined,
    openSpacePath: () => undefined,
    spaceWorktreeOperations: [],
    worktreesRoot: '',
    openSpaceCreateWorktree: () => undefined,
    openSpaceArchive: () => undefined,
    closeSpaceWorktree: () => undefined,
    setSpaceWorktreeOperationPhase: () => undefined,
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
    const { commands, readUi } = renderWithCanvasStore(
      <WorkspaceCanvasView {...createBaseProps({ spaces: [switcherSpace] })} />,
    )
    act(() => {
      commands.openContextMenu({ kind: 'selection', x: 12, y: 12 })
    })

    await act(async () => {})

    const menuButton = screen.getByTestId('workspace-context-menu-button')
    fireEvent(menuButton, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(readUi().contextMenu).not.toBeNull()

    const dummyInput = screen.getByTestId('workspace-dummy-input')
    fireEvent(dummyInput, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(readUi().contextMenu).toBeNull()
  })

  it('leaves only the pane menu in the DOM after one act when it opens over the Space menu', async () => {
    const { commands } = renderWithCanvasStore(
      <WorkspaceCanvasView {...createBaseProps({ spaces: [switcherSpace] })} />,
    )
    act(() => {
      commands.openSpaceActionMenu({ spaceId: 'space-1', x: 20, y: 20 })
    })
    expect(screen.getByTestId('space-action-menu')).toBeInTheDocument()

    act(() => {
      commands.openContextMenu({ kind: 'pane', x: 30, y: 30, flowX: 30, flowY: 30 })
    })

    expect(screen.queryByTestId('space-action-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-context-menu-button')).toBeInTheDocument()
  })

  it('clears selection when a node is selected and user clicks an editable target', async () => {
    const clearNodeSelection = vi.fn()

    renderWithCanvasStore(
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

  it('registers a non-passive wheel capture listener when manual canvas wheel gestures are enabled', async () => {
    const addEventListenerSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener')

    renderWithCanvasStore(
      <WorkspaceCanvasView
        {...createBaseProps({
          useManualCanvasWheelGestures: true,
          handleCanvasWheelCapture: vi.fn(),
          spaces: [switcherSpace],
        })}
      />,
    )

    await act(async () => {})

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.objectContaining({ passive: false, capture: true }),
    )

    addEventListenerSpy.mockRestore()
  })
})
