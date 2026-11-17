import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import {
  INSIDE_A,
  SPACE_A_RECT,
  dragTo,
  nodeAt,
  press,
  release,
  renderDrag,
  renderSwitchingSpaceDrag,
  spaceA,
  spaceC,
} from '../../support/spaceDragHarness'
import { replaceSpacesInStore } from '../../support/workspaceCanvasStoreHarness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  useCanvasCollapseStore.setState({ workspaces: {} })
})

const SPACE_C_RECT = { x: 700, y: 0, width: 500, height: 400 }

describe('useWorkspaceCanvasSpaceDrag reads the committed document', () => {
  describe('at pointer down', () => {
    it('starts a drag on a Space that a write added in the same act', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)

      act(() => {
        replaceSpacesInStore(harness.workspaceId, [...harness.readStoreDocument().spaces, spaceC()])
      })
      press(view, 'space-c', { x: 900, y: 200 })

      expect(view.result.current.readInteraction().spaceDragFramePreview?.get('space-c')).toEqual(
        SPACE_C_RECT,
      )
    })

    it('carries a node that a write added to the Space in the same act', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)

      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [nodeAt('n1', 50, 60), nodeAt('n2', 300, 150)])
        replaceSpacesInStore(harness.workspaceId, [spaceA(['n1', 'n2'])])
      })
      press(view, 'space-a', INSIDE_A)
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const positions = harness.readStoreDocument().nodes.map(node => [node.id, node.position.x])
      expect(positions).toEqual([
        ['n1', 150],
        ['n2', 400],
      ])
    })

    it('measures a resize against the nodes the store holds', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      const node = createRowNodes(['n1'])[0]

      // The node ends at x = 450 + width: a resize of the right edge cannot go below it.
      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [nodeAt('n1', 450, 60)])
      })
      press(view, 'space-a', { x: 599, y: 200 })
      release({ x: 100, y: 200 })

      const rect = harness.readStoreDocument().spaces[0].rect
      expect(rect?.width).toBeGreaterThanOrEqual(450 + (node.data.width ?? 0))
    })
  })

  describe('per frame', () => {
    // On the base a frame wrote the nodes to the store (one notification, the sidebar and the
    // persistence debounce with it). It now publishes them to the overlay and writes nothing
    // (#738, Decision 9); `canvasInteraction.spaceDrag.spec` pins the frames in full.
    it('publishes the nodes to the overlay, writes no Spaces and nothing at all, and does not flush', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA(), spaceC()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)
      const spacesBefore = harness.readStoreDocument().spaces
      harness.notifications.mockClear()

      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

      const document = harness.readStoreDocument()
      const interaction = view.result.current.readInteraction()
      expect(interaction.liveNodes?.get('n1')?.position).toEqual({ x: 90, y: 60 })
      expect(document.nodes[0].position).toEqual({ x: 50, y: 60 })
      expect(document.spaces).toEqual(spacesBefore)
      expect(harness.notifications).not.toHaveBeenCalled()
      expect(harness.flush).not.toHaveBeenCalled()
      expect(interaction.spaceDragFramePreview?.get('space-a')).toMatchObject({ x: 40 })
    })

    it('projects from the Spaces the store holds when the frame runs', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      act(() => {
        replaceSpacesInStore(harness.workspaceId, [...harness.readStoreDocument().spaces, spaceC()])
      })
      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

      expect(
        [...(view.result.current.readInteraction().spaceDragFramePreview?.keys() ?? [])].sort(),
      ).toEqual(['space-a', 'space-c'])
    })

    it('projects from the nodes the store holds when the frame runs', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      // A node the store gained since pointer down, in the way of the moved Space: the frame
      // pushes it clear before release, which only the nodes read at the frame know.
      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [
          ...harness.readStoreDocument().nodes,
          nodeAt('n-late', 650, 100),
        ])
      })
      dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      // The frame's result is in the overlay; the document holds the nodes until the release.
      const { liveNodes } = view.result.current.readInteraction()
      expect([...(liveNodes ?? [])].map(([id, entry]) => [id, entry.position.x])).toEqual([
        ['n1', 150],
        ['n-late', 700],
      ])
      expect(harness.readStoreDocument().nodes.map(node => node.position.x)).toEqual([50, 650])
    })

    it('moves the nodes the store holds, not the ones React Flow holds', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

      expect(view.result.current.readInteraction().liveNodes?.get('n1')?.position.x).toBe(90)
    })
  })

  describe('at pointer up', () => {
    it('writes nodes and Spaces in one store update and flushes once', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)
      harness.notifications.mockClear()
      harness.flush.mockClear()

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const document = harness.readStoreDocument()
      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(document.spaces[0].rect).toMatchObject({ x: 100, y: 0 })
      expect(document.nodes[0].position).toEqual({ x: 150, y: 60 })
      expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()
    })

    it('writes the Spaces once, and flushes once, after frames that published the nodes', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)
      dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
      harness.notifications.mockClear()
      harness.flush.mockClear()

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 100, y: 0 })
      expect(harness.readStoreDocument().nodes[0].position).toEqual({ x: 150, y: 60 })
    })

    it('does not ask the terminals to sync their layout, for a frame or for the release', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      const onLayoutSync = vi.fn()
      window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, onLayoutSync)
      try {
        press(view, 'space-a', INSIDE_A)
        dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
        release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
      } finally {
        window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, onLayoutSync)
      }

      expect(harness.readStoreDocument().nodes[0].position.x).toBe(150)
      expect(onLayoutSync).not.toHaveBeenCalled()
    })

    it('snaps against a Space that a write added since the pointer went down', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness, { magneticSnapping: true })
      press(view, 'space-a', INSIDE_A)

      act(() => {
        replaceSpacesInStore(harness.workspaceId, [
          ...harness.readStoreDocument().spaces,
          // Its left edge is 4 flow units from A's left edge after A moves 100 to the right.
          createSpace('space-snap', { x: 104, y: 500, width: 400, height: 400 }, []),
        ])
      })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      // Without the late Space the Space would stop at x = 100; snapping pulls its left edge to 104 (the grid alone would give 96).
      expect(harness.readStoreDocument().spaces[0].rect?.x).toBe(104)
    })

    // The guides of a Space drag live in the canvas store; the drag ends them, with the release and
    // with a click that never moved.
    it('ends the snap guides with the release', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [
          spaceA(),
          createSpace('space-snap', { x: 104, y: 500, width: 400, height: 400 }, []),
        ],
      })
      const view = renderDrag(harness, { magneticSnapping: true })
      press(view, 'space-a', INSIDE_A)
      dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
      expect(view.result.current.readInteraction().snapGuides).not.toBeNull()

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(view.result.current.readInteraction().snapGuides).toBeNull()
    })

    it('ends the snap guides with a click that did not move', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness, { magneticSnapping: true })
      press(view, 'space-a', INSIDE_A)
      act(() => view.result.current.interaction.setSnapGuides([{ kind: 'v', x: 1, y1: 0, y2: 10 }]))
      expect(view.result.current.readInteraction().snapGuides).not.toBeNull()

      release(INSIDE_A)

      expect(view.result.current.readInteraction().snapGuides).toBeNull()
    })

    // The toggle is read when a frame runs: the hook does not subscribe to it, so a copy taken at
    // render would be a stale one after the menu flips it.
    it.each([
      { before: false, expectedX: 104, name: 'turned on' },
      { before: true, expectedX: 100, name: 'turned off' },
    ])('uses the snapping toggle $name after the pointer went down', ({ before, expectedX }) => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [
          spaceA(),
          createSpace('space-snap', { x: 104, y: 500, width: 400, height: 400 }, []),
        ],
      })
      const view = renderDrag(harness, { magneticSnapping: before })
      press(view, 'space-a', INSIDE_A)

      act(() => view.result.current.interaction.toggleMagneticSnapping())
      dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.readStoreDocument().spaces[0].rect?.x).toBe(expectedX)
    })

    it('finalizes from the Spaces the store holds, not the ones read at pointer down', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      act(() => {
        replaceSpacesInStore(harness.workspaceId, [...harness.readStoreDocument().spaces, spaceC()])
      })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.readStoreDocument().spaces.map(space => space.id)).toEqual([
        'space-a',
        'space-c',
      ])
    })

    it('finalizes from the nodes the store holds, not the ones read at pointer down', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      press(view, 'space-a', INSIDE_A)

      // A node that the store gained since pointer down is not part of the drag, but the moved
      // Space pushes it clear of its new rect, which only the nodes read at pointer up know.
      act(() => {
        replaceWorkspaceNodes(harness.workspaceId, [
          ...harness.readStoreDocument().nodes,
          nodeAt('n-late', 650, 100),
        ])
      })
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      expect(harness.readStoreDocument().nodes.map(node => [node.id, node.position.x])).toEqual([
        ['n1', 150],
        ['n-late', 700],
      ])
    })

    it('applies the node changes to the nodes that carry the canvas fields', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      act(() => view.result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['space-a'] }))
      // `selected` exists only in the canvas view; the store's node does not hold it.
      expect(harness.readStoreDocument().nodes[0].selected).toBeFalsy()
      press(view, 'space-a', INSIDE_A)

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const [stored] = harness.readStoreDocument().nodes
      expect(stored.position.x).toBe(150)
      expect(stored.selected).toBe(true)
    })

    // On the base a click wrote the nodes (they gain `dragHandle` and their initial size from the
    // canvas view) and then the Spaces (an equal array), two store updates, and flushed once. It is
    // now exactly one update with both, and one flush; positions and Spaces keep their content.
    it('changes no content and flushes once for a click', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      act(() => view.result.current.selection.select({ nodeIds: [], spaceIds: ['space-a'] }))
      press(view, 'space-a', INSIDE_A)
      harness.notifications.mockClear()
      harness.flush.mockClear()
      const before = harness.readStoreDocument()

      release({ x: INSIDE_A.x + 2, y: INSIDE_A.y + 1 })

      expect(harness.notifications).toHaveBeenCalledTimes(1)
      expect(harness.flush).toHaveBeenCalledTimes(1)
      expect(harness.readStoreDocument().nodes.map(node => node.position)).toEqual(
        before.nodes.map(node => node.position),
      )
      expect(harness.readStoreDocument().spaces).toEqual(before.spaces)
    })
  })

  describe('after a workspace switch', () => {
    it('drags the Space of the workspace shown now, not the one shown before', () => {
      const { harness, view, switchTo } = renderSwitchingSpaceDrag()
      switchTo('workspace-b')

      press(view, 'space-a', INSIDE_A)
      expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()

      press(view, 'space-b', INSIDE_A)
      dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
      expect([
        ...(view.result.current.readInteraction().spaceDragFramePreview?.keys() ?? []),
      ]).toEqual(['space-b'])
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const workspaces = useAppStore.getState().workspaces
      const b = workspaces.find(workspace => workspace.id === 'workspace-b')
      const a = workspaces.find(workspace => workspace.id === 'workspace-a')
      expect(b?.spaces[0].rect).toMatchObject({ x: 100 })
      expect(b?.nodes[0].position.x).toBe(150)
      expect(a?.spaces[0].rect).toEqual(SPACE_A_RECT)
      expect(a?.nodes[0].position.x).toBe(50)
      expect(harness.flush).toHaveBeenCalledTimes(1)
    })

    it('snaps against the Spaces of the workspace shown now', () => {
      const { view, switchTo } = renderSwitchingSpaceDrag()
      useAppStore.setState(state => ({
        workspaces: state.workspaces.map(workspace =>
          workspace.id === 'workspace-b'
            ? {
                ...workspace,
                spaces: [
                  ...workspace.spaces,
                  createSpace('space-snap', { x: 104, y: 500, width: 400, height: 400 }, []),
                ],
              }
            : workspace,
        ),
      }))
      // Turned on while workspace A is shown: the toggle follows the user to workspace B.
      act(() => view.result.current.interaction.toggleMagneticSnapping())
      switchTo('workspace-b')

      press(view, 'space-b', INSIDE_A)
      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const b = useAppStore.getState().workspaces.find(workspace => workspace.id === 'workspace-b')
      expect(b?.spaces[0].rect?.x).toBe(104)
    })
  })
})
