import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'

// #738, PR 6: a frame of a Space drag renders the flow host and what is below it, and
// `WorkspaceCanvasInner` does not (a node drag's frame, PR 3, already behaves so). The canvas view
// is mocked, so that what the host hands it can be read, and so is React Flow.

const canvasStateCalls = vi.hoisted(() => ({ count: 0 }))
const view = vi.hoisted(() => ({
  // One entry per render of the canvas view: what the host handed it.
  renders: [] as Array<{
    nodes: Array<{ id: string; x: number }>
    preview: Array<[string, number]> | null
  }>,
  press: null as null | ((event: unknown, spaceId: string) => void),
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

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/TerminalDisplayAlignedWorkspaceCanvasView',
  () => ({
    TerminalDisplayAlignedWorkspaceCanvasView: (props: {
      nodes: Array<{ id: string; position: { x: number } }>
      spaceFramePreview: ReadonlyMap<string, { x: number }> | null
      handleSpaceDragHandlePointerDown: (event: unknown, spaceId: string) => void
    }) => {
      view.press = props.handleSpaceDragHandlePointerDown
      view.renders.push({
        nodes: props.nodes.map(node => ({ id: node.id, x: node.position.x })),
        preview: props.spaceFramePreview
          ? [...props.spaceFramePreview].map(([id, rect]) => [id, rect.x] as [string, number])
          : null,
      })
      return null
    },
  }),
)

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    setCenter: vi.fn(),
    getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    getZoom: vi.fn(() => 1),
    setViewport: vi.fn(),
    getNodes: () => [],
  }),
  useStore: (selector: (state: unknown) => unknown) =>
    selector({ nodes: [], transform: [0, 0, 1] }),
  useStoreApi: () => ({
    setState: vi.fn(),
    getState: vi.fn(() => ({ transform: [0, 0, 1] })),
    subscribe: vi.fn(() => () => undefined),
  }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  applyNodeChanges: (_changes: unknown[], nodes: unknown[]) => nodes,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
}))

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
const NO_SPACES: WorkspaceSpaceState[] = []

function CanvasHarness() {
  const nodes = useWorkspaceCanvasStoreNodes()
  const spaces = useAppStore(
    state => state.workspaces.find(workspace => workspace.id === WORKSPACE_ID)?.spaces ?? NO_SPACES,
  )
  return (
    <WorkspaceCanvas
      workspaceId={WORKSPACE_ID}
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
      onAppendSpaceArchiveRecord={() => undefined}
      onChangePreserveWindowSizesOnArrange={() => undefined}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  view.renders.length = 0
  view.press = null
})

const SPACE_ID = 'space-a'
const START = { x: 100, y: 50 }

async function mountCanvas() {
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
  seedWorkspaceCanvasStore({
    // `b` is far from the Space, so the drag neither carries nor pushes it.
    nodes: createRowNodes(['a', 'b']).map(node =>
      node.id === 'b' ? { ...node, position: { x: 1600, y: 0 } } : node,
    ),
    spaces: [createSpace(SPACE_ID, { x: -50, y: -50, width: 400, height: 300 }, ['a'])],
  })
  const frames: Array<() => void> = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(() => callback(0))
    return frames.length
  })
  render(<CanvasHarness />)
  await act(async () => {})

  const press = () =>
    act(() =>
      view.press?.(
        {
          button: 0,
          shiftKey: false,
          clientX: START.x,
          clientY: START.y,
          pointerId: 3,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
        SPACE_ID,
      ),
    )
  /** One frame of the drag, `dx` to the right of the pointer-down point, flushed. */
  const frame = (dx: number) =>
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 3,
          clientX: START.x + dx,
          clientY: START.y,
          buttons: 1,
        }),
      )
      frames.splice(0).forEach(run => run())
    })
  const release = (dx: number) =>
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 3, clientX: START.x + dx, clientY: START.y }),
      )
    })
  const shown = (id: string) => view.renders.at(-1)?.nodes.find(node => node.id === id)?.x
  return { press, frame, release, shown }
}

describe('a Space drag in the mounted canvas', () => {
  it('renders the flow host and not WorkspaceCanvasInner for each frame', async () => {
    const { press, frame, shown } = await mountCanvas()
    await press()

    await frame(10)
    const rendersAfterFirstFrame = canvasStateCalls.count
    expect(shown('a')).toBe(10)

    for (let step = 2; step <= 10; step += 1) {
      await frame(step * 10)
      expect(shown('a')).toBe(step * 10)
    }

    expect(canvasStateCalls.count).toBe(rendersAfterFirstFrame)
  })

  it('does not render WorkspaceCanvasInner for the pointer down either, and shows the preview', async () => {
    const { press } = await mountCanvas()
    const before = canvasStateCalls.count

    await press()

    expect(canvasStateCalls.count).toBe(before)
    expect(view.renders.at(-1)?.preview).toEqual([[SPACE_ID, -50]])
  })

  it('hands the view the moved window and the preview of each frame, and writes the document only at the release', async () => {
    const { press, frame, release, shown } = await mountCanvas()
    await press()

    await frame(40)
    await frame(80)

    expect(view.renders.at(-1)?.preview).toEqual([[SPACE_ID, 30]])
    expect(shown('a')).toBe(80)
    expect(shown('b')).toBe(1600)
    expect(readWorkspaceDocument(WORKSPACE_ID)?.nodes.map(node => node.position.x)).toEqual([
      0, 1600,
    ])
    expect(readWorkspaceDocument(WORKSPACE_ID)?.spaces[0].rect?.x).toBe(-50)

    await release(80)

    expect(readWorkspaceDocument(WORKSPACE_ID)?.nodes.map(node => node.position.x)).toEqual([
      80, 1600,
    ])
    expect(readWorkspaceDocument(WORKSPACE_ID)?.spaces[0].rect?.x).toBe(30)
    expect(shown('a')).toBe(80)
    expect(view.renders.at(-1)?.preview).toBeNull()
  })

  // The write and the clear of the overlay and the preview are one batch: no render between the
  // frame's last state and the released one shows the nodes before the drag or a preview without
  // the moved Space.
  it('shows no snap-back render from the first frame through the release', async () => {
    const { press, frame, release } = await mountCanvas()
    await press()
    await frame(40)
    const firstLive = view.renders.length - 1
    await frame(80)

    await release(80)

    const xOfA = view.renders.slice(firstLive).map(shownAt => shownAt.nodes[0].x)
    expect(xOfA.every(x => x !== 0)).toBe(true)
    expect(
      view.renders
        .slice(firstLive)
        .every(shownAt => shownAt.preview !== null || shownAt === view.renders.at(-1)),
    ).toBe(true)
  })
})
