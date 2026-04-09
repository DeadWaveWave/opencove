import type { AgentProviderId } from '@shared/contracts/dto'
import { clearResumeSessionBinding, isResumeSessionBindingVerified } from '../agentResumeBinding'
import { normalizeOptionalString } from './normalize'

export function normalizeResumeSessionBinding(
  provider: AgentProviderId,
  record: Record<string, unknown>,
): {
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
} {
  const resumeSessionId = normalizeOptionalString(record.resumeSessionId)
  const hasResumeSessionVerifiedField = Object.prototype.hasOwnProperty.call(
    record,
    'resumeSessionIdVerified',
  )
  const resumeSessionIdVerifiedInput =
    typeof record.resumeSessionIdVerified === 'boolean' ? record.resumeSessionIdVerified : undefined

  // Legacy persisted states (pre `resumeSessionIdVerified`) stored resume IDs without an explicit
  // verification bit. Treat those as verified so old agent windows can resume after upgrades.
  if (resumeSessionId && resumeSessionIdVerifiedInput === undefined && !hasResumeSessionVerifiedField) {
    return {
      resumeSessionId,
      resumeSessionIdVerified: true,
    }
  }

  if (
    !isResumeSessionBindingVerified({
      provider,
      resumeSessionId,
      resumeSessionIdVerified: resumeSessionIdVerifiedInput,
    })
  ) {
    return clearResumeSessionBinding()
  }

  return {
    resumeSessionId,
    resumeSessionIdVerified: true,
  }
}
