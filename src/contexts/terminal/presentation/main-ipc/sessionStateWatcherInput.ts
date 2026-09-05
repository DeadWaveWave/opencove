import type { AgentLaunchMode, AgentProviderId } from '../../../../shared/contracts/dto'
import type { GeminiSessionDiscoveryCursor } from '../../../agent/infrastructure/cli/AgentSessionLocatorProviders'
import type { AgentSessionDiscoveryHandle } from '../../../agent/application/ports/AgentSessionDiscovery'

export interface SessionStateWatcherStartInput {
  sessionId: string
  provider: AgentProviderId
  cwd: string
  launchMode: AgentLaunchMode
  resumeSessionId: string | null
  startedAtMs: number
  opencodeBaseUrl?: string | null
  geminiDiscoveryCursor?: GeminiSessionDiscoveryCursor | null
}

export type OwnedSessionStateWatcherInput = SessionStateWatcherStartInput & {
  discovery?: AgentSessionDiscoveryHandle | null
}
