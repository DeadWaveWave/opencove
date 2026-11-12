import type { ClaudeBindingEvidencePort } from './claudeBindingEvidence'
import type { ClaudeTranscriptPort } from './claudeTranscript'
import type { PromptSubmissionEvidence } from './claudePromptEvidence'
import type {
  AgentHookInstallState,
  TerminalAgentShimProvider,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../contracts/dto'
import type { AgentSessionIdentityObservation } from '../../contracts/dto/agentSessionIdentityObservation'

export interface AgentHookEnvelope extends PromptSubmissionEvidence {
  claudeSessionId?: string
  emittedAtMs?: number
  hookEventName?: string
  notificationType?: string
  tool?: { name: string; input?: unknown }
  state: 'working' | 'waiting' | 'standby' | 'done' | null
}

export interface AgentHookInstallResult {
  state: AgentHookInstallState
  detail: string | null
}

export interface AgentHookSpawnReservation {
  env: NodeJS.ProcessEnv | null
  installState: AgentHookInstallState
  usesHook: boolean
  commit: (sessionId: string, terminalActivity?: TerminalAgentHookContext) => void
  dispose: () => Promise<void>
}

export interface AgentHookChannel extends ClaudeTranscriptPort, ClaudeBindingEvidencePort {
  start: () => Promise<void>
  reserveSpawn: (options?: {
    environment?: Readonly<NodeJS.ProcessEnv>
    residentContext?: 'canvas' | 'none'
    isInvocationCurrent?: () => boolean
  }) => Promise<AgentHookSpawnReservation>
  setResidentContextEnabled?: (resolve: () => Promise<boolean>) => void
  onState: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  disposeSession: (sessionId: string) => void
  getInstallState: () => AgentHookInstallState
  getEndpoint: () => string | null
  dispose: () => Promise<void>
}

export interface TerminalAgentHookContext {
  provider: TerminalAgentShimProvider
  invocationId: string
  generation: number
  isCurrent: () => boolean
  observe?: (observation: AgentSessionIdentityObservation) => boolean
}

export interface AgentHookObservationOwner<TEnvelope extends AgentHookEnvelope> {
  accept: (envelope: TEnvelope) => {
    state: AgentHookEnvelope['state']
    identity: AgentSessionIdentityObservation | null
    metadata: Omit<TerminalSessionMetadataEvent, 'sessionId' | 'terminalAgentActivity'>
    stateMetadata?: Pick<TerminalSessionStateEvent, 'piConversation'>
  } | null
  onCommittedObservation?: (
    sessionId: string,
    envelope: TEnvelope,
    isCurrent: () => boolean,
  ) => void
  dispose: () => void
}

export interface PrivateHookContext {
  incarnation: string
  conversationGeneration?: number
  credential?: object
  isCurrent: () => boolean
  publishState?: (generation: number) => void
}
export interface PrivateHookObserver<TEnvelope> {
  /** Deferred accepts the authenticated request while the owner retains state publication. */
  observe(sessionId: string, envelope: TEnvelope, context: PrivateHookContext): boolean | 'deferred'
  dispose(): void
}
