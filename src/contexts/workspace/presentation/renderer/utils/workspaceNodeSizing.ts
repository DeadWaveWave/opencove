import type { Node } from '@xyflow/react'
import type { WindowDisplayInfo } from '@shared/contracts/dto'
import type { Size, TerminalNodeData } from '../types'
export {
  WORKSPACE_CANONICAL_GUTTER_PX,
  resolveAgentNodeMinSize,
  resolveAgentNodeSize,
  resolveCanonicalBucketCellSize,
  resolveCanonicalNodeGridSpan,
  resolveCanonicalNodeMaxSize,
  resolveCanonicalNodeMinSize,
  resolveCanonicalNodeSize,
  resolveImageNodeSizeFromNaturalDimensions,
  type WorkspaceCanonicalSizeBucket,
} from '@contexts/workspace/domain/workspaceNodeSizing'
import {
  resolveCanonicalNodeMaxSize,
  resolveCanonicalNodeMinSize,
  resolveCanonicalNodeSize,
  resolveImageNodeSizeFromNaturalDimensions,
  type WorkspaceCanonicalSizeBucket,
} from '@contexts/workspace/domain/workspaceNodeSizing'

function clampSize(size: Size, min: Size, max: Size): Size {
  return {
    width: Math.max(min.width, Math.min(max.width, size.width)),
    height: Math.max(min.height, Math.min(max.height, size.height)),
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveAspectFitSizeWithinBounds({
  naturalWidth,
  naturalHeight,
  preferred,
  min,
  max,
}: {
  naturalWidth: number | null
  naturalHeight: number | null
  preferred: Size
  min: Size
  max: Size
}): Size {
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

export function resolveDocumentNodeSizeFromMediaMetadata({
  mediaKind,
  naturalWidth,
  naturalHeight,
  preferred,
}: {
  mediaKind: 'audio' | 'video'
  naturalWidth: number | null
  naturalHeight: number | null
  preferred: Size
}): Size {
  const min = resolveCanonicalNodeMinSize('document')
  const max = resolveCanonicalNodeMaxSize('document')

  if (mediaKind === 'audio') {
    return clampSize(
      {
        width: Math.max(preferred.width, 480),
        height: min.height,
      },
      min,
      max,
    )
  }

  return resolveAspectFitSizeWithinBounds({
    naturalWidth,
    naturalHeight,
    preferred,
    min,
    max,
  })
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
