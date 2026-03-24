import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { WindowDisplayInfo } from '@shared/contracts/dto'
import type { Size, TerminalNodeData } from '../types'

export type WorkspaceCanonicalSizeBucket = StandardWindowSizeBucket

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
  image: { col: 3, row: 3 },
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
  image: { width: 180, height: 120 },
}

const MAX_SIZE_BY_KIND: Record<TerminalNodeData['kind'], Size> = {
  terminal: { width: 720, height: 520 },
  task: { width: 360, height: 520 },
  agent: { width: 720, height: 1040 },
  note: { width: 360, height: 260 },
  image: { width: 960, height: 720 },
}

function clampSize(size: Size, min: Size, max: Size): Size {
  return {
    width: Math.max(min.width, Math.min(max.width, size.width)),
    height: Math.max(min.height, Math.min(max.height, size.height)),
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function resolveDisplayAwareViewportSize(
  viewport?: Partial<Size>,
  displayInfo?: WindowDisplayInfo | null,
): Size {
  if (
    displayInfo &&
    Number.isFinite(displayInfo.effectiveWidthPx) &&
    displayInfo.effectiveWidthPx > 0 &&
    Number.isFinite(displayInfo.effectiveHeightPx) &&
    displayInfo.effectiveHeightPx > 0
  ) {
    return {
      width: Math.round(displayInfo.effectiveWidthPx),
      height: Math.round(displayInfo.effectiveHeightPx),
    }
  }

  return resolveViewportSize(viewport)
}

export function resolveCanvasCanonicalBucketFromViewport(
  viewport?: Partial<Size>,
  displayInfo?: WindowDisplayInfo | null,
): WorkspaceCanonicalSizeBucket {
  const resolved = resolveDisplayAwareViewportSize(viewport, displayInfo)

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

export function resolveImageNodeSizeFromNaturalDimensions({
  naturalWidth,
  naturalHeight,
  preferred,
}: {
  naturalWidth: number | null
  naturalHeight: number | null
  preferred: Size
}): Size {
  const min = resolveCanonicalNodeMinSize('image')
  const max = resolveCanonicalNodeMaxSize('image')

  if (
    typeof naturalWidth !== 'number' ||
    !Number.isFinite(naturalWidth) ||
    naturalWidth <= 0 ||
    typeof naturalHeight !== 'number' ||
    !Number.isFinite(naturalHeight) ||
    naturalHeight <= 0
  ) {
    return clampSize(preferred, min, max)
  }

  const aspectRatio = naturalWidth / naturalHeight
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return clampSize(preferred, min, max)
  }

  const preferredRatio =
    Number.isFinite(preferred.width) &&
    Number.isFinite(preferred.height) &&
    preferred.width > 0 &&
    preferred.height > 0
      ? preferred.width / preferred.height
      : 1

  const baseSize =
    aspectRatio >= preferredRatio
      ? {
          width: preferred.width,
          height: preferred.width / aspectRatio,
        }
      : {
          width: preferred.height * aspectRatio,
          height: preferred.height,
        }

  if (!Number.isFinite(baseSize.width) || !Number.isFinite(baseSize.height)) {
    return clampSize(preferred, min, max)
  }

  if (baseSize.width <= 0 || baseSize.height <= 0) {
    return clampSize(preferred, min, max)
  }

  const minScale = Math.max(min.width / baseSize.width, min.height / baseSize.height)
  const maxScale = Math.min(max.width / baseSize.width, max.height / baseSize.height)

  if (!Number.isFinite(minScale) || !Number.isFinite(maxScale) || minScale > maxScale) {
    return clampSize(
      {
        width: Math.round(baseSize.width),
        height: Math.round(baseSize.height),
      },
      min,
      max,
    )
  }

  const scale = clampNumber(1, minScale, maxScale)

  return clampSize(
    {
      width: Math.round(baseSize.width * scale),
      height: Math.round(baseSize.height * scale),
    },
    min,
    max,
  )
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

    const canonicalDesired = resolveCanonicalNodeSize({ kind: node.data.kind, bucket })
    const desired =
      node.data.kind === 'image'
        ? (() => {
            const image = node.data.image
            const naturalAspectRatio =
              image &&
              typeof image.naturalWidth === 'number' &&
              Number.isFinite(image.naturalWidth) &&
              image.naturalWidth > 0 &&
              typeof image.naturalHeight === 'number' &&
              Number.isFinite(image.naturalHeight) &&
              image.naturalHeight > 0
                ? image.naturalWidth / image.naturalHeight
                : null
            const fallbackAspectRatio =
              typeof node.data.width === 'number' &&
              Number.isFinite(node.data.width) &&
              node.data.width > 0 &&
              typeof node.data.height === 'number' &&
              Number.isFinite(node.data.height) &&
              node.data.height > 0
                ? node.data.width / node.data.height
                : null
            const aspectRatio = naturalAspectRatio ?? fallbackAspectRatio

            if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
              return canonicalDesired
            }

            return resolveImageNodeSizeFromNaturalDimensions({
              naturalWidth: aspectRatio,
              naturalHeight: 1,
              preferred: canonicalDesired,
            })
          })()
        : canonicalDesired

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
