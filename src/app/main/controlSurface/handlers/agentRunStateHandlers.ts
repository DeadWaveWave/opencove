import { withTurnDeliveryIds } from '../../../../contexts/agent/application/turnDeliveryIds'
import type { PromptDeliveryService } from '../../../../contexts/agent/application/PromptDeliveryService'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { registerOperation } from '../registerOperation'
import {
  agentGetOperation,
  agentFinalMessageOperation,
  agentListOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/agent'
export function registerAgentRunStateHandlers(
  surface: ControlSurface,
  hub: PtyStreamHub,
  deliveries?: Pick<PromptDeliveryService, 'forTurn'>,
): void {
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
