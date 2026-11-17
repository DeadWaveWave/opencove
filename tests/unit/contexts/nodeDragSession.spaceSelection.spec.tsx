import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWorkspaceCanvasNodeDragSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { renderHookWithCanvasStore } from '../../support/canvasStoreTestHarness'
import { seedWorkspaceCanvasStore } from '../../support/workspaceCanvasStoreHarness'
import { CANVAS_STORE_TEST_WORKSPACE_ID } from '../../support/canvasStoreTestHarness'

function renderSession(spaces: WorkspaceSpaceState[] = []) {
  seedWorkspaceCanvasStore({ workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID, spaces })
  return renderHookWithCanvasStore(() =>
    useWorkspaceCanvasNodeDragSession({
      workspaceId: 'drag-session',
    }),
  )
}

// Decision 7 of #692: the drag copy of the selected Spaces is private state of the session.
describe('node drag session Space selection copy', () => {
  it('is null until a drag captures it', () => {
    const { result } = renderSession()

    expect(result.current.getDragStartSpaceSelection()).toBeNull()
  })

  it('keeps the copy taken at drag start when the selection changes during the drag', () => {
    const { result, selection } = renderSession()
    act(() => selection.setSpaceIds(['b', 'a']))

    act(() => result.current.captureDragStartSpaceSelection())
    act(() => selection.clear())

    expect(result.current.getDragStartSpaceSelection()).toEqual(['a', 'b'])
  })

  it('returns to null when cleared, and a later capture takes the then-current selection', () => {
    const { result, selection } = renderSession()
    act(() => selection.setSpaceIds(['a']))
    act(() => result.current.captureDragStartSpaceSelection())

    act(() => result.current.clearDragStartSpaceSelection())
    expect(result.current.getDragStartSpaceSelection()).toBeNull()

    act(() => selection.setSpaceIds(['c']))
    act(() => result.current.captureDragStartSpaceSelection())
    expect(result.current.getDragStartSpaceSelection()).toEqual(['c'])
  })

  it('keeps stable function identities across renders', () => {
    const { result, rerender } = renderSession()
    const first = result.current

    rerender()

    expect(result.current.captureDragStartSpaceSelection).toBe(first.captureDragStartSpaceSelection)
    expect(result.current.getDragStartSpaceSelection).toBe(first.getDragStartSpaceSelection)
    expect(result.current.clearDragStartSpaceSelection).toBe(first.clearDragStartSpaceSelection)
  })

  it('projects a Space-dominant drag from the copy after the selection was cleared', () => {
    const node = {
      ...pixelNode({ kind: 'note', sessionId: '', note: { text: 'n' } }),
      id: 'n1',
      position: { x: 50, y: 50 },
    }
    const space: WorkspaceSpaceState = {
      id: 'space-1',
      name: 'Space 1',
      directoryPath: '/tmp/repo',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['n1'],
      rect: { x: 0, y: 0, width: 600, height: 400 },
    }
    const { result, selection } = renderSession([space])
    act(() => selection.setSpaceIds([space.id]))
    act(() => result.current.captureDragStartSpaceSelection())
    // For example `]` clears the selection while the drag is running.
    act(() => selection.clear())

    act(() => result.current.beginNodeDragSession([node]))
    let projected: ReturnType<typeof result.current.projectNodeDrag> | null = null
    act(() => {
      projected = result.current.projectNodeDrag({
        currentNodes: [node],
        draggedNodeIds: ['n1'],
        desiredDraggedPositionById: new Map([['n1', { x: 150, y: 100 }]]),
        anchorNodeId: 'n1',
        anchorIsSelected: true,
      })
    })

    expect(projected!.nextSpaceFramePreview?.get(space.id)).toMatchObject({ x: 100, y: 50 })
  })
})
