import React from 'react'
import type { Edge, Node } from '@xyflow/react'
import { LABEL_COLORS, type LabelColor } from '@shared/types/labelColor'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'

type NodeWithEffectiveLabelColor = Node<TerminalNodeData> & {
  data: TerminalNodeData & { effectiveLabelColor?: LabelColor | null }
}

export function useWorkspaceCanvasLabelColorFilter({
  nodes,
  edges,
  spaces,
}: {
  nodes: Node<TerminalNodeData>[]
  edges: Edge[]
  spaces: WorkspaceSpaceState[]
}): {
  labelColorFilter: LabelColor | null
  setLabelColorFilter: React.Dispatch<React.SetStateAction<LabelColor | null>>
  usedLabelColors: LabelColor[]
  filteredNodes: NodeWithEffectiveLabelColor[]
  filteredEdges: Edge[]
} {
  const [labelColorFilter, setLabelColorFilter] = React.useState<LabelColor | null>(null)

  const inheritedLabelColorByNodeId = React.useMemo(() => {
    const map = new Map<string, LabelColor>()

    for (const space of spaces) {
      if (!space.labelColor) {
        continue
      }

      for (const nodeId of space.nodeIds) {
        if (!map.has(nodeId)) {
          map.set(nodeId, space.labelColor)
        }
      }
    }

    return map
  }, [spaces])

  const nodesWithEffectiveLabelColor = React.useMemo<NodeWithEffectiveLabelColor[]>(() => {
    return nodes.map(node => {
      const override = node.data.labelColorOverride ?? null
      const effectiveLabelColor: LabelColor | null =
        override === 'none'
          ? null
          : override
            ? override
            : (inheritedLabelColorByNodeId.get(node.id) ?? null)

      return {
        ...node,
        data: {
          ...node.data,
          effectiveLabelColor,
        },
      }
    })
  }, [inheritedLabelColorByNodeId, nodes])

  const usedLabelColors = React.useMemo(() => {
    const seen = new Set<LabelColor>()
    for (const node of nodesWithEffectiveLabelColor) {
      const color = node.data.effectiveLabelColor ?? null
      if (color) {
        seen.add(color)
      }
    }

    return LABEL_COLORS.filter(color => seen.has(color))
  }, [nodesWithEffectiveLabelColor])

  React.useEffect(() => {
    if (!labelColorFilter) {
      return
    }

    if (!usedLabelColors.includes(labelColorFilter)) {
      setLabelColorFilter(null)
    }
  }, [labelColorFilter, usedLabelColors])

  const filteredNodes = React.useMemo(() => {
    if (!labelColorFilter) {
      return nodesWithEffectiveLabelColor
    }

    return nodesWithEffectiveLabelColor.map(node => {
      const effectiveLabelColor = node.data.effectiveLabelColor ?? null
      if (effectiveLabelColor === labelColorFilter) {
        return node
      }

      const className =
        typeof node.className === 'string' && node.className.trim().length > 0
          ? `${node.className} cove-node--filtered-out`
          : 'cove-node--filtered-out'

      return {
        ...node,
        className,
        style: {
          ...node.style,
          pointerEvents: 'none' as const,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      }
    })
  }, [labelColorFilter, nodesWithEffectiveLabelColor])

  const filteredEdges = React.useMemo(() => {
    if (!labelColorFilter) {
      return edges
    }

    const allowedNodeIds = new Set(
      nodesWithEffectiveLabelColor
        .filter(node => (node.data.effectiveLabelColor ?? null) === labelColorFilter)
        .map(node => node.id),
    )

    return edges.filter(edge => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target))
  }, [edges, labelColorFilter, nodesWithEffectiveLabelColor])

  return {
    labelColorFilter,
    setLabelColorFilter,
    usedLabelColors,
    filteredNodes,
    filteredEdges,
  }
}
