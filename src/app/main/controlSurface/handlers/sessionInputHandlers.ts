import {
  assertManagedClaudeStopAllowed,
  assertNodeRuntimeBindingCurrent,
} from '../managedClaudeCompatibility'
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
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'

/** Exact durable node -> current PTY binding, rechecked after queued readiness work. */
export function registerSessionInputHandlers(
  control: ControlSurface,
  deps: {
    getPersistenceStore(): Promise<PersistenceStore>
    ptyStreamHub: PtyStreamHub
    ptyRuntime: Pick<MultiEndpointPtyRuntime, 'kill' | 'getSessionRoute'>
  },
) {
  async function binding(nodeId: string, store: PersistenceStore) {
    const state = normalizePersistedAppState(await store.readAppState())
    const node = state ? findNodeForNodeControl(state.workspaces, nodeId)?.node : null
    if (!node || !['agent', 'terminal'].includes(node.kind) || !node.sessionId) {
      throw createAppError('session.not_found')
    }
    return { sessionId: node.sessionId, kind: node.kind, workerBinding: node.workerBinding }
  }
  registerOperation(control, sessionStopNodeOperation, {
    async handle(ctx, input) {
      const store = await deps.getPersistenceStore()
      const bound = await binding(input.nodeId, store)
      if (bound.sessionId !== input.sessionId) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Node session changed before stop; read it again.',
        })
      }
      ctx.assertActive?.()
      // No await between the final binding check and the local runtime side effect.
      if (input.agentOnly) {
        const route = deps.ptyRuntime.getSessionRoute?.(input.sessionId)
        if (
          route?.kind === 'remote' ||
          (bound.workerBinding && bound.workerBinding.endpointId !== 'local')
        ) {
          throw createAppError('node.unsupported_operation', {
            debugMessage:
              'Agent-only stopping is unavailable for remote targets. No stop was sent. Stop the agent from the Worker that runs it.',
            details: { reason: 'remote_agent_stop_unsupported' },
          })
        }
        if (!deps.ptyStreamHub.isSessionActive(input.sessionId)) {
          return { ...input, requested: false, stopped: false, reason: 'not_running' as const }
        }
        const agent = deps.ptyStreamHub.observeAgentState(input.sessionId)
        if (agent && (agent.nodeId !== input.nodeId || agent.sessionId !== input.sessionId)) {
          throw createAppError('common.invalid_input', {
            debugMessage: 'Node agent session changed before stop; inspect the node again.',
          })
        }
        if (agent?.state === 'exited') {
          return { ...input, requested: false, stopped: false, reason: 'not_running' as const }
        }
        if (
          bound.kind === 'terminal' &&
          (agent?.state === 'unknown' || agent?.quality === 'degraded')
        ) {
          throw createAppError('agent.state_unknown', {
            debugMessage:
              'This terminal’s current agent could not be confirmed. Inspect the node before stopping it.',
          })
        }
        if (bound.kind === 'terminal' && !agent) {
          throw createAppError('agent.not_running', {
            debugMessage:
              'This terminal no longer has an observed agent. Use session kill to stop its shell.',
          })
        }
      }
      ctx.assertActive?.()
      assertManagedClaudeStopAllowed(ctx, store, input.sessionId, input.nodeId)
      deps.ptyRuntime.kill(input.sessionId)
      return { ...input, requested: true, stopped: true }
    },
    defaultErrorCode: 'terminal.kill_failed',
  })
  registerOperation(control, sessionWriteNodeOperation, {
    async handle(ctx, input) {
      const sessionId = input.sessionId
      const store = await deps.getPersistenceStore()
      if ((await binding(input.nodeId, store)).sessionId !== sessionId) {
        throw new Error('Node session changed before input; read it again.')
      }
      await deps.ptyStreamHub.writeAutomation({
        sessionId,
        data: input.data,
        assertActive: () => {
          ctx.assertActive?.()
          assertNodeRuntimeBindingCurrent(store, input.nodeId, sessionId)
        },
        validateBinding: async () => {
          if ((await binding(input.nodeId, store)).sessionId !== sessionId) {
            throw new Error('Node session changed before input; read it again.')
          }
        },
      })
      return { nodeId: input.nodeId, sessionId, accepted: true }
    },
    defaultErrorCode: 'common.invalid_input',
  })
}
