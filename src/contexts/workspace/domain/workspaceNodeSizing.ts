import type { AgentProvider, StandardWindowSizeBucket } from '../../settings/domain/agentSettings'

export type WorkspaceCanonicalSizeBucket = StandardWindowSizeBucket

export type WorkspaceNodeKind =
  | 'terminal'
  | 'agent'
  | 'task'
  | 'note'
  | 'image'
  | 'document'
  | 'website'

export interface Size {
  width: number
  height: number
}

export const WORKSPACE_CANONICAL_GUTTER_PX = 12

const CANONICAL_BUCKETS: Record<WorkspaceCanonicalSizeBucket, { col: number; row: number }> = {
  compact: { col: 108, row: 72 },
  regular: { col: 120, row: 80 },
  large: { col: 132, row: 88 },
}

const KIND_UNITS: Record<WorkspaceNodeKind, { col: number; row: number }> = {
  terminal: { col: 4, row: 4 },
  task: { col: 2, row: 4 },
  agent: { col: 4, row: 8 },
  note: { col: 2, row: 2 },
  image: { col: 3, row: 3 },
  document: { col: 4, row: 6 },
  website: { col: 4, row: 6 },
}

const MIN_SIZE_BY_KIND: Record<WorkspaceNodeKind, Size> = {
  terminal: { width: 400, height: 260 },
  task: { width: 220, height: 260 },
  agent: { width: 400, height: 520 },
  note: { width: 220, height: 140 },
  image: { width: 180, height: 120 },
  document: { width: 400, height: 260 },
  website: { width: 400, height: 260 },
}

const MAX_SIZE_BY_KIND: Record<WorkspaceNodeKind, Size> = {
  terminal: { width: 720, height: 520 },
  task: { width: 360, height: 520 },
  agent: { width: 720, height: 1040 },
  note: { width: 360, height: 260 },
  image: { width: 960, height: 720 },
  document: { width: 960, height: 900 },
  website: { width: 960, height: 900 },
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

export function resolveCanonicalNodeGridSpan(kind: WorkspaceNodeKind): {
  colSpan: number
  rowSpan: number
} {
  const units = KIND_UNITS[kind]
  return { colSpan: units.col, rowSpan: units.row }
}

export function resolveCanonicalBucketCellSize(bucket: WorkspaceCanonicalSizeBucket): Size {
  const tokens = CANONICAL_BUCKETS[bucket]
  return { width: tokens.col, height: tokens.row }
}

export function resolveCanonicalNodeMinSize(kind: WorkspaceNodeKind): Size {
  return MIN_SIZE_BY_KIND[kind]
}

export function resolveAgentNodeMinSize(_provider?: AgentProvider | null): Size {
  return resolveCanonicalNodeMinSize('agent')
}

export function resolveCanonicalNodeMaxSize(kind: WorkspaceNodeKind): Size {
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
  kind: WorkspaceNodeKind
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

export function resolveAgentNodeSize({
  bucket,
}: {
  bucket: WorkspaceCanonicalSizeBucket
  provider?: AgentProvider | null
}): Size {
  const base = resolveCanonicalNodeSize({ kind: 'agent', bucket })
  const min = resolveAgentNodeMinSize()
  const max = resolveCanonicalNodeMaxSize('agent')

  return clampSize(
    {
      width: Math.max(base.width, min.width),
      height: Math.max(base.height, min.height),
    },
    min,
    max,
  )
}
