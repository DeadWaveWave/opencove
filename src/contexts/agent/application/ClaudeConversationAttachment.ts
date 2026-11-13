import { ClaudeConversationLifecycle } from '../domain/ClaudeConversationLifecycle'
import type { ClaudeConversationCheckpoint } from '../../../shared/runtime/agentHook/claudeConversation'

/** Normalize the original classifier checkpoint without adding a second classifier. */
export function conversationAttachment(
  initial: ClaudeConversationCheckpoint | undefined,
  retired: Set<string>,
  committedAt = -Infinity,
) {
  for (const item of initial?.retired ?? []) {
    retired.add(item.sessionId)
  }
  return {
    lifecycle: new ClaudeConversationLifecycle(initial),
    providerSessionId: initial?.current ?? initial?.retired.at(-1)?.sessionId,
    committedAt: Math.max(committedAt, initial?.watermark ?? -Infinity),
  }
}

/** Ordinary IO must match both namespace and captured generation after the first clear. */
export function acceptsConversationSource(
  current: { generation: number; providerSessionId?: string },
  generation: number | undefined,
  providerSessionId: string | undefined,
  unavailable: boolean,
): boolean {
  if (unavailable) {
    return false
  }
  return generation === undefined
    ? current.generation === 0 &&
        (!current.providerSessionId || providerSessionId === current.providerSessionId)
    : generation === current.generation &&
        ((generation === 0 && current.providerSessionId === undefined) ||
          providerSessionId === current.providerSessionId)
}

/** A fresh ordinary boundary leaves clear readiness behind; refresh only releases quarantine. */
export function ordinaryConversationFlags(generation: number, boundary: boolean, refresh: boolean) {
  return {
    ...(boundary
      ? {
          generation: generation + 1,
          ready: false,
          candidateReady: false,
          currentClear: false,
          endedInClear: false,
        }
      : {}),
    ...(boundary || refresh ? { uncertain: false, quarantined: false } : {}),
  }
}
