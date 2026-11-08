import { resolveForegroundAgentObservation } from '../../../shared/runtime/agentForegroundRecognition'
import type { PtyHostMessage } from './protocol'
import type { ProcessIdentity } from './posixProcessTable'

/** Foreground probes share the async reader; no blocking ps on the host thread. */
export async function observePtyForeground(options: {
  sessionId: string
  observedAtMs: number
  windowsExitCode: number | null
  hostInstanceId: string
  rootPid: number | null
  platform: NodeJS.Platform
  readTable: () => Promise<ProcessIdentity[] | null>
  send: (message: PtyHostMessage) => void
  isCurrent: () => boolean
}): Promise<void> {
  const { sessionId, hostInstanceId, observedAtMs, windowsExitCode } = options
  const common = {
    type: 'foreground' as const,
    sessionId,
    hostInstanceId,
    observedAtMs,
    availability: 'unavailable' as const,
    agent: null,
    shellOnly: false as const,
  }
  if (options.platform === 'win32') {
    options.send(
      windowsExitCode === null
        ? { ...common, source: 'windows_prompt_timeout', exitCode: null }
        : { ...common, source: 'windows_exit_code', exitCode: windowsExitCode },
    )
    return
  }
  const rows = options.rootPid ? await options.readTable() : null
  if (!options.isCurrent()) {
    return
  }
  options.send({
    ...common,
    source: 'process_scan',
    exitCode: null,
    ...(rows && options.rootPid
      ? resolveForegroundAgentObservation(
          rows
            .map(row => `${row.pid} ${row.parentPid} ${row.state ?? 'S'} ${row.command}`)
            .join('\n'),
          options.rootPid,
        )
      : {}),
  })
}
