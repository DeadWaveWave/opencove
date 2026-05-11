import { randomUUID } from 'node:crypto'
import type { ControlSurface } from '../controlSurface'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  CanvasNodeKind,
  CanvasNodeSummary,
  CreateChildSpaceInput as CreateChildSpaceDtoInput,
  CreateChildSpaceResult,
  GetSpaceInput,
  GetSpaceResult,
  ListSpacesInput,
  ListSpacesResult,
} from '../../../../shared/contracts/dto'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import { createChildSpace } from '../../../../contexts/space/application/createChildSpace'
import type {
  NormalizedPersistedNode,
  NormalizedPersistedSpace,
} from '../../../../platform/persistence/sqlite/normalize'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizeCanvasNodeKind(kind: unknown): CanvasNodeKind {
  switch (kind) {
    case 'terminal':
    case 'agent':
    case 'task':
    case 'note':
    case 'image':
    case 'document':
    case 'website':
      return kind
    default:
      return 'unknown'
  }
}

function toNodeSummary(node: {
  id: string
  kind: unknown
  title: unknown
  status?: unknown
}): CanvasNodeSummary {
  return {
    id: node.id,
    kind: normalizeCanvasNodeKind(node.kind),
    title: typeof node.title === 'string' ? node.title : '',
    ...(typeof node.status === 'string' || node.status === null ? { status: node.status } : {}),
  }
}

type NodeSummaryInput = Parameters<typeof toNodeSummary>[0]

function normalizeListSpacesPayload(payload: unknown): ListSpacesInput {
  if (payload === null || payload === undefined) {
    return { projectId: null }
  }

  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.list.',
    })
  }

  const projectIdRaw = payload.projectId
  if (projectIdRaw === null || projectIdRaw === undefined) {
    return { projectId: null }
  }

  if (typeof projectIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.list projectId.',
    })
  }

  const projectId = projectIdRaw.trim()
  if (projectId.length === 0) {
    return { projectId: null }
  }

  return { projectId }
}

function normalizeGetSpacePayload(payload: unknown): GetSpaceInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.get.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.get spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for space.get spaceId.',
    })
  }

  return { spaceId }
}

function normalizeOptionalIdArray(value: unknown, operationId: string): string[] | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} initialNodeIds.`,
    })
  }

  return [
    ...new Set(
      value
        .map(item => {
          if (typeof item !== 'string') {
            throw createAppError('common.invalid_input', {
              debugMessage: `Invalid payload for ${operationId} initialNodeIds item.`,
            })
          }
          return item.trim()
        })
        .filter(Boolean),
    ),
  ]
}

function normalizeRect(
  value: unknown,
  operationId: string,
): { x: number; y: number; width: number; height: number } | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} rect.`,
    })
  }

  if (
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} rect fields.`,
    })
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }
}

function normalizeAnchor(value: unknown, operationId: string): { x: number; y: number } | null {
  if (value === undefined || value === null) {
    return null
  }

  if (
    !isRecord(value) ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} anchor.`,
    })
  }

  return { x: value.x, y: value.y }
}

