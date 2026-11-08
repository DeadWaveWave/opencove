import { createAppError } from '../../../shared/errors/appError'
import type { PromptDeliveryService } from './PromptDeliveryService'

/** Correlation only: the existing volatile ledger remains the sole delivery owner. */
export function withTurnDeliveryIds<T extends { sessionId: string; turnId: string }>(
  read: () => T,
  deliveries?: Pick<PromptDeliveryService, 'forTurn'>,
): T & { deliveryIds: string[] } {
  const ids = (value: { sessionId: string; turnId: string }) =>
    deliveries?.forTurn(value.sessionId, value.turnId) ?? []
  try {
    const result = read()
    return { ...result, deliveryIds: ids(result) }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'agent.final_message_unavailable' &&
      'details' in error
    ) {
      const details = error.details as { reason?: string; sessionId: string; turnId: string }
      if (details?.reason === 'provider_sent_no_message') {
        throw createAppError('agent.final_message_unavailable', {
          details: { ...details, deliveryIds: ids(details) },
        })
      }
    }
    throw error
  }
}
