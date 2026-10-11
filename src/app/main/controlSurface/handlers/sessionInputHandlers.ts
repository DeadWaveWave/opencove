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
  control.register('session.stopNode', {
    kind: 'command',
    validate(value) {
      const input = value as { nodeId?: unknown; sessionId?: unknown } | null
      if (typeof input?.nodeId !== 'string' || typeof input.sessionId !== 'string') {
        throw new Error('Stopping a node requires its exact nodeId and sessionId.')
      }
      return { nodeId: input.nodeId, sessionId: input.sessionId }
    },
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
  control.register('session.writeNode', {
    kind: 'command',
    validate(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid session input.')
      }
      const input = value as Record<string, unknown>
      if (
        typeof input.nodeId !== 'string' ||
        !input.nodeId.trim() ||
        typeof input.sessionId !== 'string' ||
        !input.sessionId.trim() ||
        typeof input.data !== 'string' ||
        new TextEncoder().encode(input.data).byteLength > 32 * 1024
      ) {
        throw new Error('Session input requires a nodeId and at most 32 KiB of data.')
      }
      return { nodeId: input.nodeId.trim(), sessionId: input.sessionId.trim(), data: input.data }
    },
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
