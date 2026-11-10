import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { projectNodeLineages } from '../../../../contexts/workspace/application/nodeLineage/NodeLineageOwner'
import { createAppError } from '../../../../shared/errors/appError'
import { withTurnDeliveryIds } from '../../../../contexts/agent/application/turnDeliveryIds'
import type { PromptDeliveryService } from '../../../../contexts/agent/application/PromptDeliveryService'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { registerOperation } from '../registerOperation'
import {
  agentHistoryClearOperation,
  agentGetOperation,
  agentFinalMessageOperation,
  agentListOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/agent'
export function registerAgentRunStateHandlers(
  surface: ControlSurface,
  hub: PtyStreamHub,
  deliveries?: Pick<PromptDeliveryService, 'forTurn'>,
  getPersistenceStore?: () => Promise<PersistenceStore>,
): void {
  registerOperation(surface, agentHistoryClearOperation, {
    handle: (_ctx, input) => {
      const { remote, ...result } = hub.agentRuns.registry.clearHistory(input.nodeId)
      if (remote) {
        throw createAppError('common.unavailable', {
          details: { reason: 'remote_history_unavailable', ...result },
        })
      }
      if (result.archive.status === 'unavailable') {
        throw createAppError('common.unavailable', {
          details: { reason: 'archive_unavailable', ...result },
        })
      }
      return result
    },
    defaultErrorCode: 'common.unavailable',
  })
  registerOperation(surface, agentFinalMessageOperation, {
    handle: (_ctx, input) =>
      withTurnDeliveryIds(() => hub.agentRuns.registry.finalMessage(input), deliveries),
    defaultErrorCode: 'agent.final_message_unavailable',
  })
  registerOperation(surface, agentGetOperation, {
    handle: (_ctx, input) => hub.agentRuns.registry.get(input),
    defaultErrorCode: 'common.unexpected',
  })
  registerOperation(surface, agentListOperation, {
    handle: async (_ctx, input) => {
      const result = hub.agentRuns.registry.list(input)
      if (!input.spawnedByNodeId) {
        return result
      }
      if (!getPersistenceStore) {
        throw createAppError('persistence.unavailable')
      }
      const store = await getPersistenceStore()
      if (!store.nodeLineage) {
        throw createAppError('persistence.unavailable')
      }
      const candidates = result.agents.filter(a => a.nodeId !== null).map(a => ({ id: a.nodeId! }))
      const selected = await projectNodeLineages(store, candidates, input.spawnedByNodeId)
      const ids = new Set(selected.map(n => n.id))
      return { ...result, agents: result.agents.filter(a => a.nodeId && ids.has(a.nodeId)) }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
