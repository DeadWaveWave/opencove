import { randomUUID } from 'node:crypto'
import type { ControlSurface } from '../controlSurface'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  CreateNoteInput,
  CreateNoteResult,
  GetSyncStateResult,
  PersistWriteResult,
  ReadNodeScrollbackInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
  WriteSyncStateInput,
  WriteSyncStateResult,
} from '../../../../shared/contracts/dto'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import {
  normalizePersistedAppState,
  type NormalizedPersistedAppState,
} from '../../../../platform/persistence/sqlite/normalize'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return value
}

function normalizeSyncStatePayload(payload: unknown): null {
  if (payload === null || payload === undefined) {
    return null
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid payload for sync.state.',
  })
}

function normalizeReadWorkspaceStateRawPayload(payload: unknown): null {
  if (payload === null || payload === undefined) {
    return null
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid payload for sync.readWorkspaceStateRaw.',
  })
}

function normalizeWriteWorkspaceStateRawPayload(payload: unknown): WriteWorkspaceStateRawInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeWorkspaceStateRaw.',
    })
  }

  const raw = payload.raw
  if (typeof raw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeWorkspaceStateRaw raw.',
    })
  }

  return { raw }
}

function normalizeReadNodeScrollbackPayload(payload: unknown): ReadNodeScrollbackInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.readNodeScrollback.',
    })
  }

  const nodeIdRaw = payload.nodeId
  if (typeof nodeIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.readNodeScrollback nodeId.',
    })
  }

  const nodeId = nodeIdRaw.trim()
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for sync.readNodeScrollback nodeId.',
    })
  }

  return { nodeId }
}

function normalizeWriteNodeScrollbackPayload(payload: unknown): WriteNodeScrollbackInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeNodeScrollback.',
    })
  }

  const nodeIdRaw = payload.nodeId
  if (typeof nodeIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeNodeScrollback nodeId.',
    })
  }

  const nodeId = nodeIdRaw.trim()
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for sync.writeNodeScrollback nodeId.',
    })
  }

  const scrollback = payload.scrollback
  if (scrollback !== null && scrollback !== undefined && typeof scrollback !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeNodeScrollback scrollback.',
    })
  }

  return { nodeId, scrollback: scrollback ?? null }
}

function normalizeWriteSyncStatePayload(payload: unknown): WriteSyncStateInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeState.',
    })
  }

  return {
    state: payload.state,
    baseRevision: normalizeOptionalFiniteNumber(payload.baseRevision),
  }
}

function normalizeCreateNotePayload(payload: unknown): CreateNoteInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for note.create.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for note.create spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for note.create spaceId.',
    })
  }

  return {
    spaceId,
    text: normalizeOptionalString(payload.text),
    title: normalizeOptionalString(payload.title),
    x: normalizeOptionalFiniteNumber(payload.x),
    y: normalizeOptionalFiniteNumber(payload.y),
    width: normalizeOptionalFiniteNumber(payload.width),
    height: normalizeOptionalFiniteNumber(payload.height),
  }
}

async function persistNextAppState(store: PersistenceStore, nextState: unknown): Promise<void> {
  const result = await store.writeAppState(nextState)
  if (!result.ok) {
    throw createAppError(result.error)
  }
}

