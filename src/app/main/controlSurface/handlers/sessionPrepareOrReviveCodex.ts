import type { LaunchAgentSessionResult } from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import { launchAgentWithStartupObservation } from './agentLaunchStartupObservation'
import {
  CodexWriterLockRecoveryExhaustedError,
  runCodexResumeWithRetry,
  waitForCodexWriterLockRelease,
} from './codexResumeRecovery'

const CODEX_RESUME_MAX_ATTEMPTS = 3
const CODEX_RESUME_RETRY_BACKOFF_MS = [150, 350] as const
// Modern Codex settles this wait through verified SessionStart metadata. The bounded fallback keeps
// legacy versions usable while still covering delayed startup rejection and ordered PTY exit.
const CODEX_RESUME_STARTUP_OBSERVATION_MS = 2_000

export { CodexWriterLockRecoveryExhaustedError }

export async function launchCodexResumeWithRecovery(options: {
  resumeSessionId: string
  isLocalRuntime: boolean
  launch: () => Promise<LaunchAgentSessionResult>
  ptyRuntime?: Pick<ControlSurfacePtyRuntime, 'onData' | 'onExit' | 'onMetadata' | 'kill'>
}): Promise<LaunchAgentSessionResult> {
  if (options.isLocalRuntime) {
    await waitForCodexWriterLockRelease({ resumeSessionId: options.resumeSessionId })
  }

  const launch = async (): Promise<LaunchAgentSessionResult> => {
    if (!options.ptyRuntime) {
      return await options.launch()
    }
    return await launchAgentWithStartupObservation({
      launch: options.launch,
      ptyRuntime: options.ptyRuntime,
      observationMs: CODEX_RESUME_STARTUP_OBSERVATION_MS,
    })
  }

  return await runCodexResumeWithRetry({
    launch,
    maxAttempts: CODEX_RESUME_MAX_ATTEMPTS,
    backoffMs: CODEX_RESUME_RETRY_BACKOFF_MS,
  })
}
