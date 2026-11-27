import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'

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
import { setDocumentNodes } from '../../support/documentNodes'

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
        setDocumentNodes(harness.workspaceId, [nodeAt('n1', 50, 60), nodeAt('n2', 300, 150)])
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
        setDocumentNodes(harness.workspaceId, [nodeAt('n1', 450, 60)])
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
        setDocumentNodes(harness.workspaceId, [
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
        setDocumentNodes(harness.workspaceId, [
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

    // The release writes the moved windows' positions and nothing of the canvas view: `selected`
    // exists only in the view (S7, PR 3), so the stored node holds none, and the selection stays
    // the slice's.
    it('moves the stored window with the Space and stores no canvas-only field', () => {
      const harness = createCanvasDocumentHarness({
        nodes: [nodeAt('n1', 50, 60)],
        spaces: [spaceA()],
      })
      const view = renderDrag(harness)
      act(() => view.result.current.selection.select({ nodeIds: ['n1'], spaceIds: ['space-a'] }))
      expect(harness.readStoreDocument().nodes[0].selected).toBeUndefined()
      press(view, 'space-a', INSIDE_A)

      release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

      const [stored] = harness.readStoreDocument().nodes
      expect(stored.position.x).toBe(150)
      expect(stored.selected).toBeUndefined()
      expect(stored.dragHandle).toBeUndefined()
      expect(stored.dragging).toBeUndefined()
      expect(view.result.current.readSelection().nodeIds).toEqual(['n1'])
    })

    // A click on a Space writes nothing (S7, Decision 10). On the base it finalized the drag with
    // a zero move: one store update (the nodes gained their mirror flags) and one flush. Now its
    // selection is a select only, and it ends the overlay and the preview the pointer down set.
    describe('a click that did not move', () => {
      function setupClick(options: { selectedNodeIds?: string[] } = {}) {
        const harness = createCanvasDocumentHarness({
          nodes: [nodeAt('n1', 50, 60), nodeAt('n2', 900, 60)],
          spaces: [spaceA(['n1'])],
        })
        const view = renderDrag(harness)
        act(() =>
          view.result.current.selection.select({
            nodeIds: options.selectedNodeIds ?? [],
            spaceIds: ['space-a'],
          }),
        )
        press(view, 'space-a', INSIDE_A)
        harness.notifications.mockClear()
        harness.flush.mockClear()
        return { harness, view, before: harness.readStoreDocument() }
      }

      it('writes no store update and no flush, and clears the preview', () => {
        const { harness, view, before } = setupClick()
        expect(view.result.current.readInteraction().spaceDragFramePreview).not.toBeNull()

        release({ x: INSIDE_A.x + 2, y: INSIDE_A.y + 1 })

        expect(harness.notifications).not.toHaveBeenCalled()
        expect(harness.flush).not.toHaveBeenCalled()
        expect(harness.readStoreDocument().nodes).toBe(before.nodes)
        expect(harness.readStoreDocument().spaces).toBe(before.spaces)
        expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()
      })

      it('writes nothing with a window selected, and the mirror flags stay as they were', () => {
        const { harness, view, before } = setupClick({ selectedNodeIds: ['n2'] })

        release({ x: INSIDE_A.x + 2, y: INSIDE_A.y + 1 })

        expect(harness.notifications).not.toHaveBeenCalled()
        expect(harness.flush).not.toHaveBeenCalled()
        expect(harness.readStoreDocument().nodes).toBe(before.nodes)
        // The click selects the Space alone: the window leaves the selection, in the slice only.
        expect(view.result.current.readSelection().nodeIds).toEqual([])
        expect(view.result.current.readSelection().spaceIds).toEqual(['space-a'])
      })

      it('ends the overlay a frame inside the click radius published', () => {
        const { harness, view } = setupClick()
        dragTo({ x: INSIDE_A.x + 3, y: INSIDE_A.y })
        expect(view.result.current.readInteraction().liveNodes).not.toBeNull()

        release({ x: INSIDE_A.x + 3, y: INSIDE_A.y })

        expect(view.result.current.readInteraction().liveNodes).toBeNull()
        expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()
        expect(harness.notifications).not.toHaveBeenCalled()
        expect(harness.flush).not.toHaveBeenCalled()
      })

      it('toggles with Shift and writes nothing either', () => {
        const { harness, view, before } = setupClick()
        release({ x: INSIDE_A.x, y: INSIDE_A.y })
        press(view, 'space-a', INSIDE_A, true)

        release({ x: INSIDE_A.x, y: INSIDE_A.y })

        expect(view.result.current.readSelection().spaceIds).toEqual([])
        expect(harness.notifications).not.toHaveBeenCalled()
        expect(harness.flush).not.toHaveBeenCalled()
        expect(harness.readStoreDocument().nodes).toBe(before.nodes)
        expect(harness.readStoreDocument().spaces).toBe(before.spaces)
      })
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

// Decision 10 for the handles where the base's click wrote something. The base finalized a zero
// move: on a resize edge that resolved the Space to its minimum size (or to its content) and
// pushed its neighbours, and on a move handle it pulled a child Space back into its parent. A click
// now writes nothing, so it resizes and moves nothing (the first of these is red on the base: one
// notification and one flush).
describe('a click on a Space handle that the base would have resolved', () => {
  it('leaves a Space smaller than the minimum and its neighbour where they are after a click on its edge', () => {
    const harness = createCanvasDocumentHarness({
      nodes: [nodeAt('a', 5000, 5000)],
      spaces: [
        createSpace('s', { x: 2000, y: 0, width: 100, height: 80 }, []),
        createSpace('t', { x: 2110, y: 0, width: 400, height: 300 }, []),
      ],
    })
    const view = renderDrag(harness)
    act(() => view.result.current.selection.select({ nodeIds: [], spaceIds: ['s'] }))
    const before = harness.readStoreDocument()
    harness.notifications.mockClear()
    harness.flush.mockClear()

    press(view, 's', { x: 2098, y: 40 })
    release({ x: 2098, y: 40 })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().spaces).toBe(before.spaces)
  })

  it('leaves a child Space that sticks out of its parent where it is after a click', () => {
    const harness = createCanvasDocumentHarness({
      nodes: [nodeAt('a', 2000, 2000), nodeAt('b', 905, 140)],
      spaces: [
        createSpace('p', { x: 0, y: 0, width: 1000, height: 600 }, []),
        {
          ...createSpace('c', { x: 900, y: 100, width: 300, height: 260 }, ['b']),
          parentSpaceId: 'p',
        },
      ],
    })
    const view = renderDrag(harness)
    act(() => view.result.current.selection.select({ nodeIds: [], spaceIds: ['c'] }))
    const before = harness.readStoreDocument()
    harness.notifications.mockClear()

    press(view, 'c', { x: 1050, y: 300 })
    release({ x: 1050, y: 300 })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes).toBe(before.nodes)
    expect(harness.readStoreDocument().spaces).toBe(before.spaces)
  })
})