function normalizeCreateChildPayload(payload: unknown): CreateChildSpaceDtoInput {
  const operationId = 'space.createChild'
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  const parentSpaceIdRaw = payload.parentSpaceId
  if (typeof parentSpaceIdRaw !== 'string' || parentSpaceIdRaw.trim().length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} parentSpaceId.`,
    })
  }

  const projectIdRaw = payload.projectId
  if (projectIdRaw !== undefined && projectIdRaw !== null && typeof projectIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} projectId.`,
    })
  }

  const nameRaw = payload.name
  if (nameRaw !== undefined && nameRaw !== null && typeof nameRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} name.`,
    })
  }

  return {
    parentSpaceId: parentSpaceIdRaw.trim(),
    projectId: typeof projectIdRaw === 'string' && projectIdRaw.trim() ? projectIdRaw.trim() : null,
    name: typeof nameRaw === 'string' ? nameRaw.trim() : null,
    initialNodeIds: normalizeOptionalIdArray(payload.initialNodeIds, operationId),
    rect: normalizeRect(payload.rect, operationId),
    anchor: normalizeAnchor(payload.anchor, operationId),
  }
}

function toSpaceDto(space: NormalizedPersistedSpace, nodeById: Map<string, NodeSummaryInput>) {
  return {
    id: space.id,
    name: space.name,
    directoryPath: space.directoryPath,
    targetMountId: space.targetMountId,
    parentSpaceId: space.parentSpaceId,
    boundary: space.boundary,
    sortOrder: space.sortOrder,
    nodeIds: space.nodeIds,
    nodes: space.nodeIds.map(nodeId => {
      const node = nodeById.get(nodeId)
      return node ? toNodeSummary(node) : { id: nodeId, kind: 'unknown' as const, title: '' }
    }),
  }
}

function applyChildDirectoryExpectationToMovedNodes({
  nodes,
  movedNodeIds,
  nextDirectoryPath,
  workspacePath,
}: {
  nodes: NormalizedPersistedNode[]
  movedNodeIds: string[]
  nextDirectoryPath: string
  workspacePath: string
}): NormalizedPersistedNode[] {
  if (movedNodeIds.length === 0) {
    return nodes
  }

  const movedNodeIdSet = new Set(movedNodeIds)
  return nodes.map(node => {
    if (!movedNodeIdSet.has(node.id)) {
      return node
    }

    if (node.kind === 'agent' && isRecord(node.agent)) {
      return {
        ...node,
        expectedDirectory: nextDirectoryPath,
        agent: {
          ...node.agent,
          expectedDirectory: nextDirectoryPath,
        },
      }
    }

    if (node.kind === 'terminal') {
      const executionDirectory =
        typeof node.executionDirectory === 'string' && node.executionDirectory.trim().length > 0
          ? node.executionDirectory
          : workspacePath

      return {
        ...node,
        executionDirectory,
        expectedDirectory: nextDirectoryPath,
      }
    }

    return node
  })
}

export function registerSpaceHandlers(
  controlSurface: ControlSurface,
  getPersistenceStore: () => Promise<PersistenceStore>,
): void {
  controlSurface.register('space.list', {
    kind: 'query',
    validate: normalizeListSpacesPayload,
    handle: async (_ctx, payload): Promise<ListSpacesResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())

      const activeProjectId = normalized?.activeWorkspaceId ?? null
      const requestedProjectId = payload.projectId ?? null
      const effectiveProjectId = requestedProjectId ?? activeProjectId

      const workspace =
        effectiveProjectId && normalized
          ? (normalized.workspaces.find(item => item.id === effectiveProjectId) ?? null)
          : null

      const nodeById = new Map((workspace?.nodes ?? []).map(node => [node.id, node]))

      return {
        projectId: workspace?.id ?? effectiveProjectId,
        activeSpaceId: workspace?.activeSpaceId ?? null,
        spaces: (workspace?.spaces ?? []).map(space => toSpaceDto(space, nodeById)),
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('space.get', {
    kind: 'query',
    validate: normalizeGetSpacePayload,
    handle: async (_ctx, payload): Promise<GetSpaceResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspaces = normalized?.workspaces ?? []

      for (const workspace of workspaces) {
        const space = workspace.spaces.find(candidate => candidate.id === payload.spaceId) ?? null
        if (!space) {
          continue
        }

        const nodeById = new Map(workspace.nodes.map(node => [node.id, node]))
        return {
          projectId: workspace.id,
          activeSpaceId: workspace.activeSpaceId,
          space: toSpaceDto(space, nodeById),
        }
      }

      throw createAppError('space.not_found', {
        debugMessage: `space.get: unknown space id: ${payload.spaceId}`,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('space.createChild', {
    kind: 'command',
    validate: normalizeCreateChildPayload,
    handle: async (_ctx, payload): Promise<CreateChildSpaceResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      if (!normalized) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'space.createChild requires an app state.',
        })
      }

      const requestedProjectId = payload.projectId ?? null
      const workspace =
        normalized.workspaces.find(item =>
          requestedProjectId
            ? item.id === requestedProjectId
            : item.spaces.some(space => space.id === payload.parentSpaceId),
        ) ?? null

      if (!workspace) {
        throw createAppError('space.not_found', {
          debugMessage: `space.createChild: unknown parent space id: ${payload.parentSpaceId}`,
        })
      }

      const result = createChildSpace({
        spaces: workspace.spaces,
        workspacePath: workspace.path,
        nodeFrames: workspace.nodes.map(node => ({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          width: node.width,
          height: node.height,
        })),
        input: payload,
        createId: () => randomUUID(),
        defaultName: count => `Child Space ${count}`,
      })

      if (!result.ok) {
        const code = result.code === 'parent_not_found' ? 'space.not_found' : 'common.invalid_input'
        throw createAppError(code, {
          debugMessage: `space.createChild failed: ${result.code}`,
        })
      }

      const nextNodes = applyChildDirectoryExpectationToMovedNodes({
        nodes: workspace.nodes,
        movedNodeIds: result.movedNodeIds,
        nextDirectoryPath: result.childSpace.directoryPath,
        workspacePath: workspace.path,
      })

      const nextState = {
        ...normalized,
        workspaces: normalized.workspaces.map(candidate =>
          candidate.id === workspace.id
            ? {
                ...candidate,
                nodes: nextNodes,
                spaces: result.nextSpaces,
              }
            : candidate,
        ),
      }

      const writeResult = await store.writeAppState(nextState)
      if (!writeResult.ok) {
        throw createAppError(writeResult.error)
      }

      const nodeById = new Map(nextNodes.map(node => [node.id, node]))

      return {
        projectId: workspace.id,
        activeSpaceId: workspace.activeSpaceId,
        childSpace: {
          ...toSpaceDto(result.childSpace, nodeById),
          rect: result.childSpace.rect,
        },
        movedNodeIds: result.movedNodeIds,
      }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
