import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import {
  readWorkspaceDocument,
  replaceWorkspaceNodes,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'

// The flow host (#738, PR 3): a node drag frame renders the host and what is below it, and the
// canvas component, `WorkspaceCanvasInner`, does not. React Flow is mocked so that the nodes it
// receives, and the handler it is given, can be read and driven.

const canvasStateCalls = vi.hoisted(() => ({ count: 0 }))
const flow = vi.hoisted(() => ({
  onNodesChange: null as null | ((changes: unknown[]) => void),
  // One entry per render of React Flow: the nodes it was given.
  renders: [] as Array<Array<{ id: string; x: number; y: number; title: string }>>,
}))

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
    // The position changes of a drag, applied as React Flow does.
    applyNodeChanges: (
      changes: Array<{ type: string; id: string; position?: { x: number; y: number } }>,
      nodes: Array<{ id: string; position: { x: number; y: number } }>,
    ) =>
      changes.reduce(
        (result, change) =>
          change.type === 'position' && change.position
            ? result.map(node =>
                node.id === change.id ? { ...node, position: change.position! } : node,
              )
            : result,
        [...nodes],
      ),
    ReactFlow: ({
      nodes,
      onNodesChange,
      children,
    }: {
      nodes: Array<{
        id: string
        position: { x: number; y: number }
        data: { title?: string }
      }>
      onNodesChange?: (changes: unknown[]) => void
      children?: React.ReactNode
    }) => {
      currentNodes = nodes as never
      flow.onNodesChange = onNodesChange ?? null
      flow.renders.push(
        nodes.map(node => ({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          title: node.data.title ?? '',
        })),
      )
      return <div>{children}</div>
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

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode', () => ({
  TerminalNode: () => null,
}))
vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TaskNode', () => ({
  TaskNode: () => null,
}))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
)

const WORKSPACE_ID = 'workspace-1'

function CanvasHarness() {
  const nodes = useWorkspaceCanvasStoreNodes()
  return (
    <WorkspaceCanvas
      workspaceId={WORKSPACE_ID}
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

afterEach(() => {
  vi.restoreAllMocks()
  flow.renders.length = 0
  flow.onNodesChange = null
})

async function mountCanvas() {
  stubOpencoveApi()
  seedWorkspaceCanvasStore({ nodes: createRowNodes(['a', 'b']) })
  const frames: Array<() => void> = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(() => callback(0))
    return frames.length
  })
  render(<CanvasHarness />)
  await act(async () => {})
  const runFrames = () =>
    act(async () => {
      frames.splice(0).forEach(frame => frame())
    })
  const send = (changes: unknown[]) =>
    act(async () => {
      flow.onNodesChange?.(changes)
    })
  /** One frame of a drag of `a` to `y`, flushed. */
  const dragTo = async (y: number) => {
    await send([{ type: 'position', id: 'a', position: { x: 0, y }, dragging: true }])
    await runFrames()
  }
  /**
   * React Flow delivers the release from a native `mouseup` listener. A browser gives the update
   * the priority of `window.event`; happy-dom has none, so the call sets it as the browser would.
   */
  const release = async (y: number) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'event')
    Object.defineProperty(window, 'event', {
      configurable: true,
      value: new MouseEvent('mouseup'),
    })
    try {
      await act(async () => {
        flow.onNodesChange?.([
          { type: 'position', id: 'a', position: { x: 0, y }, dragging: false },
        ])
      })
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'event', descriptor)
      } else {
        delete (window as { event?: unknown }).event
      }
    }
  }
  const lastY = (id: string) => flow.renders.at(-1)?.find(node => node.id === id)?.y
  return { dragTo, release, send, runFrames, lastY }
}

describe('a node drag in the mounted canvas', () => {
  it('renders the flow host and not WorkspaceCanvasInner for each frame', async () => {
    const { dragTo, lastY } = await mountCanvas()

    await dragTo(10)
    const rendersAfterFirstFrame = canvasStateCalls.count
    expect(lastY('a')).toBe(10)

    for (let step = 2; step <= 10; step += 1) {
      await dragTo(step * 10)
      expect(lastY('a')).toBe(step * 10)
    }

    expect(canvasStateCalls.count).toBe(rendersAfterFirstFrame)
  })

  it('renders WorkspaceCanvasInner once for a write from elsewhere', async () => {
    await mountCanvas()
    const before = canvasStateCalls.count
    const nodes = readWorkspaceDocument(WORKSPACE_ID)!.nodes

    await act(async () => {
      replaceWorkspaceNodes(
        WORKSPACE_ID,
        nodes.map(node =>
          node.id === 'b' ? { ...node, data: { ...node.data, title: 'from elsewhere' } } : node,
        ),
      )
    })

    expect(canvasStateCalls.count - before).toBe(1)
    expect(flow.renders.at(-1)?.find(node => node.id === 'b')?.title).toBe('from elsewhere')
  })

  it('shows a write from elsewhere during a drag, and renders WorkspaceCanvasInner once for it', async () => {
    const { dragTo, lastY } = await mountCanvas()
    await dragTo(30)
    const before = canvasStateCalls.count
    const nodes = readWorkspaceDocument(WORKSPACE_ID)!.nodes

    await act(async () => {
      replaceWorkspaceNodes(
        WORKSPACE_ID,
        nodes.map(node =>
          node.id === 'b' ? { ...node, data: { ...node.data, title: 'from elsewhere' } } : node,
        ),
      )
    })

    expect(canvasStateCalls.count - before).toBe(1)
    expect(flow.renders.at(-1)?.find(node => node.id === 'b')?.title).toBe('from elsewhere')
    expect(lastY('a')).toBe(30)
  })

  // The release must not show the window before the drag, nor a position between the last frame
  // and the release: the document write and the overlay clear are one render.
  it('shows no snap-back frame from the first live frame through the release', async () => {
    const { dragTo, release } = await mountCanvas()
    const yOfA = () =>
      flow.renders.map(nodes => nodes.find(node => node.id === 'a')?.y ?? Number.NaN)

    await dragTo(30)
    const firstLiveRender = flow.renders.length - 1
    await dragTo(101)
    expect(
      yOfA()
        .slice(firstLiveRender)
        .every(y => y !== 0),
    ).toBe(true)

    const beforeRelease = flow.renders.length
    await release(101)

    // The release snaps to the grid, so its position is not the last frame's: a render between
    // the two would show 101.
    const releasedY = readWorkspaceDocument(WORKSPACE_ID)!.nodes.find(node => node.id === 'a')!
      .position.y
    expect(releasedY).not.toBe(101)
    expect(releasedY).not.toBe(0)
    expect(new Set(yOfA().slice(firstLiveRender))).toEqual(new Set([30, 101, releasedY]))
    expect(new Set(yOfA().slice(beforeRelease))).toEqual(new Set([releasedY]))
  })
})
