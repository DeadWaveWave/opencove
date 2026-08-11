import { createAppError } from '../../../../shared/errors/appError'
import type { UpdateManagedSshWorkerEndpointInput } from '../../../../shared/contracts/dto'
import { normalizeNonEmptyString, normalizePort, type RemoteEndpointRecord } from './topologyFileV1'

export function createManagedSshEndpointUpdate(input: {
  current: RemoteEndpointRecord
  update: UpdateManagedSshWorkerEndpointInput
  now: string
}): RemoteEndpointRecord {
  const endpointId = normalizeNonEmptyString(input.update.endpointId)
  const host = normalizeNonEmptyString(input.update.host)
  const port =
    input.update.port === null || input.update.port === undefined
      ? null
      : normalizePort(input.update.port)
  const username = normalizeNonEmptyString(input.update.username)
  const remotePort = normalizePort(input.update.remotePort)
  const remotePlatform =
    input.update.remotePlatform === 'posix' || input.update.remotePlatform === 'windows'
      ? input.update.remotePlatform
      : 'auto'

  if (!endpointId || endpointId !== input.current.endpointId || !host || remotePort === null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'endpoint.updateManagedSsh requires endpointId/host/remotePort.',
    })
  }
  if (input.current.accessKind !== 'managed_ssh' || !input.current.managedSsh) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Managed SSH endpoint not found: ${endpointId}`,
    })
  }

  return {
    ...input.current,
    displayName:
      normalizeNonEmptyString(input.update.displayName) ??
      `${username ? `${username}@` : ''}${host}`,
    hostname: '127.0.0.1',
    port: remotePort,
    managedSsh: { host, port, username, remotePort, remotePlatform },
    updatedAt: input.now,
  }
}
