import type { PresentationSnapshotTerminalResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import { parsePresentationSnapshot } from '../remote/remotePtyRuntime.support'

export async function fetchRemotePtyPresentationSnapshot(options: {
  endpoint: { hostname: string; port: number; token: string }
  remoteSessionId: string
}): Promise<PresentationSnapshotTerminalResult> {
  const { result } = await invokeControlSurface(options.endpoint, {
    kind: 'query',
    id: 'session.presentationSnapshot',
    payload: { sessionId: options.remoteSessionId },
  })
  if (!result) {
    throw createAppError('worker.unavailable')
  }
  if (result.ok === false) {
    throw createAppError(result.error)
  }
  return parsePresentationSnapshot(options.remoteSessionId, result.value)
}
