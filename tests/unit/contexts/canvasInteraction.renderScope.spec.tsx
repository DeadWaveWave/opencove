import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWorkspaceCanvasState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import { useCanvasInteractionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { renderInCanvasDocument } from '../../support/canvasDocumentHarness'

const NO_NODES: never[] = []
const NO_SPACES: never[] = []
const VIEWPORT = { x: 0, y: 0, zoom: 1 }
const DRAFT = { startX: 1, startY: 2, currentX: 3, currentY: 4, phase: 'active' } as const

// #738 Decision 2: the marquee rectangle and the snapping toggle are read by leaves. A frame of
// the marquee must not render the hook that WorkspaceCanvasInner calls for the canvas state.
describe('useWorkspaceCanvasState and the interaction slice', () => {
  function renderCanvasState() {
    let renders = 0
    const view = renderInCanvasDocument(() => {
      renders += 1
      return {
        canvasState: useWorkspaceCanvasState({
          workspaceId: 'workspace-1',
          nodes: NO_NODES,
          spaces: NO_SPACES,
          viewport: VIEWPORT,
        }),
        interaction: useCanvasInteractionCommands(),
      }
    })
    return { view, renders: () => renders }
  }

  it('does not render when the marquee rectangle changes', () => {
    const { view, renders } = renderCanvasState()
    const rendersBefore = renders()

    act(() => view.result.current.interaction.setSelectionDraft(DRAFT))
    act(() => view.result.current.interaction.setSelectionDraft({ ...DRAFT, currentX: 40 }))
    act(() => view.result.current.interaction.setSelectionDraft(null))

    expect(renders()).toBe(rendersBefore)
  })

  it('does not render when the snapping toggle flips', () => {
    const { view, renders } = renderCanvasState()
    const rendersBefore = renders()

    act(() => view.result.current.interaction.toggleMagneticSnapping())
    act(() => view.result.current.interaction.toggleMagneticSnapping())

    expect(renders()).toBe(rendersBefore)
  })
})
