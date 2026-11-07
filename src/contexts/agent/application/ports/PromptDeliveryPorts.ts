import type { AgentRunTurnEnd } from '../../domain/agentRunState'
import type { AgentRunSnapshot } from '../../../../shared/contracts/dto/agentRunState'
import type {
  AgentHookCoverage,
  AgentLaunchKind,
  AgentHookInstallState,
  AgentProviderId,
} from '../../../../shared/contracts/dto'

export interface RunStateFence {
  epoch: string
  incarnation: string
  bindingGeneration: number
  cursor: number
  snapshot: AgentRunSnapshot
  lastTurnEnd: AgentRunTurnEnd | null
  watermarks: Partial<Record<string, number>>
  remote: boolean
  launchKind?: AgentLaunchKind
  hookCoverage?: AgentHookCoverage
  hookInstallState?: AgentHookInstallState
}
export interface RunStateReceipt {
  fence: RunStateFence | null
  source?: string
  emittedAtMs?: number
  hookEventName?: string
  sourceSequence?: number
  turnId?: string
}
export interface RunStateFencePort {
  readFence(locator: { nodeId: string } | { sessionId: string }): RunStateFence | null
  /** Synchronous registration with receipt replay from the fence cursor; history gaps invalidate. */
  watchFence(fence: RunStateFence, listener: (receipt: RunStateReceipt) => void): () => void
}
export interface ReservedSessionInput {
  generation: object
  isLive(): boolean
  watchInvalidation(listener: () => void): () => void
  mode(): { bracketedPaste: boolean; watermark: number }
  /** Raw write; never calls another enqueuing Hub method. Invalid outside reservation. */
  write(data: string): void
}
export interface SessionInputPort {
  withSessionInputOperation<T>(
    sessionId: string,
    callback: (input: ReservedSessionInput) => Promise<T>,
  ): Promise<T>
}
export interface PromptingCapability {
  supported: true
  submitDelayMs: number
}
export interface PromptDeliveryPorts {
  runs: RunStateFencePort
  input: SessionInputPort
  capability(provider: AgentProviderId): PromptingCapability | undefined
  now(): number
  createDeliveryId(): string
  schedule(callback: () => void, delayMs: number): () => void
}
