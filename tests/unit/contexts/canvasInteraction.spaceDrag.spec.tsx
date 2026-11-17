import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import { createSpace } from '../../support/canvasSelectionFixtures'
import {
  INSIDE_A,
  dragTo,
  nodeAt,
  press,
  release,
  renderDrag,
  renderSwitchingSpaceDrag,
  spaceA,
} from '../../support/spaceDragHarness'

// #738, PR 6 (Decision 9): a Space drag frame publishes to the overlay and the preview of the
// `interaction` slice and writes nothing else. The document, and with it the sidebar, the
// persistence and the other clients, changes once, at the release.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  useCanvasCollapseStore.setState({ workspaces: {} })
})

const FAR_AWAY_X = 1500

function renderOpenSpace() {
  const harness = createCanvasDocumentHarness({
    nodes: [nodeAt('n1', 50, 60), nodeAt('n-far', FAR_AWAY_X, 60)],
    spaces: [spaceA(), createSpace('space-c', { x: 1400, y: 0, width: 500, height: 400 }, [])],
  })
  return { harness, view: renderDrag(harness) }
}

describe('a frame of a Space drag', () => {
  it('notifies no app store subscriber, requests no flush and leaves the document itself', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    const documentBefore = harness.readStoreDocument()
    harness.notifications.mockClear()

    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    dragTo({ x: INSIDE_A.x + 90, y: INSIDE_A.y + 10 })
    dragTo({ x: INSIDE_A.x + 120, y: INSIDE_A.y + 10 })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    // The arrays themselves, not equal copies: nothing was written.
    expect(harness.readStoreDocument().nodes).toBe(documentBefore.nodes)
    expect(harness.readStoreDocument().spaces).toBe(documentBefore.spaces)
  })

  it('puts the positions of the windows it moves in the overlay, with no dragging flag', () => {
    const { view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)

    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    const { liveNodes } = view.result.current.readInteraction()
    expect([...(liveNodes?.keys() ?? [])]).toEqual(['n1'])
    expect(liveNodes?.get('n1')).toEqual({ position: { x: 90, y: 60 } })
  })

  it('puts the Space frames in the preview of the Space drag, and none in the node-drag preview', () => {
    const { view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)

    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    const interaction = view.result.current.readInteraction()
    expect(interaction.spaceDragFramePreview?.get('space-a')).toMatchObject({ x: 40, y: 0 })
    expect(interaction.nodeDragFramePreview).toBeNull()
  })

  // The type test of this is in `useCanvasState.spec.ts`, which `pnpm check` compiles.
  it('returns only its pointer handler: the preview is in the slice, not in the hook', () => {
    const { view } = renderOpenSpace()

    expect(Object.keys(view.result.current.drag)).toEqual(['handleSpaceDragHandlePointerDown'])
  })

  it('shows the Space under the pointer in the preview as soon as the pointer is down', () => {
    const { view } = renderOpenSpace()

    press(view, 'space-a', INSIDE_A)

    const interaction = view.result.current.readInteraction()
    expect([...(interaction.spaceDragFramePreview?.keys() ?? [])]).toEqual(['space-a'])
    expect(interaction.spaceDragFramePreview?.get('space-a')).toMatchObject({ x: 0, y: 0 })
    expect(interaction.liveNodes).toBeNull()
  })

  it('leaves out a window the drag neither carries nor pushes', () => {
    const { view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)

    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    expect(view.result.current.readInteraction().liveNodes?.has('n-far')).toBe(false)
  })

  it('includes a window the drag pushes clear of the moved Space', () => {
    const harness = createCanvasDocumentHarness({
      nodes: [nodeAt('n1', 50, 60), nodeAt('n-pushed', 650, 100)],
      spaces: [spaceA()],
    })
    const view = renderDrag(harness)
    press(view, 'space-a', INSIDE_A)

    dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

    const { liveNodes } = view.result.current.readInteraction()
    expect([...(liveNodes?.keys() ?? [])].sort()).toEqual(['n-pushed', 'n1'])
    expect(liveNodes?.get('n-pushed')?.position.x).toBe(700)
  })

  it('leaves out a window created during the drag that the drag does not push', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    act(() => {
      replaceWorkspaceNodes(harness.workspaceId, [
        ...harness.readStoreDocument().nodes,
        nodeAt('n-created', 3000, 60),
      ])
    })

    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    // It has no drag-start place, so it is compared with the store, which agrees with the frame.
    expect(view.result.current.readInteraction().liveNodes?.has('n-created')).toBe(false)
  })

  it('keeps the overlay and the preview themselves when a frame changes nothing', () => {
    const { view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    const before = view.result.current.readInteraction()

    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    const after = view.result.current.readInteraction()
    expect(after.liveNodes).toBe(before.liveNodes)
    expect(after.spaceDragFramePreview).toBe(before.spaceDragFramePreview)
  })

  it('takes a window out of the overlay when the pointer returns to where the drag began', () => {
    const { view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    expect(view.result.current.readInteraction().liveNodes?.has('n1')).toBe(true)

    dragTo(INSIDE_A)

    expect(view.result.current.readInteraction().liveNodes?.has('n1')).toBe(false)
  })

  it('projects from the nodes the store holds when the frame runs, and publishes the result', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)

    // A window the store gained since the pointer went down, in the way of the moved Space.
    act(() => {
      replaceWorkspaceNodes(harness.workspaceId, [
        ...harness.readStoreDocument().nodes,
        nodeAt('n-late', 650, 100),
      ])
    })
    dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

    // A window with no drag-start place is compared with the store: pushed clear of the Space, it
    // is the drag's. The document still holds it where the store had it.
    const { liveNodes } = view.result.current.readInteraction()
    expect(liveNodes?.get('n-late')?.position.x).toBe(700)
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'n-late')?.position.x).toBe(
      650,
    )
  })

  // A window moved from elsewhere during the drag, one the drag does not carry: the overlay has no
  // entry for it, so it is shown where the store has it (the rule of #747). The release below
  // pins what the unchanged finalize recipe does with it.
  it('leaves a window moved from elsewhere out of the overlay, in every frame', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node =>
            node.id === 'n-far' ? { ...node, position: { x: FAR_AWAY_X + 300, y: 60 } } : node,
          ),
      )
    })
    dragTo({ x: INSIDE_A.x + 60, y: INSIDE_A.y })
    dragTo({ x: INSIDE_A.x + 61, y: INSIDE_A.y })

    expect(view.result.current.readInteraction().liveNodes?.has('n-far')).toBe(false)
    expect(harness.readStoreDocument().nodes.find(node => node.id === 'n-far')?.position.x).toBe(
      FAR_AWAY_X + 300,
    )
  })

  it('keeps going when a window it carries is removed from elsewhere', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness.readStoreDocument().nodes.filter(node => node.id !== 'n1'),
      )
    })
    dragTo({ x: INSIDE_A.x + 80, y: INSIDE_A.y })
    release({ x: INSIDE_A.x + 80, y: INSIDE_A.y })

    expect(harness.readStoreDocument().nodes.map(node => node.id)).toEqual(['n-far'])
    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 80 })
  })
})

