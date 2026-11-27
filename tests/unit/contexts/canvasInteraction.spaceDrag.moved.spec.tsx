import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasCollapseStore } from '../../../src/contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'

import { applyLiveNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasLiveNodes'
import {
  createCanvasDocumentHarness,
  type CanvasDocumentHarness,
} from '../../support/canvasDocumentHarness'
import { createSpace } from '../../support/canvasSelectionFixtures'
import {
  INSIDE_A,
  dragTo,
  nodeAt,
  press,
  release,
  renderDrag,
  spaceA,
} from '../../support/spaceDragHarness'
import { setDocumentNodes } from '../../support/documentNodes'

// #738, PR 6: the release of a Space drag keeps the store's position for a window the drag did not
// move, as the frames showed it (invariant 3: a write from elsewhere during the gesture is never
// overwritten except for the positions of the windows the gesture moved). The two guards at the end
// pin that a window the drag does move still lands where the drag puts it.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  useCanvasCollapseStore.setState({ workspaces: {} })
})

function renderOpenSpace(extra: ReturnType<typeof nodeAt>[] = []) {
  const harness = createCanvasDocumentHarness({
    nodes: [nodeAt('n1', 50, 60), nodeAt('n-far', 1500, 60), ...extra],
    spaces: [spaceA(), createSpace('space-c', { x: 1400, y: 0, width: 500, height: 400 }, [])],
  })
  return { harness, view: renderDrag(harness) }
}

function moveFromElsewhere(harness: CanvasDocumentHarness, id: string, x: number, y: number) {
  act(() => {
    setDocumentNodes(
      harness.workspaceId,
      harness
        .readStoreDocument()
        .nodes.map(node => (node.id === id ? { ...node, position: { x, y } } : node)),
    )
  })
}

const stored = (harness: CanvasDocumentHarness, id: string) =>
  harness.readStoreDocument().nodes.find(node => node.id === id)?.position

describe('the release of a Space drag and a window moved from elsewhere', () => {
  it('keeps a window it neither carries nor pushes where the move put it, as the frames showed it', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    moveFromElsewhere(harness, 'n-far', 1800, 60)
    dragTo({ x: INSIDE_A.x + 80, y: INSIDE_A.y })
    const shownBefore = applyLiveNodes(
      harness.readStoreDocument().nodes,
      view.result.current.readInteraction().liveNodes,
    ).find(node => node.id === 'n-far')?.position

    release({ x: INSIDE_A.x + 80, y: INSIDE_A.y })

    expect(shownBefore).toEqual({ x: 1800, y: 60 })
    expect(stored(harness, 'n-far')).toEqual({ x: 1800, y: 60 })
    expect(stored(harness, 'n1')).toEqual({ x: 130, y: 60 })
    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 80 })
  })

  it('keeps such a move through a click that did not drag', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    moveFromElsewhere(harness, 'n-far', 1800, 60)

    release({ x: INSIDE_A.x + 2, y: INSIDE_A.y + 1 })

    expect(stored(harness, 'n-far')).toEqual({ x: 1800, y: 60 })
  })

  it('still lands a window it carries with its Space after a move from elsewhere', () => {
    const { harness, view } = renderOpenSpace()
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 40, y: INSIDE_A.y })
    moveFromElsewhere(harness, 'n1', 50, 300)
    dragTo({ x: INSIDE_A.x + 80, y: INSIDE_A.y })

    release({ x: INSIDE_A.x + 80, y: INSIDE_A.y })

    expect(stored(harness, 'n1')).toEqual({ x: 130, y: 60 })
  })

  it('still lands a window it pushes at the pushed place after a move from elsewhere', () => {
    const { harness, view } = renderOpenSpace([nodeAt('n-pushed', 650, 100)])
    press(view, 'space-a', INSIDE_A)
    dragTo({ x: INSIDE_A.x + 100, y: INSIDE_A.y })
    moveFromElsewhere(harness, 'n-pushed', 3000, 3000)
    dragTo({ x: INSIDE_A.x + 110, y: INSIDE_A.y })

    release({ x: INSIDE_A.x + 110, y: INSIDE_A.y })

    expect(stored(harness, 'n-pushed')).toEqual({ x: 710, y: 100 })
  })
})
