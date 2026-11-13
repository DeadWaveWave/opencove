import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'

/** Registry projection ports; observer ordering stays with the conversation owner. */
export interface ClaudeConversationPorts {
  reset(): void
  invalidate(pending?: boolean): void
  canReady(): boolean
  ready(): void
  settled(): void
  adoptedCompletion?(): boolean
  completedTurnId(): string | null
  preserve?(event: ClaudeConversationEvent): boolean
  established?(providerSessionId: string): void
}
