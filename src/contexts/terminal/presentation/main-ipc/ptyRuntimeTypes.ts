import type { SessionRuntimeWrite } from '../../../../shared/runtime/sessionInputProvenance'
import type { ClaudeTranscriptPort } from '../../../../shared/runtime/agentHook/claudeTranscript'
import type { GeminiSessionDiscoveryCursor } from '../../../agent/application'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import type {
  AgentLaunchMode,
  AgentProviderId,
  AttachTerminalResult,
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  SpawnTerminalInput,
  SpawnTerminalResult,
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
  TerminalForegroundEvent,
  TerminalGeometryCommitResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'

export interface StartSessionStateWatcherInput {
  sessionId: string
  provider: AgentProviderId
  cwd: string
  launchMode: AgentLaunchMode
  resumeSessionId: string | null
  startedAtMs: number
  opencodeBaseUrl?: string | null
  geminiDiscoveryCursor?: GeminiSessionDiscoveryCursor | null
}

export interface PtyRuntime extends ClaudeTranscriptPort {
  listProfiles?: () => Promise<ListTerminalProfilesResult>
  spawnTerminalSession?: (input: SpawnTerminalInput) => Promise<SpawnTerminalResult>
  spawnSession: (options: SpawnPtyOptions) => Promise<{ sessionId: string }>
  write: SessionRuntimeWrite<Promise<void>>
  probeForeground?: (sessionId: string) => void
  reexecAgent?: (input: TerminalAgentReexecInput) => Promise<TerminalAgentReexecResult>
  resize: (input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>
  kill: (sessionId: string) => Promise<void>
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onForeground?: (listener: (event: TerminalForegroundEvent) => void) => () => void
  onState?: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata?: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  attach: (
    contentsId: number,
    sessionId: string,
    afterSeq?: number | null,
  ) => Promise<AttachTerminalResult>
  detach: (contentsId: number, sessionId: string) => Promise<void>
  snapshot: (sessionId: string) => Promise<string>
  presentationSnapshot: (sessionId: string) => Promise<PresentationSnapshotTerminalResult>
  startSessionStateWatcher: (input: StartSessionStateWatcherInput) => void
  disposeSessionStateWatcher: (sessionId: string) => void
  debugCrashHost?: () => void | Promise<void>
  dispose: () => void | Promise<void>
}
