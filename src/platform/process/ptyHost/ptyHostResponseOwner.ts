import type { PtyHostResponseMessage } from './protocol'
import type { PtyHostPendingResponseCoordinator } from './pendingResponseCoordinator'
import type { PtyHostSessionEventOwner } from './ptyHostSessionEventOwner'
import type { PtyHostProcess } from './processTypes'

export function handlePtyHostResponse(
  message: PtyHostResponseMessage,
  pending: PtyHostPendingResponseCoordinator,
  sessions: PtyHostSessionEventOwner,
  host: PtyHostProcess | null,
  quarantineHost: (host: PtyHostProcess, error: Error) => void,
): void {
  const resolution = pending.resolve(message)
  if (message.requestType === 'spawn' && message.ok) {
    sessions.resolveSpawn(message.result.sessionId, resolution.status === 'accepted')
    return
  }
  if (host && resolution.status === 'mismatched' && resolution.expectedRequestType === 'spawn') {
    quarantineHost(host, new Error('[pty-host] spawn response identity became ambiguous'))
  }
}
