import type { AgentLaunchMode, AgentProviderId } from '../../../../shared/contracts/dto'
import type { GeminiSessionDiscoveryCursor } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'

export function shouldStartAgentSessionStateWatcher(): boolean {
  return (
    process.env.NODE_ENV !== 'test' ||
    process.env['OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER'] === '1'
  )
}

export function startAgentSessionStateWatcherIfEnabled(options: {
  ptyRuntime: ControlSurfacePtyRuntime
  sessionId: string
  provider: AgentProviderId
  cwd: string
  launchMode: AgentLaunchMode
  resumeSessionId: string | null
  startedAtMs: number
  geminiDiscoveryCursor?: GeminiSessionDiscoveryCursor | null
  opencodeBaseUrl?: string | null
}): void {
  if (!shouldStartAgentSessionStateWatcher()) {
    return
  }

  options.ptyRuntime.startSessionStateWatcher?.({
    sessionId: options.sessionId,
    provider: options.provider,
    cwd: options.cwd,
    launchMode: options.launchMode,
    resumeSessionId: options.resumeSessionId,
    startedAtMs: options.startedAtMs,
    ...(options.geminiDiscoveryCursor !== undefined
      ? { geminiDiscoveryCursor: options.geminiDiscoveryCursor }
      : {}),
    ...(options.opencodeBaseUrl ? { opencodeBaseUrl: options.opencodeBaseUrl } : {}),
  })
}