describe('the release of a Space drag', () => {
  it('writes the document once and flushes once, after frames that wrote nothing', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
    harness.notifications.mockClear()
    harness.flush.mockClear()

    release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

    const document = harness.readStoreDocument()
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(document.spaces[0].rect).toMatchObject({ x: 100, y: 0 })
    expect(document.nodes[0].position).toEqual({ x: 150, y: 60 })
  })

  it('flushes after the write, so the flush sees the released document', () => {
    const { harness, view } = renderOpenSpace()
    const seenAtFlush: Array<{ rectX: number | undefined; nodeX: number }> = []
    harness.flush.mockImplementation(() => {
      const document = harness.readStoreDocument()
      seenAtFlush.push({ rectX: document.spaces[0].rect?.x, nodeX: document.nodes[0].position.x })
    })
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
    expect(seenAtFlush).toEqual([])

    release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

    expect(seenAtFlush).toEqual([{ rectX: 100, nodeX: 150 }])
  })

  it('clears the overlay and the preview in the same act, and not before the write', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
    const { readInteraction } = view.result.current
    expect(readInteraction().liveNodes).not.toBeNull()
    expect(readInteraction().spaceDragFramePreview).not.toBeNull()
    const seenAtWrite: Array<{ overlay: boolean; preview: boolean; nodeX: number }> = []
    const stop = useAppStore.subscribe(() => {
      seenAtWrite.push({
        overlay: readInteraction().liveNodes !== null,
        preview: readInteraction().spaceDragFramePreview !== null,
        nodeX: harness.readStoreDocument().nodes[0].position.x,
      })
    })

    release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
    stop()

    // At the write the overlay still covers the nodes, so no render between the two shows them
    // before the drag; after the act, in which both ran, neither is left.
    expect(seenAtWrite).toEqual([{ overlay: true, preview: true, nodeX: 150 }])
    expect(readInteraction().liveNodes).toBeNull()
    expect(readInteraction().spaceDragFramePreview).toBeNull()
    expect(readInteraction().snapGuides).toBeNull()
  })

  it('ends a drag that never moved without a frame, writing no node position', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    const nodesBefore = harness.readStoreDocument().nodes.map(node => node.position)
    const spacesBefore = harness.readStoreDocument().spaces

    release({ x: INSIDE_A.x + 2, y: INSIDE_A.y + 1 })

    const { readInteraction } = view.result.current
    expect(readInteraction().liveNodes).toBeNull()
    expect(readInteraction().spaceDragFramePreview).toBeNull()
    expect(harness.readStoreDocument().nodes.map(node => node.position)).toEqual(nodesBefore)
    expect(harness.readStoreDocument().spaces).toEqual(spacesBefore)
  })

  // What the unchanged finalize recipe does with a window that a write from elsewhere moved during
  // the drag and that the drag does not carry: it plans the layout from the positions the drag
  // began with, so it puts the window back. The window is shown at the new place during the drag
  // (the test above) and returns at the release; the end state is the one `main` has. A known
  // limit, with the pushes that start from the drag-start positions (see DEVELOPMENT.md).
  it('puts a window moved from elsewhere that it does not carry back to its drag-start place', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node =>
            node.id === 'n-far' ? { ...node, position: { x: FAR_AWAY_X + 300, y: 60 } } : node,
          ),
      )
    })

    release({ x: INSIDE_A.x + 40, y: INSIDE_A.y })

    expect(harness.readStoreDocument().nodes.find(node => node.id === 'n-far')?.position.x).toBe(
      FAR_AWAY_X,
    )
  })
})

