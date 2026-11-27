import type { Node } from '@xyflow/react'
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
} from '../../support/canvasDocumentHarness'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

function createNode(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
): Node<TerminalNodeData> {
  return {
    id,
    position,
    data: {
      width: size.width,
      height: size.height,
    } as TerminalNodeData,
  }
}

describe('assignNodeToSpaceAndExpand', () => {
  it('derives containment from the node the store holds when the rendered node ref is stale', () => {
    const space: WorkspaceSpaceState = {
      id: 'tiny-space',
      name: 'Tiny Space',
      directoryPath: '/workspace',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['seed-note'],
      rect: { x: 200, y: 200, width: 480, height: 320 },
    }
    const seedNote = createNode('seed-note', { x: 240, y: 240 }, { width: 420, height: 280 })
    const createdTerminal = createNode(
      'created-terminal',
      { x: -140, y: -40 },
      { width: 720, height: 520 },
    )
    // Models the async launch gap: the creator's first copy of the node is stale, and the store
    // holds the node as it is now. The assignment measures the store's node (#758); a caller
    // copy that predates #758 is passed untyped and must be ignored.
    const staleCallerCopy = createNode(
      createdTerminal.id,
      { x: 300, y: 300 },
      { width: 100, height: 100 },
    )
    const harness = createCanvasDocumentHarness({
      nodes: [seedNote, createdTerminal],
      spaces: [space],
    })
    const view = renderCanvasNodeStore(harness)

    act(() => {
      assignNodeToSpaceAndExpand({
        workspaceId: harness.workspaceId,
        createdNodeId: createdTerminal.id,
        targetSpaceId: space.id,
        updateCanvasDocument: view.result.current.nodeStore.updateCanvasDocument,
        ...({ createdNode: staleCallerCopy } as object),
      })
    })

    expect(harness.readStoreDocument().spaces).toEqual([
      expect.objectContaining({
        id: 'tiny-space',
        nodeIds: ['seed-note', 'created-terminal'],
        rect: { x: -164, y: -64, width: 848, height: 608 },
      }),
    ])
  })

  // Batch creation: the second assignment reads the Spaces the first one wrote in the same call.
  it('reads the Spaces of the previous assignment when two nodes are assigned in one call', () => {
    const space: WorkspaceSpaceState = {
      id: 'tiny-space',
      name: 'Tiny Space',
      directoryPath: '/workspace',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['seed-note'],
      rect: { x: 200, y: 200, width: 480, height: 320 },
    }
    const seedNote = createNode('seed-note', { x: 240, y: 240 }, { width: 420, height: 280 })
    const first = createNode('first', { x: -140, y: -40 }, { width: 720, height: 520 })
    const second = createNode('second', { x: 900, y: 100 }, { width: 300, height: 200 })
    const harness = createCanvasDocumentHarness({
      nodes: [seedNote, first, second],
      spaces: [space],
    })
    const view = renderCanvasNodeStore(harness)

    act(() => {
      for (const created of [first, second]) {
        assignNodeToSpaceAndExpand({
          workspaceId: harness.workspaceId,
          createdNodeId: created.id,
          targetSpaceId: space.id,
          updateCanvasDocument: view.result.current.nodeStore.updateCanvasDocument,
        })
      }
    })

    const [stored] = harness.readStoreDocument().spaces
    expect(stored.nodeIds).toEqual(['seed-note', 'first', 'second'])
    expect(stored.rect!.x + stored.rect!.width).toBeGreaterThanOrEqual(1200)
    expect(stored.rect!.x).toBeLessThanOrEqual(-140)
  })
})
