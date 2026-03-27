import type { ControlSurface } from '../controlSurface'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  CanvasNodeKind,
  CanvasNodeSummary,
  GetSpaceInput,
  GetSpaceResult,
  ListSpacesInput,
  ListSpacesResult,
} from '../../../../shared/contracts/dto'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'

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
        spaces: (workspace?.spaces ?? []).map(space => ({
          id: space.id,
          name: space.name,
          directoryPath: space.directoryPath,
          nodeIds: space.nodeIds,
          nodes: space.nodeIds.map(nodeId => {
            const node = nodeById.get(nodeId)
            return node ? toNodeSummary(node) : { id: nodeId, kind: 'unknown', title: '' }
          }),
        })),
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
          space: {
            id: space.id,
            name: space.name,
            directoryPath: space.directoryPath,
            nodeIds: space.nodeIds,
            nodes: space.nodeIds.map(nodeId => {
              const node = nodeById.get(nodeId)
              return node ? toNodeSummary(node) : { id: nodeId, kind: 'unknown', title: '' }
            }),
          },
        }
      }

      throw createAppError('space.not_found', {
        debugMessage: `space.get: unknown space id: ${payload.spaceId}`,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })
}
