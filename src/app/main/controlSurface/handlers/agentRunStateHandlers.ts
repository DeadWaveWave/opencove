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
    handle: (_ctx, input) => hub.agentRuns.registry.list(input),
    defaultErrorCode: 'common.unexpected',
  })
}
