import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasProps } from '../types'
import type { CanvasFlowHost } from '../CanvasFlowHost'
import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { useWorkspaceCanvasSpaceDrag } from './useSpaceDrag'
import type {
  UseWorkspaceCanvasNodesStoreParams,
  UseWorkspaceCanvasNodesStoreResult,
} from './useNodesStore.types'

// The end of #702 (S5 of #647): the canvas state no longer exposes the Spaces ref, and neither the
// node store nor the canvas takes the persistence flush as a callback. `pnpm check` compiles this
// file, so each directive below fails the check (unused directive) the day its field comes back.
// The reads are expressions of the field, not aliases of its type: an unused alias would raise an
// error of its own on the same line and keep the directive satisfied.
describe('the retired canvas channels', () => {
  it('are not part of the canvas state', () => {
    const canvasState = {} as ReturnType<typeof useWorkspaceCanvasState>

    // @ts-expect-error -- spacesRef is retired; read Spaces with useReadCanvasDocument (#647 S5)
    expect(canvasState.spacesRef).toBeUndefined()
  })

  it('are not part of the node store parameters', () => {
    const params = {} as UseWorkspaceCanvasNodesStoreParams

    // @ts-expect-error -- onRequestPersistFlush is retired; flush on the write with { flush: true } (#647 S5)
    expect(params.onRequestPersistFlush).toBeUndefined()
  })

  it('are not part of the canvas props', () => {
    const props = {} as WorkspaceCanvasProps

    // @ts-expect-error -- onRequestPersistFlush is retired; the canvas flushes through the document commands (#647 S5)
    expect(props.onRequestPersistFlush).toBeUndefined()
  })

  // #738 (S6 of #647), the `interaction` slice: the marquee rectangle and the snapping toggle live
  // in the canvas store, not in the canvas state, and the view props no longer carry them.
  it('do not keep the marquee rectangle or the snapping toggle in the canvas state', () => {
    const canvasState = {} as ReturnType<typeof useWorkspaceCanvasState>

    // @ts-expect-error -- selectionDraftUi is retired; subscribe with useCanvasInteraction (#738)
    expect(canvasState.selectionDraftUi).toBeUndefined()
    // @ts-expect-error -- setSelectionDraftUi is retired; write with setSelectionDraft (#738)
    expect(canvasState.setSelectionDraftUi).toBeUndefined()
    // @ts-expect-error -- magneticSnappingEnabledRef is retired; read useReadCanvasInteraction (#738)
    expect(canvasState.magneticSnappingEnabledRef).toBeUndefined()
    // @ts-expect-error -- magneticSnappingEnabled is retired; subscribe with useCanvasInteraction (#738)
    expect(canvasState.magneticSnappingEnabled).toBeUndefined()
    // @ts-expect-error -- setMagneticSnappingEnabled is retired; use toggleMagneticSnapping (#738)
    expect(canvasState.setMagneticSnappingEnabled).toBeUndefined()
  })

  // #738 (S6 of #647), the node drag overlay: the canvas state keeps no copy of the nodes of a
  // gesture and no guides. The live nodes and the guides live in the canvas store, and the flow
  // host and the guides overlay subscribe to them.
  it('do not keep a copy of the canvas nodes, the transient flag or the snap guides in the canvas state', () => {
    const canvasState = {} as ReturnType<typeof useWorkspaceCanvasState>

    // @ts-expect-error -- setCanvasNodes is retired; a drag frame writes publishLiveNodes (#738)
    expect(canvasState.setCanvasNodes).toBeUndefined()
    // @ts-expect-error -- snapGuides is retired; the guides overlay subscribes with useCanvasInteraction (#738)
    expect(canvasState.snapGuides).toBeUndefined()
    // @ts-expect-error -- setSnapGuides is retired; write with the setSnapGuides command (#738)
    expect(canvasState.setSnapGuides).toBeUndefined()
    // @ts-expect-error -- hasTransientNodePositionsRef is retired; read liveNodes from the store (#738)
    expect(canvasState.hasTransientNodePositionsRef).toBeUndefined()
  })

  // #738 (S6 of #647), the commit path: the node store keeps no mirror of the canvas view. The
  // change path and the writers read the document and the canvas store when they run.
  it('do not keep the canvas view in the node store', () => {
    const store = {} as UseWorkspaceCanvasNodesStoreResult

    // @ts-expect-error -- nodesRef is retired; read useReadCanvasDocument, write useCanvasNodeWriter (#738)
    expect(store.nodesRef).toBeUndefined()
  })

  it('do not hand the node store a gesture callback or a commit callback', () => {
    const params = {} as UseWorkspaceCanvasNodesStoreParams

    // @ts-expect-error -- onNodesCommitted is retired; a canvas write no longer ends the overlay (#738)
    expect(params.onNodesCommitted).toBeUndefined()
    // @ts-expect-error -- isLiveGestureActive is retired; a canvas write never reads live positions (#738)
    expect(params.isLiveGestureActive).toBeUndefined()
  })

  it('are not part of the canvas view props', () => {
    const props = {} as WorkspaceCanvasViewProps

    // @ts-expect-error -- snapGuides is retired; the guides overlay subscribes itself (#738)
    expect(props.snapGuides).toBeUndefined()
    // @ts-expect-error -- selectionDraft is retired; the draft overlay subscribes itself (#738)
    expect(props.selectionDraft).toBeUndefined()
    // @ts-expect-error -- magneticSnappingEnabled is retired; the menus subscribe themselves (#738)
    expect(props.magneticSnappingEnabled).toBeUndefined()
    // @ts-expect-error -- onToggleMagneticSnapping is retired; the menus call the command (#738)
    expect(props.onToggleMagneticSnapping).toBeUndefined()
  })

  // #738 (S6 of #647), PR 6: the Space drag's frame preview is in the `interaction` slice, and the
  // flow host reads it there. The hook returns its pointer handler only, and the host takes no
  // preview from Inner.
  it('do not keep the Space drag preview in the hook or in the host props', () => {
    const drag = {} as ReturnType<typeof useWorkspaceCanvasSpaceDrag>
    const hostProps = {} as ComponentProps<typeof CanvasFlowHost>

    // @ts-expect-error -- spaceFramePreview is retired; the host reads spaceDragFramePreview from the slice (#738)
    expect(drag.spaceFramePreview).toBeUndefined()
    // @ts-expect-error -- spaceDragFramePreview is retired as a prop; the host reads it from the slice (#738)
    expect(hostProps.spaceDragFramePreview).toBeUndefined()
  })
})
