import { act } from '@testing-library/react'
import { getViewportForBounds, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveArrangeWrapWidth,
  useWorkspaceCanvasArrange,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useArrange'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useCanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const reactFlow = {
  setViewport: vi.fn(),
  fitView: vi.fn(),
} as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>

const onShowMessage = vi.fn()

function useArrangeUnderTest({ nodeStore }: CanvasNodeStoreContext) {
  return {
    selection: useCanvasSelectionCommands(),
    arrange: useWorkspaceCanvasArrange({
      reactFlow,
      focusNodeTargetZoom: 1,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
      onShowMessage,
      standardWindowSizeBucket: 'regular',
    }),
  }
}

// The nodes carry the initial size that the node store would otherwise add with its first write,
// so that a layout that changes nothing is a write of nothing.
function sized(nodes: Node<TerminalNodeData>[]): Node<TerminalNodeData>[] {
  return nodes.map(node => ({
    ...node,
    initialWidth: node.data.width,
    initialHeight: node.data.height,
  }))
}

const scattered = (ids: string[]) =>
  sized(
    createRowNodes(ids).map((node, index) => ({
      ...node,
      position: { x: index * 37, y: index * 11 },
    })),
  )

const nextFrame = () =>
  act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
  })

const layoutSyncs = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
  return () => window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
})

