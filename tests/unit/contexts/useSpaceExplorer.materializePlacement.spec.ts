import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { repositionCreatedExplorerNode } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer.materializePlacement'
import type { WorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocument'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import type { NodeCreationPlacementOptions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { UseWorkspaceCanvasNodesStoreResult } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'

function createdNode(position: { x: number; y: number }): Node<TerminalNodeData> {
  return {
    id: 'created',
    position,
    data: { width: 100, height: 100 },
  } as unknown as Node<TerminalNodeData>
}

function run({
  created,
  nodes,
  placement,
}: {
  created: Node<TerminalNodeData>
  nodes: Node<TerminalNodeData>[]
  placement: NodeCreationPlacementOptions
}) {
  const setNodes = vi.fn()
  const returned = repositionCreatedExplorerNode({
    created,
    creationAnchor: { ...created.position },
    creationPlacement: placement,
    readDocument: () => ({ nodes }) as unknown as WorkspaceDocument,
    setNodes: setNodes as unknown as UseWorkspaceCanvasNodesStoreResult['setNodes'],
  })
  return { returned, setNodes }
}

describe('repositionCreatedExplorerNode', () => {
  it('returns the node as stored after the reposition moves it', () => {
    const created = createdNode({ x: 10, y: 10 })
    const { returned, setNodes } = run({
      created,
      nodes: [created],
      placement: {
        preferredDirection: 'right',
        avoidRects: [{ x: 10, y: 10, width: 100, height: 100 }],
      },
    })
    // The avoid rect covers the created rect, so the scan looks for the nearest free spot: it
    // holds x and scans y first (down before up, one 24px grid step at a time), landing at
    // y = 10 + 5 * 24 = 130, clear of the rect's bottom edge at 110.
    expect(returned.position).toEqual({ x: 10, y: 130 })
    expect(setNodes).toHaveBeenCalledOnce()
    const updater = setNodes.mock.calls[0][0] as (
      previous: Node<TerminalNodeData>[],
    ) => Node<TerminalNodeData>[]
    expect(updater([created]).find(node => node.id === 'created')?.position).toEqual({
      x: 10,
      y: 130,
    })
  })

  it('returns the created node unchanged when its position is already free', () => {
    const created = createdNode({ x: 10, y: 10 })
    const { returned, setNodes } = run({
      created,
      nodes: [created],
      placement: {
        preferredDirection: 'right',
        avoidRects: [{ x: 500, y: 500, width: 100, height: 100 }],
      },
    })
    expect(returned).toBe(created)
    expect(setNodes).not.toHaveBeenCalled()
  })

  it('returns the created node unchanged when the placement does not ask for a move', () => {
    const created = createdNode({ x: 10, y: 10 })
    const { returned, setNodes } = run({
      created,
      nodes: [created],
      placement: {
        preferredDirection: 'down',
        avoidRects: [{ x: 10, y: 10, width: 100, height: 100 }],
      },
    })
    expect(returned).toBe(created)
    expect(setNodes).not.toHaveBeenCalled()
  })
})
