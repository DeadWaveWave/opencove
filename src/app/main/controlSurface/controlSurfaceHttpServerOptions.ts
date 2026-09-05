import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { ControlSurfacePtyRuntime } from './handlers/sessionPtyRuntime'
import type {
  SyncEventPayload,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../shared/contracts/dto'
import type { ClaudeHookChannel } from './agentHook/claudeHookChannel'
import type { AgentHookChannel } from '../../../shared/runtime/agentHook/agentHookChannel'
import type { AgentProviderRegistry } from '../../../contexts/agent/application/services/AgentProviderRegistry'

export interface RegisterControlSurfaceHttpServerOptions {
  userDataPath: string
  dbPath?: string
  createPersistenceStore?: (options: { dbPath: string }) => Promise<PersistenceStore>
  hostname?: string
  bindHostname?: string
  port?: number
  token?: string
  appVersion?: string | null
  deploymentId?: string | null
  activationId?: string | null
  strictPersistence?: boolean
  requestManagedShutdown?: () => void
  connectionFileName?: string
  connectionStartedBy?: 'cli' | 'desktop'
  approvedWorkspaces: ApprovedWorkspaceStore
  ptyRuntime: ControlSurfacePtyRuntime & { dispose?: () => void }
  ownsPtyRuntime?: boolean
  deleteEntry?: (uri: string) => Promise<void>
  enableWebShell?: boolean
  webUiPasswordHash?: string | null
  desktopSyncEventSink?: (payload: SyncEventPayload) => number
  desktopPtyStateSink?: (payload: TerminalSessionStateEvent) => number
  desktopPtyMetadataSink?: (payload: TerminalSessionMetadataEvent) => number
  closeWebsiteNode?: (nodeId: string) => Promise<void> | void
  claudeHookChannel?: ClaudeHookChannel
  agentHookChannels?: readonly AgentHookChannel[]
  agentProviderRegistry?: AgentProviderRegistry
}
