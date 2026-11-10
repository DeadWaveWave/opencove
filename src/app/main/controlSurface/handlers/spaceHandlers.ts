import { toCompactNodeData } from '../../../../contexts/workspace/application/nodeControl/nodeDtos'
import { randomUUID } from 'node:crypto'
import { createChildSpace } from '../../../../contexts/space/application/createChildSpace'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  NormalizedPersistedNode,
  NormalizedPersistedSpace,
} from '../../../../platform/persistence/sqlite/normalize'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import {
  spaceCreateChildOperation,
  spaceGetOperation,
  spaceListOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/space'
import type {
  CanvasNodeKind,
  CanvasNodeSummary,
  CreateChildSpaceResult,
  GetSpaceResult,
  ListSpacesResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'

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
    case 'folder':
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
  task?: unknown
}): CanvasNodeSummary {
  return {
    data: toCompactNodeData(node),
    id: node.id,
    kind: normalizeCanvasNodeKind(node.kind),
    title: typeof node.title === 'string' ? node.title : '',
    ...(typeof node.status === 'string' || node.status === null ? { status: node.status } : {}),
  }
}

type NodeSummaryInput = Parameters<typeof toNodeSummary>[0]

function toSpaceDto(space: NormalizedPersistedSpace, nodeById: Map<string, NodeSummaryInput>) {
  return {
    id: space.id,
    name: space.name,
    directoryPath: space.directoryPath,
    targetMountId: space.targetMountId,
    parentSpaceId: space.parentSpaceId,
    boundary: space.boundary,
    rect: space.rect,
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
  registerOperation(controlSurface, spaceListOperation, {
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

  registerOperation(controlSurface, spaceGetOperation, {
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

  registerOperation(controlSurface, spaceCreateChildOperation, {
    handle: async (_ctx, payload): Promise<CreateChildSpaceResult> => {
      const store = await getPersistenceStore()
      const expectedRevision = await store.readAppStateRevision()
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
        defaultName: count => `Space ${count}`,
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

      const writeResult = await store.writeAppState(nextState, { expectedRevision })
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
