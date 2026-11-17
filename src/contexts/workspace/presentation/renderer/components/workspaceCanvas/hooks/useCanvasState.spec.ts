import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasProps } from '../types'
import type { useWorkspaceCanvasState } from './useCanvasState'
import type { UseWorkspaceCanvasNodesStoreParams } from './useNodesStore.types'

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
})
