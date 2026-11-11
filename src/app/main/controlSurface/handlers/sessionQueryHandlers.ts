import { assertManagedClaudeStopAllowed } from '../managedClaudeCompatibility'
import type { ControlSurface } from '../controlSurface'
import type { registerSessionHandlers } from './sessionHandlers'
import type { createSessionNodeResolver } from './sessionNodeResolver'
import type { SessionRecord } from './sessionRecords'
import type { GetSessionResult, GetNodeSessionResult } from '../../../../shared/contracts/dto'
import { registerOperation } from '../registerOperation'
import {
  sessionGetOperation,
  sessionKillOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/session'
import { createAppError } from '../../../../shared/errors/appError'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import { registerSessionFinalMessageHandler } from './sessionFinalMessageHandler'

export function registerSessionQueryHandlers(
  controlSurface: ControlSurface,
  deps: Parameters<typeof registerSessionHandlers>[1],
  sessions: Map<string, SessionRecord>,
  resolveNode: ReturnType<typeof createSessionNodeResolver>,
): void {
  registerOperation(controlSurface, sessionGetOperation, {
    handle: async (_ctx, payload): Promise<GetSessionResult | GetNodeSessionResult> => {
      if (payload.nodeId !== undefined) {
        return (await resolveNode(payload.nodeId)).value
      }
      const record = sessions.get(payload.sessionId)
      if (!record) {
        throw createAppError('session.not_found', {
          debugMessage: `session.get: unknown session id: ${payload.sessionId}`,
        })
      }

      const { startedAtMs: _startedAtMs, route: _route, ...publicRecord } = record
      return publicRecord
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerSessionFinalMessageHandler(controlSurface, {
    sessions,
    topology: deps.topology,
    resolveNode,
  })

  registerOperation(controlSurface, sessionKillOperation, {
    handle: async (ctx, payload): Promise<void> => {
      if (payload.nodeId !== undefined) {
        const { value } = await resolveNode(payload.nodeId)
        const current = normalizePersistedAppState(
          await (await deps.getPersistenceStore()).readAppState(),
        )
        const stillBound = current?.workspaces.some(workspace =>
          workspace.nodes.some(
            node => node.id === payload.nodeId && node.sessionId === value.sessionId,
          ),
        )
        if (!stillBound) {
          throw createAppError('common.invalid_input', {
            debugMessage: 'Node session changed before kill; read it again.',
          })
        }
        if (!deps.ptyStreamHub.hasSession(value.sessionId)) {
          throw createAppError('session.not_found')
        }
        const store = await deps.getPersistenceStore()
        ctx.assertActive?.()
        assertManagedClaudeStopAllowed(ctx, store, value.sessionId)
        deps.ptyRuntime.kill(value.sessionId)
        return
      }
      const record = sessions.get(payload.sessionId) ?? null
      if (!record && !deps.ptyStreamHub.hasSession(payload.sessionId)) {
        throw createAppError('session.not_found', {
          debugMessage: `session.kill: unknown session id: ${payload.sessionId}`,
        })
      }

      const store = await deps.getPersistenceStore()
      ctx.assertActive?.()
      assertManagedClaudeStopAllowed(ctx, store, record?.sessionId ?? payload.sessionId)
      deps.ptyRuntime.kill(record?.sessionId ?? payload.sessionId)
    },
    defaultErrorCode: 'terminal.kill_failed',
  })
}
