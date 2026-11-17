import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'

const canvasStateCalls = vi.hoisted(() => ({ count: 0 }))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState')
      >()
    return {
      ...actual,
      useWorkspaceCanvasState: (...args: Parameters<typeof actual.useWorkspaceCanvasState>) => {
        canvasStateCalls.count += 1
        return actual.useWorkspaceCanvasState(...args)
      },
    }
  },
)

vi.mock('@xyflow/react', () => {
  let currentNodes: Array<{ id: string; type: string; data: unknown }> = []

  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      setCenter: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(),
      getNodes: () => currentNodes,
    }),
    useStore: (selector: (state: unknown) => unknown) =>
      selector({ nodes: currentNodes, transform: [0, 0, 1] }),
    useStoreApi: () => ({
      setState: vi.fn(),
      getState: vi.fn(() => ({ transform: [0, 0, 1] })),
      subscribe: vi.fn(() => () => undefined),
    }),
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
    ReactFlow: ({
      nodes,
      nodeTypes,
      onPaneContextMenu,
      children,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>
      children?: React.ReactNode
      nodeTypes?: Record<string, React.ComponentType<{ id: string; data: unknown }>>
      onPaneContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
    }) => {
      currentNodes = nodes
      return (
        <div>
          <div
            data-testid="react-flow-pane"
            className="react-flow__pane"
            onContextMenu={event => {
              onPaneContextMenu?.(event)
            }}
          />
          {nodes.map(node => {
            const Renderer = nodeTypes?.[node.type]
            if (!Renderer) {
              return null
            }
            return <Renderer key={node.id} id={node.id} data={node.data} />
          })}
          {children}
        </div>
      )
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    BackgroundVariant: {
      Dots: 'dots',
    },
    SelectionMode: {
      Partial: 'partial',
    },
    MarkerType: {
      ArrowClosed: 'arrowclosed',
    },
    PanOnScrollMode: {
      Free: 'free',
    },
    Handle: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
  }
})

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode', () => {
  return {
    TerminalNode: () => null,
  }
})

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
)

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => {
  return {
    TaskNode: () => null,
  }
})

function stubOpencoveApi(extraWorkspace: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        spawn: vi.fn(),
        kill: vi.fn(async () => undefined),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        onState: vi.fn(() => () => undefined),
        onMetadata: vi.fn(() => () => undefined),
      },
      workspace: { ensureDirectory: vi.fn(async () => undefined), ...extraWorkspace },
      agent: { launch: vi.fn() },
      task: { suggestTitle: vi.fn() },
    },
  })
}

const SPACE: WorkspaceSpaceState = {
  id: 'space-1',
  name: 'Space 1',
  directoryPath: '/tmp/repo',
  targetMountId: null,
  labelColor: null,
  nodeIds: [],
  rect: { x: 0, y: 0, width: 600, height: 400 },
}

function CanvasHarness({
  spaces = [],
  workspaceId = 'workspace-1',
}: {
  spaces?: WorkspaceSpaceState[]
  workspaceId?: string
}) {
  const nodes = useWorkspaceCanvasStoreNodes()
  return (
    <WorkspaceCanvas
      workspaceId={workspaceId}
      workspacePath="/tmp/repo"
      worktreesRoot=""
      nodes={nodes}
      spaces={spaces}
      activeSpaceId={null}
      onActiveSpaceChange={() => undefined}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      isMinimapVisible={false}
      onViewportChange={() => undefined}
      onMinimapVisibilityChange={() => undefined}
      agentSettings={DEFAULT_AGENT_SETTINGS}
    />
  )
}

describe('WorkspaceCanvas menu render scope', () => {
  it('shows the pane menu without re-rendering WorkspaceCanvasInner', async () => {
    stubOpencoveApi()
    seedWorkspaceCanvasStore()

    render(<CanvasHarness />)
    await act(async () => {})
    expect(document.querySelector('.workspace-canvas-context-menu')).toBeNull()

    const rendersBeforeOpen = canvasStateCalls.count
    expect(rendersBeforeOpen).toBeGreaterThan(0)

    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), { clientX: 320, clientY: 220 })
    await act(async () => {})

    expect(document.querySelector('.workspace-canvas-context-menu')).not.toBeNull()
    expect(canvasStateCalls.count).toBe(rendersBeforeOpen)
  })

  it.each(['with path openers', 'without path openers'])(
    'shows the Space action menu %s without re-rendering WorkspaceCanvasInner',
    async variant => {
      const listPathOpeners = vi.fn(async () => ({
        openers: [{ id: 'finder', label: 'Finder' }],
      }))
      stubOpencoveApi(variant === 'with path openers' ? { listPathOpeners } : {})
      seedWorkspaceCanvasStore({ spaces: [SPACE] })

      render(<CanvasHarness spaces={[SPACE]} />)
      await act(async () => {})
      expect(screen.queryByTestId('workspace-space-action-menu')).toBeNull()

      const rendersBeforeOpen = canvasStateCalls.count
      fireEvent.click(screen.getByTestId('workspace-space-menu-space-1'))
      await act(async () => {})

      expect(screen.queryByTestId('workspace-space-action-menu')).not.toBeNull()
      expect(canvasStateCalls.count).toBe(rendersBeforeOpen)
    },
  )

  it('closes the pane menu in the first render under a new workspace id', async () => {
    stubOpencoveApi()
    seedWorkspaceCanvasStore()
    const renders: boolean[] = []
    const { rerender } = render(<CanvasHarness />)
    await act(async () => {})
    fireEvent.contextMenu(screen.getByTestId('react-flow-pane'), { clientX: 10, clientY: 10 })
    await act(async () => {})
    expect(document.querySelector('.workspace-canvas-context-menu')).not.toBeNull()

    const observer = new MutationObserver(() => {
      renders.push(document.querySelector('.workspace-canvas-context-menu') !== null)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    rerender(<CanvasHarness workspaceId="workspace-2" />)
    observer.disconnect()

    // Synchronous commit of the rerender: the menu is already gone, never shown under the new id.
    expect(document.querySelector('.workspace-canvas-context-menu')).toBeNull()
    expect(renders.every(visible => !visible)).toBe(true)
  })
})

describe('WorkspaceCanvas marquee render scope', () => {
  it('draws, moves and clears the marquee rectangle without re-rendering WorkspaceCanvasInner', async () => {
    stubOpencoveApi()
    seedWorkspaceCanvasStore()
    const frames: Array<() => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(() => callback(0))
      return frames.length
    })
    const runFrames = async () => {
      await act(async () => {
        frames.splice(0).forEach(frame => frame())
      })
    }
    const marquee = () => document.querySelector('.workspace-selection-draft') as HTMLElement | null
    try {
      render(<CanvasHarness />)
      await act(async () => {})
      expect(marquee()).toBeNull()
      const rendersBefore = canvasStateCalls.count
      const pane = screen.getByTestId('react-flow-pane')

      fireEvent.pointerDown(pane, { button: 0, shiftKey: true, clientX: 10, clientY: 20 })
      await runFrames()
      expect(marquee()?.getAttribute('data-selection-phase')).toBe('active')

      fireEvent.pointerMove(pane, { buttons: 1, clientX: 60, clientY: 90 })
      await runFrames()
      expect(marquee()?.style.width).toBe('50px')
      expect(marquee()?.style.height).toBe('70px')

      fireEvent.pointerUp(window, { clientX: 60, clientY: 90 })
      await runFrames()
      expect(marquee()).toBeNull()
      expect(canvasStateCalls.count).toBe(rendersBefore)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
