import { readFile } from 'node:fs/promises'
import type {
  WorkerEndpointDto,
  WorkerEndpointManagedSshDto,
} from '../../../../shared/contracts/dto'

export async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export type RemoteEndpointConnection = {
  hostname: string
  port: number
  token: string
}

export type ManagedSshEndpointRuntimeAccess = {
  endpointId: string
  displayName: string
  token: string
  ssh: WorkerEndpointManagedSshDto
}

export type EndpointRuntimeAccess =
  | {
      endpoint: WorkerEndpointDto
      token: string
      kind: 'manual'
      connection: RemoteEndpointConnection
    }
  | {
      endpoint: WorkerEndpointDto
      token: string
      kind: 'managed_ssh'
      managedSsh: ManagedSshEndpointRuntimeAccess['ssh']
    }

export type ManagedSshEndpointConnectionResolver = (
  access: ManagedSshEndpointRuntimeAccess,
) => Promise<RemoteEndpointConnection | null>

export type ManagedSshEndpointRuntimeDisposer = (
  access: ManagedSshEndpointRuntimeAccess,
) => Promise<void> | void
