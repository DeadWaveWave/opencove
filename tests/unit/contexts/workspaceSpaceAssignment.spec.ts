import type { Node } from '@xyflow/react'
import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { replaceWorkspaceSpaces } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
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
  it('derives containment from the exact created node when the rendered node ref is stale', () => {
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
    const spacesRef = { current: [space] }
    // Models the async launch gap: React has committed the previous projection, so the
    // just-created node is not present in nodesRef even though node creation returned it.
    const nodesRef = { current: [seedNote] }
    const onSpacesChange = vi.fn()

    assignNodeToSpaceAndExpand({
      createdNodeId: createdTerminal.id,
      createdNode: createdTerminal,
      targetSpaceId: space.id,
      spacesRef,
      nodesRef,
      setNodes: vi.fn(),
      onSpacesChange,
    })

    expect(onSpacesChange).toHaveBeenCalledWith([
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
          createdNode: created,
          targetSpaceId: space.id,
          spacesRef: view.result.current.canvasState.spacesRef,
          nodesRef: view.result.current.nodeStore.nodesRef,
          setNodes: view.result.current.nodeStore.setNodes,
          onSpacesChange: spaces => replaceWorkspaceSpaces(harness.workspaceId, spaces),
        })
      }
    })

    const [stored] = harness.readStoreDocument().spaces
    expect(stored.nodeIds).toEqual(['seed-note', 'first', 'second'])
    expect(stored.rect!.x + stored.rect!.width).toBeGreaterThanOrEqual(1200)
    expect(stored.rect!.x).toBeLessThanOrEqual(-140)
  })
})
