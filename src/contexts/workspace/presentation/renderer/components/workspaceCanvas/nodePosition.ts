import { useStore, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'

export function useNodePosition(nodeId: string): { x: number; y: number } {
  return useStore(storeState => {
    const state = storeState as unknown as {
      nodeLookup?: { get?: unknown }
      nodeInternals?: { get?: unknown }
      nodes?: Array<Node<TerminalNodeData>>
    }

    const lookup = state.nodeLookup ?? state.nodeInternals
    if (lookup && typeof lookup.get === 'function') {
      const node = (lookup as Map<string, Node<TerminalNodeData>>).get(nodeId) ?? null
      if (node) {
        return node.position
      }
    }

    return state.nodes?.find(node => node.id === nodeId)?.position ?? { x: 0, y: 0 }
  })
}
