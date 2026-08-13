import type { AgentProvider } from '@contexts/settings/domain/agentSettings'

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
  if (
    binding.provider !== 'claude-code' &&
    binding.provider !== 'codex' &&
    binding.provider !== 'opencode' &&
    binding.provider !== 'gemini'
  ) {
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

export function resolveObservedResumeSessionBindingUpdate(
  binding: ResumeSessionBindingLike,
  observedResumeSessionId: string | null | undefined,
): VerifiedResumeSessionBindingUpdate | null {
  if (!hasResumeSessionId(observedResumeSessionId)) {
    return null
  }

  if (
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
