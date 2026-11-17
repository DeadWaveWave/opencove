import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasNodeDragSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import {
  useCanvasSelectionCommands,
  useCanvasUiCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

// A state setter keeps its identity; a new one on every render would reset the session.
const setSnapGuides = vi.fn()

function useDragSessionUnderTest({ workspaceId }: CanvasNodeStoreContext) {
  return {
    session: useWorkspaceCanvasNodeDragSession({
      workspaceId,
      magneticSnappingEnabledRef: { current: false },
      setSnapGuides,
    }),
    selection: useCanvasSelectionCommands(),
    ui: useCanvasUiCommands(),
  }
}

// A Space-dominant node drag moves the selected Space frames; the release writes them once, and
// RF calls `onNodeDragStop` in the same call, which reads the Spaces for the drop target.
describe('node drag session: releasing a Space frame', () => {
  it('stores the pushed frame once, and a read in the same call sees it', () => {
    const [node] = createRowNodes(['n1'])
    const movingNode = { ...node, position: { x: 50, y: 50 } }
    const space = createSpace('space-1', { x: 0, y: 0, width: 600, height: 400 }, ['n1'])
    const harness = createCanvasDocumentHarness({ nodes: [movingNode], spaces: [space] })
    const view = renderCanvasNodeStore(harness, { extend: useDragSessionUnderTest })
    act(() => view.result.current.selection.setSpaceIds([space.id]))
    const { session } = view.result.current
    act(() => session.captureDragStartSpaceSelection())
    act(() => session.beginNodeDragSession([movingNode]))
    act(() => {
      session.projectNodeDrag({
        currentNodes: [movingNode],
        draggedNodeIds: ['n1'],
        desiredDraggedPositionById: new Map([['n1', { x: 150, y: 100 }]]),
        anchorNodeId: 'n1',
        anchorIsSelected: true,
      })
    })
    harness.notifications.mockClear()
    let seenAfterRelease: unknown = null

    act(() => {
      session.endNodeDragSession()
      seenAfterRelease = harness.readStoreDocument().spaces[0].rect
    })

    expect(seenAfterRelease).toMatchObject({ x: 100, y: 50 })
    expect(harness.readStoreDocument().spaces[0].rect).toMatchObject({ x: 100, y: 50 })
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })
})