export function registerSyncHandlers(
  controlSurface: ControlSurface,
  getPersistenceStore: () => Promise<PersistenceStore>,
): void {
  controlSurface.register('sync.state', {
    kind: 'query',
    validate: normalizeSyncStatePayload,
    handle: async (): Promise<GetSyncStateResult> => {
      const store = await getPersistenceStore()
      const [revision, state] = await Promise.all([
        store.readAppStateRevision(),
        store.readAppState(),
      ])
      return { revision, state }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('sync.readWorkspaceStateRaw', {
    kind: 'query',
    validate: normalizeReadWorkspaceStateRawPayload,
    handle: async (): Promise<string | null> => {
      const store = await getPersistenceStore()
      return await store.readWorkspaceStateRaw()
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('sync.writeWorkspaceStateRaw', {
    kind: 'command',
    validate: normalizeWriteWorkspaceStateRawPayload,
    handle: async (_ctx, payload): Promise<PersistWriteResult> => {
      const store = await getPersistenceStore()
      return await store.writeWorkspaceStateRaw(payload.raw)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('sync.readNodeScrollback', {
    kind: 'query',
    validate: normalizeReadNodeScrollbackPayload,
    handle: async (_ctx, payload): Promise<string | null> => {
      const store = await getPersistenceStore()
      return await store.readNodeScrollback(payload.nodeId)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('sync.writeNodeScrollback', {
    kind: 'command',
    validate: normalizeWriteNodeScrollbackPayload,
    handle: async (_ctx, payload): Promise<PersistWriteResult> => {
      const store = await getPersistenceStore()
      return await store.writeNodeScrollback(payload.nodeId, payload.scrollback)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('sync.writeState', {
    kind: 'command',
    validate: normalizeWriteSyncStatePayload,
    handle: async (_ctx, payload): Promise<WriteSyncStateResult> => {
      const store = await getPersistenceStore()
      const currentRevision = await store.readAppStateRevision()

      if (typeof payload.baseRevision === 'number' && payload.baseRevision !== currentRevision) {
        throw createAppError('persistence.invalid_state', {
          debugMessage: `sync.writeState revision conflict (base=${payload.baseRevision}, current=${currentRevision})`,
        })
      }

      await persistNextAppState(store, payload.state)
      const nextRevision = await store.readAppStateRevision()
      return { revision: nextRevision }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('note.create', {
    kind: 'command',
    validate: normalizeCreateNotePayload,
    handle: async (ctx, payload): Promise<CreateNoteResult> => {
      const store = await getPersistenceStore()
      const raw = await store.readAppState()
      const normalized = normalizePersistedAppState(raw)

      if (!normalized) {
        throw createAppError('persistence.invalid_state', {
          debugMessage: 'note.create requires an initialized workspace state.',
        })
      }

      const targetSpaceId = payload.spaceId
      let targetWorkspace: NormalizedPersistedAppState['workspaces'][number] | null = null
      let targetSpaceIndex: number | null = null

      for (const workspace of normalized.workspaces) {
        const index = workspace.spaces.findIndex(space => space.id === targetSpaceId)
        if (index === -1) {
          continue
        }

        targetWorkspace = workspace
        targetSpaceIndex = index
        break
      }

      if (!targetWorkspace || targetSpaceIndex === null) {
        throw createAppError('space.not_found', {
          debugMessage: `note.create: unknown space id: ${targetSpaceId}`,
        })
      }

      const nowIso = ctx.now().toISOString()
      const nodeId = randomUUID()
      const title = payload.title ?? 'Note'
      const text = payload.text ?? ''

      const width = payload.width ?? 360
      const height = payload.height ?? 260

      const nextNode = {
        id: nodeId,
        title,
        titlePinnedByUser: false,
        position: {
          x: payload.x ?? 0,
          y: payload.y ?? 0,
        },
        width,
        height,
        kind: 'note',
        labelColorOverride: null,
        status: null,
        startedAt: nowIso,
        endedAt: null,
        exitCode: null,
        lastError: null,
        executionDirectory: null,
        expectedDirectory: null,
        agent: null,
        task: { text },
        scrollback: null,
      }

      const nextState = {
        ...normalized,
        workspaces: normalized.workspaces.map(workspace => {
          if (workspace.id !== targetWorkspace?.id) {
            return workspace
          }

          const space = workspace.spaces[targetSpaceIndex]
          const nextSpace = {
            ...space,
            nodeIds: [...space.nodeIds, nodeId],
          }

          return {
            ...workspace,
            nodes: [...workspace.nodes, nextNode],
            spaces: workspace.spaces.map((candidate, index) =>
              index === targetSpaceIndex ? nextSpace : candidate,
            ),
          }
        }),
      }

      await persistNextAppState(store, nextState)
      const revision = await store.readAppStateRevision()

      return {
        revision,
        projectId: targetWorkspace.id,
        spaceId: targetSpaceId,
        nodeId,
      }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
