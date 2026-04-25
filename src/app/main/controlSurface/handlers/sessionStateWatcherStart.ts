import type { AgentLaunchMode, AgentProviderId } from '../../../../shared/contracts/dto'
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
    ...(options.opencodeBaseUrl ? { opencodeBaseUrl: options.opencodeBaseUrl } : {}),
  })
}
