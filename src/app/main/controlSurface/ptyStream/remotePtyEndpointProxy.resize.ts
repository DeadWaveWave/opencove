import { randomUUID } from 'node:crypto'
import type WebSocket from 'ws'
import type {
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
} from '../../../../shared/contracts/dto'
import type { RemoteGeometryAckCoordinator } from '../remote/remoteGeometryAckCoordinator'
import type { RemotePtyEndpointAttachedSessionState } from './remotePtyEndpointProxy.messageHandler'
import { trySendRemotePtyWs } from './remotePtyEndpointProxy.support'

export async function resizeRemotePtyEndpoint(options: {
  socket: WebSocket | null
  acknowledgements: RemoteGeometryAckCoordinator
  attached: RemotePtyEndpointAttachedSessionState | undefined
  input: ResizeTerminalInput
}): Promise<TerminalGeometryCommitResult> {
  const operationId = options.input.operationId?.trim() || randomUUID()
  const socket = options.socket
  if (!socket) {
    throw new Error('Remote PTY socket is unavailable')
  }

  const resultPromise = options.acknowledgements.waitForResult({
    sessionId: options.input.sessionId,
    operationId,
    timeoutMs: 3_000,
    timeoutMessage: `Timed out waiting for remote geometry ACK: ${options.input.sessionId}`,
  })
  const sent = trySendRemotePtyWs(socket, {
    type: 'resize',
    sessionId: options.input.sessionId,
    cols: options.input.cols,
    rows: options.input.rows,
    reason: options.input.reason,
    operationId,
    // Upstream revisions/epochs belong to the Home Hub; only this downstream attach epoch is valid.
    ...(typeof options.attached?.authorityEpoch === 'number'
      ? { authorityEpoch: options.attached.authorityEpoch }
      : {}),
  })
  if (!sent) {
    options.acknowledgements.rejectOperation(
      options.input.sessionId,
      operationId,
      new Error('Failed to send remote geometry request'),
    )
  }
  return await resultPromise
}
