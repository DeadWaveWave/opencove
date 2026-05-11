import type { LabelColor } from '../../../shared/types/labelColor'
import type { SpaceBoundary } from '../../../shared/types/spaceBoundary'
import type { RectLike } from './spaceContainment'
import { clampRectInsideRect } from './spaceContainment'
import {
  createBoundaryFromSpaceProjection,
  deriveDirectoryPathFromBoundary,
} from './spaceBoundaryPolicy'

export interface ChildSpaceRecord {
  id: string
  name: string
  directoryPath: string
  targetMountId: string | null
  parentSpaceId?: string | null
  boundary?: SpaceBoundary | null
  sortOrder?: number
  labelColor: LabelColor | null
  nodeIds: string[]
  rect: RectLike | null
}

export interface ChildSpaceNodeFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface CreateChildSpaceInput {
  parentSpaceId: string
  name?: string | null
  initialNodeIds?: string[] | null
  rect?: RectLike | null
  anchor?: { x: number; y: number } | null
}

export type CreateChildSpaceFailureCode =
  | 'parent_not_found'
  | 'parent_missing_rect'
  | 'nested_parent_not_allowed'
  | 'nodes_not_in_parent'
  | 'invalid_rect'

export type CreateChildSpaceResult<TSpace extends ChildSpaceRecord> =
  | {
      ok: true
      childSpace: TSpace
      nextSpaces: TSpace[]
      movedNodeIds: string[]
    }
  | {
      ok: false
      code: CreateChildSpaceFailureCode
    }

const CHILD_SPACE_PADDING = 18
const DEFAULT_CHILD_SPACE_WIDTH = 420
const DEFAULT_CHILD_SPACE_HEIGHT = 300

function normalizeNodeIds(nodeIds: string[] | null | undefined): string[] {
  if (!Array.isArray(nodeIds)) {
    return []
  }

  return [
    ...new Set(
      nodeIds.map(nodeId => (typeof nodeId === 'string' ? nodeId.trim() : '')).filter(Boolean),
    ),
  ]
}

function resolveRectFromNodeFrames(nodeFrames: ChildSpaceNodeFrame[]): RectLike | null {
  if (nodeFrames.length === 0) {
    return null
  }

  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const frame of nodeFrames) {
    left = Math.min(left, frame.x)
    top = Math.min(top, frame.y)
    right = Math.max(right, frame.x + frame.width)
    bottom = Math.max(bottom, frame.y + frame.height)
  }

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom)
  ) {
    return null
  }

  return {
    x: left - CHILD_SPACE_PADDING,
    y: top - CHILD_SPACE_PADDING,
    width: Math.max(DEFAULT_CHILD_SPACE_WIDTH, right - left + CHILD_SPACE_PADDING * 2),
    height: Math.max(DEFAULT_CHILD_SPACE_HEIGHT, bottom - top + CHILD_SPACE_PADDING * 2),
  }
}

function resolveDefaultRect(parentRect: RectLike, anchor?: { x: number; y: number } | null) {
  const resolvedAnchor = anchor ?? {
    x: parentRect.x + parentRect.width / 2,
    y: parentRect.y + parentRect.height / 2,
  }

  return {
    x: Math.round(resolvedAnchor.x - DEFAULT_CHILD_SPACE_WIDTH / 2),
    y: Math.round(resolvedAnchor.y - DEFAULT_CHILD_SPACE_HEIGHT / 2),
    width: DEFAULT_CHILD_SPACE_WIDTH,
    height: DEFAULT_CHILD_SPACE_HEIGHT,
  }
}

function normalizeRect(rect: RectLike | null | undefined): RectLike | null {
  if (!rect) {
    return null
  }

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null
  }

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function resolveChildName<TSpace extends ChildSpaceRecord>(options: {
  spaces: TSpace[]
  countSeed: number
  requestedName?: string | null
  defaultName: (count: number) => string
}): string {
  const requestedName = options.requestedName?.trim()
  if (requestedName) {
    return requestedName
  }

  const usedNames = new Set(options.spaces.map(space => space.name.toLowerCase()))
  let count = options.countSeed
  let candidate = options.defaultName(count)
  while (usedNames.has(candidate.toLowerCase())) {
    count += 1
    candidate = options.defaultName(count)
  }

  return candidate
}

export function createChildSpace<TSpace extends ChildSpaceRecord>(options: {
  spaces: TSpace[]
  nodeFrames: ChildSpaceNodeFrame[]
  workspacePath: string
  input: CreateChildSpaceInput
  createId: () => string
  defaultName: (count: number) => string
  allowNestedParent?: boolean
}): CreateChildSpaceResult<TSpace> {
  const parent = options.spaces.find(space => space.id === options.input.parentSpaceId) ?? null
  if (!parent) {
    return { ok: false, code: 'parent_not_found' }
  }

  if (!options.allowNestedParent && parent.parentSpaceId) {
    return { ok: false, code: 'nested_parent_not_allowed' }
  }

  if (!parent.rect) {
    return { ok: false, code: 'parent_missing_rect' }
  }

  const nodeFrameById = new Map(options.nodeFrames.map(frame => [frame.id, frame] as const))
  const requestedNodeIds = normalizeNodeIds(options.input.initialNodeIds)
  const parentNodeIdSet = new Set(parent.nodeIds)
  if (requestedNodeIds.some(nodeId => !parentNodeIdSet.has(nodeId))) {
    return { ok: false, code: 'nodes_not_in_parent' }
  }

  const movedNodeIds = requestedNodeIds.filter(nodeId => nodeFrameById.has(nodeId))
  const selectedNodeFrames = movedNodeIds.map(nodeId => nodeFrameById.get(nodeId)!)
  const requestedRect = normalizeRect(options.input.rect)
  const desiredRect =
    requestedRect ??
    resolveRectFromNodeFrames(selectedNodeFrames) ??
    resolveDefaultRect(parent.rect, options.input.anchor)

  if (!desiredRect) {
    return { ok: false, code: 'invalid_rect' }
  }

  const rect = clampRectInsideRect(desiredRect, parent.rect, CHILD_SPACE_PADDING)
  const boundary = createBoundaryFromSpaceProjection(parent)
  const directoryPath = deriveDirectoryPathFromBoundary(
    {
      ...parent,
      boundary,
    },
    options.workspacePath,
  )
  const childId = options.createId()
  const childSpace = {
    id: childId,
    name: resolveChildName({
      spaces: options.spaces,
      countSeed: options.spaces.filter(space => space.parentSpaceId === parent.id).length + 1,
      requestedName: options.input.name,
      defaultName: options.defaultName,
    }),
    directoryPath,
    targetMountId: parent.targetMountId ?? null,
    parentSpaceId: parent.id,
    boundary,
    sortOrder:
      Math.max(
        -1,
        ...options.spaces.map(space =>
          typeof space.sortOrder === 'number' && Number.isFinite(space.sortOrder)
            ? Math.floor(space.sortOrder)
            : -1,
        ),
      ) + 1,
    labelColor: null,
    nodeIds: movedNodeIds,
    rect,
  } as TSpace

  const movedNodeIdSet = new Set(movedNodeIds)
  const nextSpaces = [
    ...options.spaces.map(space => ({
      ...space,
      nodeIds: space.nodeIds.filter(nodeId => !movedNodeIdSet.has(nodeId)),
    })),
    childSpace,
  ] as TSpace[]

  return {
    ok: true,
    childSpace,
    nextSpaces,
    movedNodeIds,
  }
}
