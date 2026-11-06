import { registerOperation } from '../registerOperation'
import {
  sessionStopNodeOperation,
  sessionWriteNodeOperation,
} from '@shared/contracts/controlSurface/operations/domains/session'
import { createAppError } from '../../../../shared/errors/appError'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { findNodeForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeDtos'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'

/** Exact durable node -> current PTY binding, rechecked after queued readiness work. */
export function registerSessionInputHandlers(
  control: ControlSurface,
  deps: {
    getPersistenceStore(): Promise<PersistenceStore>
    ptyStreamHub: PtyStreamHub
  },
) {
  async function binding(nodeId: string) {
    const state = normalizePersistedAppState(
      await (await deps.getPersistenceStore()).readAppState(),
    )
    const node = state ? findNodeForNodeControl(state.workspaces, nodeId)?.node : null
    if (!node || !['agent', 'terminal'].includes(node.kind) || !node.sessionId) {
      throw createAppError('session.not_found')
    }
    return node.sessionId
  }
  registerOperation(control, sessionStopNodeOperation, {
    async handle(ctx, input) {
      if ((await binding(input.nodeId)) !== input.sessionId) {
        throw new Error('Node session changed before stop; read it again.')
      }
      ctx.assertActive?.()
      const result = await control.invoke(ctx, {
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId: input.sessionId },
      })
      if (!result.ok) {
        throw createAppError(result.error)
      }
      return { ...input, requested: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
  registerOperation(control, sessionWriteNodeOperation, {
    async handle(ctx, input) {
      const sessionId = input.sessionId
      if ((await binding(input.nodeId)) !== sessionId) {
        throw new Error('Node session changed before input; read it again.')
      }
      await deps.ptyStreamHub.writeAutomation({
        sessionId,
        data: input.data,
        assertActive: () => ctx.assertActive?.(),
        validateBinding: async () => {
          if ((await binding(input.nodeId)) !== sessionId) {
            throw new Error('Node session changed before input; read it again.')
          }
        },
      })
      return { nodeId: input.nodeId, sessionId, accepted: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
}
