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
  const resumeSessionIdVerifiedInput =
    typeof record.resumeSessionIdVerified === 'boolean' ? record.resumeSessionIdVerified : undefined

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
