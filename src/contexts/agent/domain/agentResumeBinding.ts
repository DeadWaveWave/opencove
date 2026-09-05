import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { isValidProvider } from '@contexts/settings/domain/agentSettings'
import type { TerminalSessionMetadataEvent } from '../../../shared/contracts/dto'
import { normalizePiAgentSnapshot } from '../../../shared/runtime/piAgentSnapshot'

export interface ResumeSessionBindingLike {
  provider: AgentProvider
  resumeSessionId: string | null
  resumeSessionIdVerified?: boolean
}

export interface VerifiedResumeSessionBindingUpdate {
  resumeSessionId: string
  resumeSessionIdVerified: true
}

export function normalizeResumeSessionBinding(value: unknown): ResumeSessionBindingLike | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const binding = value as Partial<ResumeSessionBindingLike>
  if (!isValidProvider(binding.provider)) {
    return null
  }

  if (
    binding.resumeSessionId !== null &&
    binding.resumeSessionId !== undefined &&
    typeof binding.resumeSessionId !== 'string'
  ) {
    return null
  }

  const resumeSessionIdVerified =
    typeof binding.resumeSessionIdVerified === 'boolean'
      ? binding.resumeSessionIdVerified
      : undefined

  return {
    provider: binding.provider,
    resumeSessionId:
      typeof binding.resumeSessionId === 'string' ? binding.resumeSessionId.trim() || null : null,
    ...(resumeSessionIdVerified === undefined ? {} : { resumeSessionIdVerified }),
  }
}

export function hasResumeSessionId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isResumeSessionBindingVerified(binding: ResumeSessionBindingLike): boolean {
  if (!hasResumeSessionId(binding.resumeSessionId)) {
    return false
  }

  if (binding.resumeSessionIdVerified === true) {
    return true
  }

  if (binding.resumeSessionIdVerified === false) {
    return false
  }

  return binding.provider === 'claude-code'
}

export function clearResumeSessionBinding(): {
  resumeSessionId: null
  resumeSessionIdVerified: false
} {
  return {
    resumeSessionId: null,
    resumeSessionIdVerified: false,
  }
}

export function resolveAgentMetadataResumeBindingUpdate(
  binding: ResumeSessionBindingLike,
  event: Pick<TerminalSessionMetadataEvent, 'resumeSessionId' | 'piSnapshot'>,
): ReturnType<typeof resolveObservedResumeSessionBindingUpdate> {
  const nativePi = normalizePiAgentSnapshot(event.piSnapshot)
  const authority =
    nativePi &&
    (event.resumeSessionId !== null ||
      nativePi.persistence === 'ephemeral' ||
      nativePi.conversationRevision > 1)
      ? ('pi_snapshot' as const)
      : undefined
  return resolveObservedResumeSessionBindingUpdate(binding, event.resumeSessionId, authority)
}

export function resolveObservedResumeSessionBindingUpdate(
  binding: ResumeSessionBindingLike,
  observedResumeSessionId: string | null | undefined,
  authority?: 'pi_snapshot',
): VerifiedResumeSessionBindingUpdate | ReturnType<typeof clearResumeSessionBinding> | null {
  const canSwitch = binding.provider === 'pi' && authority === 'pi_snapshot'
  if (canSwitch && observedResumeSessionId === null) {
    return binding.resumeSessionId !== null || binding.resumeSessionIdVerified === true
      ? clearResumeSessionBinding()
      : null
  }
  if (!hasResumeSessionId(observedResumeSessionId)) {
    return null
  }

  if (
    !canSwitch &&
    isResumeSessionBindingVerified(binding) &&
    binding.resumeSessionId !== observedResumeSessionId
  ) {
    return null
  }

  if (
    binding.resumeSessionId === observedResumeSessionId &&
    binding.resumeSessionIdVerified === true
  ) {
    return null
  }

  return {
    resumeSessionId: observedResumeSessionId,
    resumeSessionIdVerified: true,
  }
}
