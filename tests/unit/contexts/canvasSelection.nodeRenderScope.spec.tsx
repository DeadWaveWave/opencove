import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
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

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  let currentNodes: Array<{ id: string; type: string; data: unknown }> = []

  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      setCenter: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(),
    }),
    useStore: (selector: (state: unknown) => unknown) =>
      selector({ nodes: currentNodes, transform: [0, 0, 1] }),
    useStoreApi: () => ({
      setState: vi.fn(),
      getState: vi.fn(() => ({ transform: [0, 0, 1] })),
      subscribe: vi.fn(() => () => undefined),
    }),
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    // The select changes of this spec go through the real reducer, as they do under React Flow.
    applyNodeChanges: actual.applyNodeChanges,
    ReactFlow: ({
      nodes,
      nodeTypes,
      onNodesChange,
      children,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown; selected?: boolean }>
      children?: React.ReactNode
      nodeTypes?: Record<string, React.ComponentType<{ id: string; data: unknown }>>
      onNodesChange?: (changes: unknown[]) => void
    }) => {
      currentNodes = nodes
      return (
        <div>
          <button
            type="button"
            data-testid="select-a"
            onClick={() => onNodesChange?.([{ type: 'select', id: 'a', selected: true }])}
          />
          <button
            type="button"
            data-testid="select-b"
            onClick={() => onNodesChange?.([{ type: 'select', id: 'b', selected: true }])}
          />
          <output data-testid="selected-ids">
            {nodes
              .filter(node => node.selected)
              .map(node => node.id)
              .join(',')}
          </output>
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
    BackgroundVariant: { Dots: 'dots' },
    SelectionMode: { Partial: 'partial' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    PanOnScrollMode: { Free: 'free' },
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
  }
})

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
)

function stubOpencoveApi(): void {
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
      workspace: { ensureDirectory: vi.fn(async () => undefined) },
      agent: { launch: vi.fn() },
      task: { suggestTitle: vi.fn() },
    },
  })
}

function CanvasHarness() {
  const nodes = useWorkspaceCanvasStoreNodes()
  return (
    <WorkspaceCanvas
      workspaceId="workspace-1"
      workspacePath="/tmp/repo"
      worktreesRoot=""
      nodes={nodes}
      spaces={[]}
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

// Decision 5 of #692: a node selection change renders what it rendered before the node ids moved
// into the canvas store: WorkspaceCanvasInner and its hooks once per select batch, no more.
// `RENDERS_PER_SELECT_BATCH` was measured on the base of the PR (6bb49379), before any production
// change: 2 for a select batch that changes the selection, and 2 for an equal one.
const RENDERS_PER_SELECT_BATCH = 2
// S6 (#738, PR 3): the equal batch still writes the document, and the canvas no longer copies the
// document's nodes into a state of its own in a layout effect, so that write renders it once.
const RENDERS_PER_EQUAL_SELECT_BATCH = 1

describe('WorkspaceCanvas node selection render scope', () => {
  it('renders the canvas state hooks the same number of times for one select change', async () => {
    stubOpencoveApi()
    seedWorkspaceCanvasStore({ nodes: createRowNodes(['a', 'b']) })
    render(<CanvasHarness />)
    await act(async () => {})
    expect(screen.getByTestId('selected-ids').textContent).toBe('')

    const before = canvasStateCalls.count
    fireEvent.click(screen.getByTestId('select-a'))
    await act(async () => {})

    expect(screen.getByTestId('selected-ids').textContent).toBe('a')
    expect(canvasStateCalls.count - before).toBe(RENDERS_PER_SELECT_BATCH)
  })

  // The node still reaches the document through the mirror commit, so an equal batch renders the
  // canvas for that write; the selection store itself notifies nobody.
  it('renders the canvas state hooks the same number of times for an equal select change', async () => {
    stubOpencoveApi()
    seedWorkspaceCanvasStore({ nodes: createRowNodes(['a', 'b']) })
    render(<CanvasHarness />)
    await act(async () => {})
    fireEvent.click(screen.getByTestId('select-a'))
    await act(async () => {})
    expect(screen.getByTestId('selected-ids').textContent).toBe('a')

    const before = canvasStateCalls.count
    fireEvent.click(screen.getByTestId('select-a'))
    await act(async () => {})

    expect(canvasStateCalls.count - before).toBe(RENDERS_PER_EQUAL_SELECT_BATCH)
  })
})
