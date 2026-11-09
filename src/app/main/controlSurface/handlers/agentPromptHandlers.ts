import { assertSessionGrantMessagePrompt } from '../http/sessionGrantPromptPolicy'
import { randomUUID } from 'node:crypto'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import type { AgentProviderRegistry } from '../../../../contexts/agent/application/services/AgentProviderRegistry'
import { PromptDeliveryService } from '../../../../contexts/agent/application/PromptDeliveryService'
import { registerOperation } from '../registerOperation'
import {
  agentDeliveryGetOperation,
  agentPromptOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/agent'

/** One service per Worker composition, never one reservation map per HTTP request. */
export function registerAgentPromptHandlers(
  surface: ControlSurface,
  hub: PtyStreamHub,
  providers: AgentProviderRegistry,
): PromptDeliveryService {
  const service = new PromptDeliveryService({
    runs: hub.agentRuns.registry,
    input: hub,
    capability: provider => providers.require(provider).prompting,
    now: Date.now,
    createDeliveryId: randomUUID,
    schedule: (callback, delay) => {
      const timer = setTimeout(callback, delay)
      return () => clearTimeout(timer)
    },
  })
  hub.agentRuns.registry.onDispose(() => service.dispose())
  registerOperation(surface, agentDeliveryGetOperation, {
    handle: (_ctx, input) => service.get(input.deliveryId),
    defaultErrorCode: 'common.unexpected',
  })
  registerOperation(surface, agentPromptOperation, {
    handle: (ctx, input) =>
      service.deliver(
        {
          ...input,
          nodeId:
            input.nodeId === '@self' && ctx.requestAuth?.kind === 'session-grant'
              ? ctx.requestAuth.grant.nodeId
              : input.nodeId,
        },
        {
          ...ctx,
          authorizePrompt:
            ctx.requestAuth?.kind === 'session-grant'
              ? (provider, text) =>
                  assertSessionGrantMessagePrompt(text, {
                    provider,
                    operationId: 'agent.prompt',
                    field: 'text',
                  })
              : undefined,
        },
      ),
    defaultErrorCode: 'common.unexpected',
  })
  return service
}