describe('workspace canvas arrange hook', () => {
  it('derives wrap width from aspect ratio instead of absolute viewport size', () => {
    expect(resolveArrangeWrapWidth({ width: 1440, height: 900 })).toBe(
      resolveArrangeWrapWidth({ width: 2880, height: 1800 }),
    )
    expect(resolveArrangeWrapWidth({ width: 1600, height: 1000 })).toBe(
      resolveArrangeWrapWidth({ width: 800, height: 500 }),
    )
  })

  it('uses narrower wrap hints for narrower aspect ratios', () => {
    const widescreen = resolveArrangeWrapWidth({ width: 1600, height: 900 })
    const standard = resolveArrangeWrapWidth({ width: 1200, height: 900 })

    expect(widescreen).toBeGreaterThan(standard)
  })

  // The Spaces a layout returns are the ones it was given: arranging nodes alone must write
  // nodes and no Spaces, however the store re-sanitizes the Spaces after the nodes are written.
  it('writes no Spaces when arranging leaves them as they were', () => {
    const nodes = createRowNodes(['a', 'b', 'c']).map((node, index) => ({
      ...node,
      position: { x: index * 37, y: index * 11 },
    }))
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [],
    })
    const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
    const spacesBefore = harness.readStoreDocument().spaces
    harness.notifications.mockClear()

    act(() => view.result.current.arrange.arrangeCanvas())

    expect(harness.readStoreDocument().nodes).not.toEqual(nodes)
    // The node write stores equal Spaces again, so the array is a new one: what counts is that
    // nothing wrote them afterwards.
    expect(harness.readStoreDocument().spaces).toEqual(spacesBefore)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('stores the Spaces the layout moved', () => {
    const nodes = createRowNodes(['a', 'b']).map(node => ({ ...node, position: { x: 13, y: 7 } }))
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [createSpace('far', { x: 9000, y: 9000, width: 400, height: 300 })],
    })
    const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })

    act(() => view.result.current.arrange.arrangeCanvas())

    expect(harness.readStoreDocument().spaces[0].rect).not.toEqual({
      x: 9000,
      y: 9000,
      width: 400,
      height: 300,
    })
  })

  // `arrangeInSpace` focuses the Space in the next frame, by a read of the Spaces it just stored.
  it('focuses the arranged Space from the stored rect in the next frame', async () => {
    const nodes = createRowNodes(['a', 'b', 'c']).map((node, index) => ({
      ...node,
      position: { x: index * 37, y: index * 11 },
    }))
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [createSpace('room', { x: -50, y: -50, width: 2400, height: 1600 }, ['a', 'b', 'c'])],
    })
    const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
    vi.mocked(reactFlow.setViewport).mockClear()

    act(() => view.result.current.arrange.arrangeInSpace('room'))
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    })

    const stored = harness.readStoreDocument().spaces[0].rect!
    expect(stored.width).toBeLessThan(2400)
    expect(reactFlow.setViewport).toHaveBeenCalledTimes(1)
    const [viewport] = vi.mocked(reactFlow.setViewport).mock.calls[0]
    expect(viewport).toEqual(getViewportForBounds(stored, 1440, 900, 0.5, 1, 0.16))
  })

  // The arrange of the whole canvas and of a Space is one store write of the nodes and the Spaces
  // together, one flush after it, and no terminal layout sync (#702, PR 9).
  describe('as one store write', () => {
    const room = (nodeIds: string[]) =>
      createSpace('room', { x: -50, y: -50, width: 2400, height: 1600 }, nodeIds)

    it('writes the nodes and the Spaces of arrange all in one notification and flushes once', () => {
      const nodes = scattered(['a', 'b', 'c', 'root'])
      const harness = createCanvasDocumentHarness({ nodes, spaces: [room(['a', 'b', 'c'])] })
      const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
      const before = harness.readStoreDocument()
      harness.notifications.mockClear()
      let storedAtFlush: ReturnType<typeof harness.readStoreDocument> | null = null
      harness.flush.mockImplementation(() => {
        storedAtFlush = harness.readStoreDocument()
      })

      act(() => view.result.current.arrange.arrangeAll())

      const after = harness.readStoreDocument()
      // The flush follows the write.
      expect(storedAtFlush!.nodes).toBe(after.nodes)
      expect(storedAtFlush!.spaces).toBe(after.spaces)
      expect(after.nodes.map(node => node.position)).not.toEqual(
        before.nodes.map(node => node.position),
      )
      expect(after.spaces[0].rect).not.toEqual(before.spaces[0].rect)
      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(layoutSyncs).not.toHaveBeenCalled()
    })

    it('writes nothing, flushes nothing and focuses nothing on a canvas that is arranged', async () => {
      const harness = createCanvasDocumentHarness({
        nodes: scattered(['a', 'b', 'c']),
        spaces: [room(['a', 'b', 'c'])],
      })
      const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
      act(() => view.result.current.arrange.arrangeAll())
      await nextFrame()
      const arranged = harness.readStoreDocument()
      harness.notifications.mockClear()
      harness.flush.mockClear()
      vi.mocked(reactFlow.fitView).mockClear()
      vi.mocked(reactFlow.setViewport).mockClear()

      act(() => {
        view.result.current.arrange.arrangeAll()
        view.result.current.arrange.arrangeCanvas()
        view.result.current.arrange.arrangeInSpace('room')
      })
      await nextFrame()

      expect(harness.readStoreDocument()).toEqual(arranged)
      expect(harness.notifications).not.toHaveBeenCalled()
      expect(harness.flush).not.toHaveBeenCalled()
      expect(reactFlow.fitView).not.toHaveBeenCalled()
      expect(reactFlow.setViewport).not.toHaveBeenCalled()
      // The Space has room, so no arrange warns: the warnings are read from the recorded layout.
      expect(onShowMessage).not.toHaveBeenCalled()
    })

    it('arranges a node that another writer added to the store in the same call', () => {
      const harness = createCanvasDocumentHarness({ nodes: scattered(['a', 'b']) })
      const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
      const added = sized(createRowNodes(['late'])).map(node => ({
        ...node,
        position: { x: 0, y: 0 },
      }))[0]
      harness.notifications.mockClear()

      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [...harness.readStoreDocument().nodes, added])
        view.result.current.arrange.arrangeCanvas()
      })

      const stored = harness.readStoreDocument().nodes
      expect(stored.map(node => node.id)).toEqual(['a', 'b', 'late'])
      expect(stored[2].position).not.toEqual({ x: 0, y: 0 })
      // The replace, and then the arrange.
      expect(harness.notifications).toHaveBeenCalledTimes(2)
    })

    // `selected` exists only in the canvas view. The layout is planned from the nodes of the
    // write, which carry it, so it survives into the store.
    it('keeps the canvas selection flag of a node whose stored flag differs', () => {
      const harness = createCanvasDocumentHarness({ nodes: scattered(['a', 'b']) })
      const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
      act(() => view.result.current.selection.setNodeIds(['b']))
      expect(harness.readStoreDocument().nodes[1].selected).toBeFalsy()
      expect(view.result.current.nodeStore.nodesRef.current[1].selected).toBe(true)

      act(() => view.result.current.arrange.arrangeCanvas())

      const [a, b] = harness.readStoreDocument().nodes
      expect(b.position).not.toEqual({ x: 37, y: 11 })
      expect(b.selected).toBe(true)
      expect(a.selected).toBeFalsy()
    })

    it('writes nothing, flushes nothing and warns when a Space has no room', async () => {
      const harness = createCanvasDocumentHarness({
        nodes: scattered(['a', 'b']),
        spaces: [createSpace('tight', { x: 0, y: 0, width: 350, height: 150 }, ['a', 'b'])],
      })
      const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
      const before = harness.readStoreDocument()
      harness.notifications.mockClear()

      act(() =>
        view.result.current.arrange.arrangeInSpace('tight', {
          alignCanonicalSizes: false,
          spaceFit: 'keep',
        }),
      )
      await nextFrame()

      expect(onShowMessage).toHaveBeenCalledExactlyOnceWith(
        'messages.arrangeSpaceNoRoom',
        'warning',
      )
      expect(harness.readStoreDocument()).toEqual(before)
      expect(harness.notifications).not.toHaveBeenCalled()
      expect(harness.flush).not.toHaveBeenCalled()
      expect(reactFlow.setViewport).not.toHaveBeenCalled()
    })
  })
})
