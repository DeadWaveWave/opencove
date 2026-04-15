import type { MountDto, WorkerEndpointDto } from '../../../../shared/contracts/dto'

export const TOPOLOGY_FILE_NAME = 'worker-topology.json'
export const SECRETS_FILE_NAME = 'worker-endpoint-secrets.json'
export const LOCAL_ENDPOINT_TIMESTAMP = new Date(0).toISOString()

export type RemoteEndpointRecord = {
  endpointId: string
  kind: 'remote_worker'
  displayName: string
  hostname: string
  port: number
  credentialRef: string
  createdAt: string
  updatedAt: string
}

export type MountRecord = {
  mountId: string
  projectId: string
  name: string
  sortOrder: number
  endpointId: string
  targetId: string
  rootPath: string
  rootUri: string
  createdAt: string
  updatedAt: string
}

export type TopologyFileV1 = {
  version: 1
  endpoints: RemoteEndpointRecord[]
  mounts: MountRecord[]
}

export type SecretsFileV1 = {
  version: 1
  tokensByCredentialRef: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeHostname(value: unknown): string | null {
  return normalizeNonEmptyString(value)
}

export function normalizePort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const port = Math.floor(value)
  return port > 0 && port <= 65_535 ? port : null
}

function normalizeTimestamp(value: unknown): string | null {
  const raw = normalizeNonEmptyString(value)
  if (!raw) {
    return null
  }

  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function normalizeRemoteEndpointRecord(value: unknown): RemoteEndpointRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const endpointId = normalizeNonEmptyString(value.endpointId)
  if (!endpointId) {
    return null
  }

  if (value.kind !== 'remote_worker') {
    return null
  }

  const displayName = normalizeNonEmptyString(value.displayName) ?? endpointId
  const hostname = normalizeHostname(value.hostname)
  const port = normalizePort(value.port)
  const credentialRef = normalizeNonEmptyString(value.credentialRef) ?? endpointId

  if (!hostname || port === null) {
    return null
  }

  const createdAt = normalizeTimestamp(value.createdAt) ?? new Date().toISOString()
  const updatedAt = normalizeTimestamp(value.updatedAt) ?? createdAt

  return {
    endpointId,
    kind: 'remote_worker',
    displayName,
    hostname,
    port,
    credentialRef,
    createdAt,
    updatedAt,
  }
}

function normalizeMountRecord(value: unknown): MountRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const mountId = normalizeNonEmptyString(value.mountId)
  const projectId =
    normalizeNonEmptyString(value.projectId) ?? normalizeNonEmptyString(value.spaceId)
  const name = normalizeNonEmptyString(value.name)
  const endpointId = normalizeNonEmptyString(value.endpointId)
  const targetId = normalizeNonEmptyString(value.targetId)
  const rootPath = normalizeNonEmptyString(value.rootPath)
  const rootUri = normalizeNonEmptyString(value.rootUri)

  const sortOrderRaw = value.sortOrder
  const sortOrder =
    typeof sortOrderRaw === 'number' && Number.isFinite(sortOrderRaw)
      ? Math.max(0, Math.floor(sortOrderRaw))
      : null

  if (!mountId || !projectId || !name || !endpointId || !targetId || !rootPath || !rootUri) {
    return null
  }

  if (sortOrder === null) {
    return null
  }

  const createdAt = normalizeTimestamp(value.createdAt) ?? new Date().toISOString()
  const updatedAt = normalizeTimestamp(value.updatedAt) ?? createdAt

  return {
    mountId,
    projectId,
    name,
    sortOrder,
    endpointId,
    targetId,
    rootPath,
    rootUri,
    createdAt,
    updatedAt,
  }
}

export function normalizeTopologyFile(value: unknown): TopologyFileV1 {
  if (!isRecord(value) || value.version !== 1) {
    return { version: 1, endpoints: [], mounts: [] }
  }

  const endpoints = Array.isArray(value.endpoints)
    ? value.endpoints
        .map(item => normalizeRemoteEndpointRecord(item))
        .filter((item): item is RemoteEndpointRecord => item !== null)
    : []

  const mounts = Array.isArray(value.mounts)
    ? value.mounts
        .map(item => normalizeMountRecord(item))
        .filter((item): item is MountRecord => item !== null)
    : []

  return {
    version: 1,
    endpoints,
    mounts,
  }
}

export function normalizeSecretsFile(value: unknown): SecretsFileV1 {
  if (!isRecord(value) || value.version !== 1) {
    return { version: 1, tokensByCredentialRef: {} }
  }

  const tokensInput = isRecord(value.tokensByCredentialRef) ? value.tokensByCredentialRef : {}
  const tokens: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(tokensInput)) {
    const credentialRef = key.trim()
    if (credentialRef.length === 0) {
      continue
    }

    const token = normalizeNonEmptyString(rawValue)
    if (!token) {
      continue
    }

    tokens[credentialRef] = token
  }

  return { version: 1, tokensByCredentialRef: tokens }
}

export function toEndpointDto(record: RemoteEndpointRecord): WorkerEndpointDto {
  return {
    endpointId: record.endpointId,
    kind: 'remote_worker',
    displayName: record.displayName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    remote: {
      hostname: record.hostname,
      port: record.port,
    },
  }
}

export function toMountDto(record: MountRecord): MountDto {
  return {
    mountId: record.mountId,
    projectId: record.projectId,
    name: record.name,
    sortOrder: record.sortOrder,
    endpointId: record.endpointId,
    targetId: record.targetId,
    rootPath: record.rootPath,
    rootUri: record.rootUri,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
