import { randomBytes, randomUUID } from 'node:crypto'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  RegisterManagedSshWorkerEndpointInput,
  RegisterWorkerEndpointInput,
} from '../../../../shared/contracts/dto'
import { allocateManagedSshRemotePort } from './managedSshRemotePort'
import {
  type ManagedSshEndpointRecord,
  normalizeHostname,
  normalizeNonEmptyString,
  normalizePort,
  type RemoteEndpointRecord,
} from './topologyFileV1'

export function createManualEndpointRegistration(
  input: RegisterWorkerEndpointInput,
  now: string,
): { record: RemoteEndpointRecord; token: string } {
  const hostname = normalizeHostname(input.hostname)
  const port = normalizePort(input.port)
  const token = normalizeNonEmptyString(input.token)
  if (!hostname || port === null || !token) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'endpoint.register requires hostname/port/token.',
    })
  }

  const endpointId = randomUUID()
  return {
    token,
    record: {
      endpointId,
      kind: 'remote_worker',
      displayName: normalizeNonEmptyString(input.displayName) ?? `${hostname}:${String(port)}`,
      hostname,
      port,
      credentialRef: endpointId,
      accessKind: 'manual',
      managedSsh: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function createManagedSshEndpointRegistration(
  input: RegisterManagedSshWorkerEndpointInput,
  existingRemotePorts: Iterable<number>,
  now: string,
): { record: RemoteEndpointRecord; token: string } {
  const host = normalizeHostname(input.host)
  const port = input.port === null || input.port === undefined ? null : normalizePort(input.port)
  const username = normalizeNonEmptyString(input.username)
  const explicitRemotePort =
    input.remotePort === null || input.remotePort === undefined
      ? null
      : normalizePort(input.remotePort)
  const remotePort = explicitRemotePort ?? allocateManagedSshRemotePort(existingRemotePorts)
  const remotePlatform =
    input.remotePlatform === 'posix' || input.remotePlatform === 'windows'
      ? input.remotePlatform
      : 'auto'
  if (!host || remotePort === null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'endpoint.registerManagedSsh requires host and remotePort.',
    })
  }

  const endpointId = randomUUID()
  const managedSsh: ManagedSshEndpointRecord = {
    host,
    port,
    username,
    remotePort,
    remotePlatform,
  }

  return {
    token: randomBytes(24).toString('base64url'),
    record: {
      endpointId,
      kind: 'remote_worker',
      displayName:
        normalizeNonEmptyString(input.displayName) ?? `${username ? `${username}@` : ''}${host}`,
      hostname: '127.0.0.1',
      port: remotePort,
      credentialRef: endpointId,
      accessKind: 'managed_ssh',
      managedSsh,
      createdAt: now,
      updatedAt: now,
    },
  }
}
