import { createAppError } from '../../../../shared/errors/appError'
import type { UpdateManagedSshWorkerEndpointInput } from '../../../../shared/contracts/dto'
import type { ManagedSshEndpointRuntimeDisposer } from './topologyEndpointAccess'
import { createManagedSshEndpointUpdate } from './topologyEndpointUpdate'
import { normalizeNonEmptyString, type RemoteEndpointRecord } from './topologyFileV1'

export async function runManagedSshEndpointUpdate(options: {
  input: UpdateManagedSshWorkerEndpointInput
  now: string
  findCurrentEndpoint: (endpointId: string) => RemoteEndpointRecord | null
  readToken: (credentialRef: string) => string
  disposeRuntime?: ManagedSshEndpointRuntimeDisposer
  commit: (record: RemoteEndpointRecord) => Promise<void>
}): Promise<RemoteEndpointRecord> {
  const endpointId = normalizeNonEmptyString(options.input.endpointId)
  const matched = options.findCurrentEndpoint(endpointId ?? '')
  if (!endpointId || !matched || matched.accessKind !== 'managed_ssh' || !matched.managedSsh) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Managed SSH endpoint not found: ${endpointId ?? ''}`,
    })
  }

  createManagedSshEndpointUpdate({
    current: matched,
    update: options.input,
    now: options.now,
  })

  await options.disposeRuntime?.({
    endpointId: matched.endpointId,
    displayName: matched.displayName,
    token: options.readToken(matched.credentialRef),
    ssh: matched.managedSsh,
  })

  const current = options.findCurrentEndpoint(endpointId)
  if (!current || current.accessKind !== 'managed_ssh' || !current.managedSsh) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Managed SSH endpoint not found after runtime disposal: ${endpointId}`,
    })
  }

  const nextRecord = createManagedSshEndpointUpdate({
    current,
    update: options.input,
    now: options.now,
  })
  await options.commit(nextRecord)
  return nextRecord
}
