import React from 'react'
import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithCanvasStore } from '../../support/canvasStoreTestHarness'
import { WorkspaceSpaceRegionsOverlay } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceRegionsOverlay'
import { useCanvasSelection } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'

vi.mock('@xyflow/react', () => {
  return {
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getZoom: () => 1,
    }),
    useStore: (selector: (state: unknown) => unknown) => selector({}),
  }
})

const SPACE_ID = 'space-1'

function NodeIdsSubscriber({ renders }: { renders: { count: number } }): null {
  useCanvasSelection(selection => selection.nodeIds)
  renders.count += 1
  return null
}

// Decision 5 of #692: a Space-only selection change renders the Space overlay and nothing that
// subscribes to the selected node ids (WorkspaceCanvasInner reads them through useCanvasState).
describe('canvas selection render scope', () => {
  it('marks the selected Space region without rendering a subscriber of the node ids', () => {
    const renders = { count: 0 }
    const { selection } = renderWithCanvasStore(
      <>
        <NodeIdsSubscriber renders={renders} />
        <WorkspaceSpaceRegionsOverlay
          workspacePath="/tmp"
          spaceVisuals={[
            {
              id: SPACE_ID,
              name: 'Infra',
              directoryPath: '/tmp',
              targetMountId: null,
              parentSpaceId: null,
              boundary: null,
              sortOrder: 0,
              labelColor: null,
              rect: { x: 0, y: 0, width: 200, height: 160 },
              hasExplicitRect: true,
            },
          ]}
          spaceFramePreview={null}
          openExplorerSpaceId={null}
          toggleExplorer={() => undefined}
          handleSpaceDragHandlePointerDown={() => undefined}
          commitSpaceRename={() => undefined}
          activateSpaceTitle={() => undefined}
        />
      </>,
    )
    expect(document.querySelector('.workspace-space-region')).not.toBeNull()
    expect(document.querySelector('.workspace-space-region--selected')).toBeNull()
    const rendersBefore = renders.count
    expect(rendersBefore).toBeGreaterThan(0)

    act(() => selection.setSpaceIds([SPACE_ID]))

    expect(document.querySelector('.workspace-space-region--selected')).not.toBeNull()
    expect(renders.count).toBe(rendersBefore)

    act(() => selection.setSpaceIds([]))
    expect(document.querySelector('.workspace-space-region--selected')).toBeNull()
    expect(renders.count).toBe(rendersBefore)
  })

  it('renders a subscriber of the node ids when the node selection changes', () => {
    const renders = { count: 0 }
    const { selection } = renderWithCanvasStore(<NodeIdsSubscriber renders={renders} />)
    const rendersBefore = renders.count

    act(() => selection.setNodeIds(['n1']))

    expect(renders.count).toBe(rendersBefore + 1)
  })
})