describe('a Space drag across a workspace switch', () => {
  it('leaves nothing of A in B, and a release that arrives after the switch writes neither', () => {
    const { harness, view, switchTo } = renderSwitchingSpaceDrag()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    expect(view.result.current.readInteraction().liveNodes?.has('n1')).toBe(true)
    harness.notifications.mockClear()

    switchTo('workspace-b')
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()
    release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

    const workspaces = useAppStore.getState().workspaces
    const a = workspaces.find(workspace => workspace.id === 'workspace-a')
    const b = workspaces.find(workspace => workspace.id === 'workspace-b')
    // A kept every position it had before the drag: the frames never wrote it, and the release
    // died with the drag state.
    expect(a?.nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(a?.spaces[0].rect).toMatchObject({ x: 0 })
    expect(b?.nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(b?.spaces[0].rect).toMatchObject({ x: 0 })
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()
  })

  it('publishes nothing for a frame that was waiting when the workspace switched', () => {
    const { view, switchTo } = renderSwitchingSpaceDrag()
    press(view, 'space-a', INSIDE_A)
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 7,
          clientX: INSIDE_A.x + 40,
          clientY: INSIDE_A.y,
        }),
      )
    })

    switchTo('workspace-b')
    act(() => {
      vi.advanceTimersByTime(40)
    })

    expect(view.result.current.readInteraction().liveNodes).toBeNull()
    expect(view.result.current.readInteraction().spaceDragFramePreview).toBeNull()
  })

  it('lets the drag of B begin and end with its own overlay', () => {
    const { view, switchTo } = renderSwitchingSpaceDrag()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    switchTo('workspace-b')

    press(view, 'space-b', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    expect([...(view.result.current.readInteraction().liveNodes?.keys() ?? [])]).toEqual(['b1'])
    release({ x: INSIDE_A.x + 100, y: INSIDE_A.y })

    const b = useAppStore.getState().workspaces.find(workspace => workspace.id === 'workspace-b')
    expect(b?.nodes[0].position.x).toBe(150)
    expect(view.result.current.readInteraction().liveNodes).toBeNull()
  })
})
