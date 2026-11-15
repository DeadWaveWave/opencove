import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasNodeDragSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import { renderHookWithCanvasStore } from '../../support/canvasStoreTestHarness'

function renderSession() {
  const spaces: WorkspaceSpaceState[] = []
  return renderHookWithCanvasStore(() =>
    useWorkspaceCanvasNodeDragSession({
      workspaceId: 'drag-session',
      spacesRef: { current: spaces },
      magneticSnappingEnabledRef: { current: false },
      setSnapGuides: vi.fn(),
      onSpacesChange: vi.fn(),
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
})
