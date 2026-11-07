import { randomUUID } from 'node:crypto'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import {
  normalizePersistedAppState,
  type NormalizedPersistedAppState,
} from '../../../../platform/persistence/sqlite/normalize'
import { noteCreateOperation } from '../../../../shared/contracts/controlSurface/operations/domains/note'
import {
  syncReadAgentNodePlaceholderScrollbackOperation,
  syncReadNodeScrollbackOperation,
  syncReadWorkspaceStateRawOperation,
  syncStateOperation,
  syncWriteAgentNodePlaceholderScrollbackOperation,
  syncWriteNodeScrollbackOperation,
  syncWriteStateOperation,
  syncWriteWorkspaceStateRawOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/sync'
import type {
  CreateNoteResult,
  GetSyncStateResult,
  PersistWriteResult,
  WriteSyncStateResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'

async function persistNextAppState(
  store: PersistenceStore,
  nextState: unknown,
  options?: { allowEmptyWorkspaceOverwrite?: boolean; expectedRevision?: number },
): Promise<void> {
  const result = await store.writeAppState(nextState, options)
  if (!result.ok) {
    throw createAppError(result.error)
  }
}

export function registerSyncHandlers(
  controlSurface: ControlSurface,
  getPersistenceStore: () => Promise<PersistenceStore>,
  options: {
    onStatePersisted?: (state: NormalizedPersistedAppState) => Promise<void>
  } = {},
): void {
  registerOperation(controlSurface, syncStateOperation, {
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

  registerOperation(controlSurface, syncReadWorkspaceStateRawOperation, {
    handle: async (): Promise<string | null> => {
      const store = await getPersistenceStore()
      return await store.readWorkspaceStateRaw()
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, syncWriteWorkspaceStateRawOperation, {
    handle: async (_ctx, payload): Promise<PersistWriteResult> => {
      const store = await getPersistenceStore()
      const result = await store.writeWorkspaceStateRaw(payload.raw)
      if (result.ok && options.onStatePersisted) {
        try {
          const normalized = normalizePersistedAppState(JSON.parse(payload.raw) as unknown)
          if (normalized) {
            await options.onStatePersisted(normalized)
          }
        } catch {
          // Persistence validation remains authoritative; recovery binding is best-effort here.
        }
      }
      return result
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, syncReadNodeScrollbackOperation, {
    handle: async (_ctx, payload): Promise<string | null> => {
      const store = await getPersistenceStore()
      return await store.readNodeScrollback(payload.nodeId)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, syncWriteNodeScrollbackOperation, {
    handle: async (_ctx, payload): Promise<PersistWriteResult> => {
      const store = await getPersistenceStore()
      return await store.writeNodeScrollback(payload.nodeId, payload.scrollback)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, syncReadAgentNodePlaceholderScrollbackOperation, {
    handle: async (_ctx, payload): Promise<string | null> => {
      const store = await getPersistenceStore()
      return await store.readAgentNodePlaceholderScrollback(payload.nodeId)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, syncWriteAgentNodePlaceholderScrollbackOperation, {
    handle: async (_ctx, payload): Promise<PersistWriteResult> => {
      const store = await getPersistenceStore()
      return await store.writeAgentNodePlaceholderScrollback(payload.nodeId, payload.scrollback)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, syncWriteStateOperation, {
    handle: async (_ctx, payload): Promise<WriteSyncStateResult> => {
      const store = await getPersistenceStore()
      const currentRevision = await store.readAppStateRevision()

      if (typeof payload.baseRevision !== 'number') {
        if (currentRevision > 0) {
          throw createAppError('persistence.invalid_state', {
            debugMessage: `sync.writeState requires baseRevision (current=${currentRevision})`,
          })
        }
      } else if (payload.baseRevision !== currentRevision) {
        throw createAppError('persistence.invalid_state', {
          debugMessage: `sync.writeState revision conflict (base=${payload.baseRevision}, current=${currentRevision})`,
        })
      }

      await persistNextAppState(store, payload.state, {
        allowEmptyWorkspaceOverwrite: payload.allowEmptyWorkspaceOverwrite === true,
        expectedRevision: payload.baseRevision ?? currentRevision,
      })
      const normalizedState = normalizePersistedAppState(payload.state)
      if (normalizedState && options.onStatePersisted) {
        await options.onStatePersisted(normalizedState).catch(() => undefined)
      }
      const nextRevision = await store.readAppStateRevision()
      return { revision: nextRevision }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, noteCreateOperation, {
    handle: async (ctx, payload): Promise<CreateNoteResult> => {
      const store = await getPersistenceStore()
      const expectedRevision = await store.readAppStateRevision()
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
        sessionId: null,
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

      await persistNextAppState(store, nextState, { expectedRevision })
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
