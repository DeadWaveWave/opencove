import type { Node } from '@xyflow/react'
import type { Size, TerminalNodeData } from '../types'

export type WorkspaceCanonicalSizeBucket = 'compact' | 'regular' | 'large'

export const WORKSPACE_CANONICAL_GUTTER_PX = 12

const CANONICAL_BUCKETS: Record<WorkspaceCanonicalSizeBucket, { col: number; row: number }> = {
  compact: { col: 108, row: 72 },
  regular: { col: 120, row: 80 },
  large: { col: 132, row: 88 },
}

const KIND_UNITS: Record<TerminalNodeData['kind'], { col: number; row: number }> = {
  terminal: { col: 4, row: 4 },
  task: { col: 2, row: 4 },
  agent: { col: 4, row: 8 },
  note: { col: 2, row: 2 },
}

export function resolveCanonicalNodeGridSpan(kind: TerminalNodeData['kind']): {
  colSpan: number
  rowSpan: number
} {
  const units = KIND_UNITS[kind]
  return { colSpan: units.col, rowSpan: units.row }
}

const MIN_SIZE_BY_KIND: Record<TerminalNodeData['kind'], Size> = {
  terminal: { width: 400, height: 260 },
  task: { width: 220, height: 260 },
  agent: { width: 400, height: 520 },
  note: { width: 220, height: 140 },
}

const MAX_SIZE_BY_KIND: Record<TerminalNodeData['kind'], Size> = {
  terminal: { width: 720, height: 520 },
  task: { width: 360, height: 520 },
  agent: { width: 720, height: 1040 },
  note: { width: 360, height: 260 },
}

function clampSize(size: Size, min: Size, max: Size): Size {
  return {
    width: Math.max(min.width, Math.min(max.width, size.width)),
    height: Math.max(min.height, Math.min(max.height, size.height)),
  }
}

function resolveViewportSize(viewport?: Partial<Size>): Size {
  const fallbackWidth =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : 1440
  const fallbackHeight =
    typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0
      ? window.innerHeight
      : 900

  const width =
    typeof viewport?.width === 'number' && Number.isFinite(viewport.width) && viewport.width > 0
      ? Math.round(viewport.width)
      : Math.round(fallbackWidth)
  const height =
    typeof viewport?.height === 'number' && Number.isFinite(viewport.height) && viewport.height > 0
      ? Math.round(viewport.height)
      : Math.round(fallbackHeight)

  return { width, height }
}

export function resolveCanvasCanonicalBucketFromViewport(
  viewport?: Partial<Size>,
): WorkspaceCanonicalSizeBucket {
  const resolved = resolveViewportSize(viewport)

  if (resolved.width >= 1920 && resolved.height >= 1080) {
    return 'large'
  }

  if (resolved.width >= 1600 && resolved.height >= 900) {
    return 'regular'
  }

  return 'compact'
}

export function resolveCanonicalBucketCellSize(bucket: WorkspaceCanonicalSizeBucket): Size {
  const tokens = CANONICAL_BUCKETS[bucket]
  return { width: tokens.col, height: tokens.row }
}

export function resolveCanonicalNodeMinSize(kind: TerminalNodeData['kind']): Size {
  return MIN_SIZE_BY_KIND[kind]
}

export function resolveCanonicalNodeMaxSize(kind: TerminalNodeData['kind']): Size {
  return MAX_SIZE_BY_KIND[kind]
}

export function resolveCanonicalNodeSize({
  kind,
  bucket,
}: {
  kind: TerminalNodeData['kind']
  bucket: WorkspaceCanonicalSizeBucket
}): Size {
  const tokens = CANONICAL_BUCKETS[bucket]
  const units = KIND_UNITS[kind]
  const desired = {
    width: Math.round(
      tokens.col * units.col + WORKSPACE_CANONICAL_GUTTER_PX * Math.max(0, units.col - 1),
    ),
    height: Math.round(
      tokens.row * units.row + WORKSPACE_CANONICAL_GUTTER_PX * Math.max(0, units.row - 1),
    ),
  }

  return clampSize(desired, MIN_SIZE_BY_KIND[kind], MAX_SIZE_BY_KIND[kind])
}

export function resolveArrangeCanonicalBucket({
  nodes,
  nodeIdSet,
  viewport,
}: {
  nodes: Node<TerminalNodeData>[]
  nodeIdSet: Set<string>
  viewport?: Partial<Size>
}): WorkspaceCanonicalSizeBucket {
  const viewportBucket = resolveCanvasCanonicalBucketFromViewport(viewport)
  if (nodeIdSet.size === 0 || nodes.length === 0) {
    return viewportBucket
  }

  return viewportBucket
}

export function normalizeWorkspaceNodesToCanonicalSizing({
  nodes,
  enabled,
  nodeIdSet,
  bucket,
}: {
  nodes: Node<TerminalNodeData>[]
  enabled: boolean
  nodeIdSet: Set<string>
  bucket: WorkspaceCanonicalSizeBucket
}): { nodes: Node<TerminalNodeData>[]; didChange: boolean } {
  if (!enabled || nodeIdSet.size === 0) {
    return { nodes, didChange: false }
  }

  let didChange = false
  const nextNodes = nodes.map(node => {
    if (!nodeIdSet.has(node.id)) {
      return node
    }

    const desired = resolveCanonicalNodeSize({ kind: node.data.kind, bucket })
    if (node.data.width === desired.width && node.data.height === desired.height) {
      return node
    }

    didChange = true
    return {
      ...node,
      data: {
        ...node.data,
        width: desired.width,
        height: desired.height,
      },
    }
  })

  return didChange ? { nodes: nextNodes, didChange } : { nodes, didChange: false }
}
