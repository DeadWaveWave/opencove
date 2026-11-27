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

// The instance of the real `useReactFlow()` and the store API of the real `useStoreApi()` are
// stable: React Flow memoises the first on `viewportInitialized` only, and the second is the
// provider's own store. The mock returns one object each too. A new object per render would
// re-run every effect that depends on it, among them the trackpad gesture effect whose cleanup
// sets state, and render Inner a second time for a reason the app does not have (S7, PR 3: that
// was the second render of PR 2's review, section 6, and it was the mock's).
const reactFlowInstance = vi.hoisted(() => ({
  screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  setCenter: () => undefined,
  getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  setViewport: () => undefined,
}))

// A faithful enough React Flow store: `useStore` subscribes to it, so a change of
// `nodesSelectionActive` re-renders the component that selects it, as the real one does.
const reactFlowStoreApi = vi.hoisted(() => {
  const state: Record<string, unknown> = {
    nodes: [],
    transform: [0, 0, 1],
    userSelectionActive: false,
    nodesSelectionActive: false,
  }
  const listeners = new Set<(state: Record<string, unknown>) => void>()
  return {
    state,
    setState: (partial: Record<string, unknown>) => {
      Object.assign(state, partial)
      listeners.forEach(listener => listener(state))
    },
    getState: () => state,
    subscribe: (listener: (state: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const { useSyncExternalStore, useRef } = await import('react')

  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => reactFlowInstance,
    useStore: (selector: (state: unknown) => unknown) => {
      const cache = useRef<{ value: unknown } | null>(null)
      return useSyncExternalStore(reactFlowStoreApi.subscribe, () => {
        const next = selector(reactFlowStoreApi.state)
        // Equal by content keeps the same snapshot, as React Flow's shallow equality does.
        if (cache.current && JSON.stringify(cache.current.value) === JSON.stringify(next)) {
          return cache.current.value
        }
        cache.current = { value: next }
        return next
      })
    },
    useStoreApi: () => reactFlowStoreApi,
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
      reactFlowStoreApi.state.nodes = nodes
      return (
        <div>
          <button
            type="button"
            data-testid="select-a"
            onClick={() => onNodesChange?.([{ type: 'select', id: 'a', selected: true }])}
          />
          <button
            type="button"
            data-testid="deselect-a"
            onClick={() => onNodesChange?.([{ type: 'select', id: 'a', selected: false }])}
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

// A node selection change is one write to the canvas store and no write to the document (S7,
// PR 3): the change path publishes the selection and writes nothing when a batch only selects. So
// Inner and its hooks render once per select batch that changes the selection, and not at all for
// an equal one. Before S7 a select batch also wrote the document (the `selected` mirror) and Inner
// rendered twice; an equal batch rendered once for that write.
const RENDERS_PER_SELECT_BATCH = 1
const RENDERS_PER_EQUAL_SELECT_BATCH = 0

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

  // The selection store keeps an equal write as the same array and notifies nobody, and the
  // document is not written.
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

  // React Flow's `nodesSelectionActive` follows the selection (shown for a non-empty selection,
  // cleared for none). The subscription lives in a leaf, so its change renders the leaf and not the
  // canvas: the first selection and the clear to none cost the same one render as any other
  // select batch (S7, PR 3; before, Inner subscribed and rendered a second time).
  it('renders the canvas state hooks once for the first selection and for clearing to none', async () => {
    stubOpencoveApi()
    seedWorkspaceCanvasStore({ nodes: createRowNodes(['a', 'b']) })
    reactFlowStoreApi.setState({ nodesSelectionActive: false, userSelectionActive: false })
    render(<CanvasHarness />)
    await act(async () => {})

    let before = canvasStateCalls.count
    fireEvent.click(screen.getByTestId('select-a'))
    await act(async () => {})
    expect(reactFlowStoreApi.state.nodesSelectionActive).toBe(true)
    expect(canvasStateCalls.count - before).toBe(RENDERS_PER_SELECT_BATCH)

    before = canvasStateCalls.count
    fireEvent.click(screen.getByTestId('deselect-a'))
    await act(async () => {})
    expect(screen.getByTestId('selected-ids').textContent).toBe('')
    expect(reactFlowStoreApi.state.nodesSelectionActive).toBe(false)
    expect(canvasStateCalls.count - before).toBe(RENDERS_PER_SELECT_BATCH)
  })
})
