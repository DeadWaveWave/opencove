import type { ListSessionsResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  invokeControlSurface,
  type ControlSurfaceRemoteEndpoint,
} from '../remote/controlSurfaceHttpClient'

export async function killRemotePtyEndpointSession(options: {
  endpoint: ControlSurfaceRemoteEndpoint
  remoteSessionId: string
}): Promise<void> {
  const { result } = await invokeControlSurface(options.endpoint, {
    kind: 'command',
    id: 'session.kill',
    payload: { sessionId: options.remoteSessionId },
  })
  if (!result) {
    throw createAppError('worker.unavailable')
  }
  if (result.ok === false) {
    throw createAppError(result.error)
  }
}

export async function findRemotePtyEndpointSession(options: {
  endpoint: ControlSurfaceRemoteEndpoint
  remoteSessionId: string
  serverInstanceId: string | null
  expectedServerInstanceId?: string | null
}): Promise<ListSessionsResult['sessions'][number] | null> {
  if (
    options.expectedServerInstanceId &&
    options.serverInstanceId !== options.expectedServerInstanceId
  ) {
    return null
  }
  const { result } = await invokeControlSurface(options.endpoint, {
    kind: 'query',
    id: 'session.list',
    payload: null,
  })
  if (!result) {
    throw createAppError('worker.unavailable')
  }
  if (result.ok === false) {
    throw createAppError(result.error)
  }
  const value = result.value as Partial<ListSessionsResult> | null
  if (!Array.isArray(value?.sessions)) {
    throw new Error('Invalid session.list response payload')
  }
  return value.sessions.find(session => session?.sessionId === options.remoteSessionId) ?? null
}
