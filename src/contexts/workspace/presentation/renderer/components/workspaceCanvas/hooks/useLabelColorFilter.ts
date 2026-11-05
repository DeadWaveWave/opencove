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
  spaces: _spaces,
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

  const projectLabel = React.useMemo(() => {
    const nodeCache = new WeakMap<Node<TerminalNodeData>, NodeWithEffectiveLabelColor>()
    const dataCache = new WeakMap<TerminalNodeData, NodeWithEffectiveLabelColor['data']>()
    return (node: Node<TerminalNodeData>): NodeWithEffectiveLabelColor => {
      const cached = nodeCache.get(node)
      if (cached) {
        return cached
      }
      const override = node.data.labelColorOverride ?? null
      const effectiveLabelColor = override && override !== 'none' ? override : null
      let data = dataCache.get(node.data)
      if (!data) {
        data = { ...node.data, effectiveLabelColor }
        dataCache.set(node.data, data)
      }
      const projected = {
        ...node,
        domAttributes: {
          ...node.domAttributes,
          'data-cove-label-color': effectiveLabelColor ?? undefined,
        },
        data,
      }
      nodeCache.set(node, projected)
      return projected
    }
  }, [])
  const nodesWithEffectiveLabelColor = React.useMemo(
    () => nodes.map(projectLabel),
    [nodes, projectLabel],
  )

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
