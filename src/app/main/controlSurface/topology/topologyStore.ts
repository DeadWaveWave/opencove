import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  CreateMountInput,
  CreateMountResult,
  ListMountsInput,
  ListMountsResult,
  ListWorkerEndpointsResult,
  PromoteMountInput,
  RegisterWorkerEndpointInput,
  RegisterWorkerEndpointResult,
  RemoveMountInput,
  RemoveWorkerEndpointInput,
  ResolveMountTargetInput,
  ResolveMountTargetResult,
  WorkerEndpointDto,
} from '../../../../shared/contracts/dto'
import {
  LOCAL_ENDPOINT_TIMESTAMP,
  SECRETS_FILE_NAME,
  TOPOLOGY_FILE_NAME,
  type MountRecord,
  normalizeHostname,
  normalizeNonEmptyString,
  normalizePort,
  normalizeSecretsFile,
  normalizeTopologyFile,
  type RemoteEndpointRecord,
  type SecretsFileV1,
  type TopologyFileV1,
  toEndpointDto,
  toMountDto,
} from './topologyFileV1'

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

type RemoteEndpointConnection = {
  hostname: string
  port: number
  token: string
}

export interface WorkerTopologyStore {
  listEndpoints: () => Promise<ListWorkerEndpointsResult>
  registerEndpoint: (input: RegisterWorkerEndpointInput) => Promise<RegisterWorkerEndpointResult>
  removeEndpoint: (input: RemoveWorkerEndpointInput) => Promise<void>
  resolveRemoteEndpointConnection: (endpointId: string) => Promise<RemoteEndpointConnection | null>

  listMounts: (input: ListMountsInput) => Promise<ListMountsResult>
  createMount: (input: CreateMountInput) => Promise<CreateMountResult>
  removeMount: (input: RemoveMountInput) => Promise<void>
  promoteMount: (input: PromoteMountInput) => Promise<void>
  resolveMountTarget: (input: ResolveMountTargetInput) => Promise<ResolveMountTargetResult | null>
}

export function createWorkerTopologyStore(options: { userDataPath: string }): WorkerTopologyStore {
  const topologyPath = resolve(options.userDataPath, TOPOLOGY_FILE_NAME)
  const secretsPath = resolve(options.userDataPath, SECRETS_FILE_NAME)

  let loaded = false
  let topology: TopologyFileV1 = { version: 1, endpoints: [], mounts: [] }
  let secrets: SecretsFileV1 = { version: 1, tokensByCredentialRef: {} }

  let writeQueue: Promise<void> = Promise.resolve()

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) {
      return
    }

    const [rawTopology, rawSecrets] = await Promise.all([
      readJsonFile(topologyPath),
      readJsonFile(secretsPath),
    ])

    topology = normalizeTopologyFile(rawTopology)
    secrets = normalizeSecretsFile(rawSecrets)
    loaded = true
  }

  const persist = async (): Promise<void> => {
    await mkdir(dirname(topologyPath), { recursive: true })

    const topologyPayload = `${JSON.stringify(topology)}\n`
    const secretsPayload = `${JSON.stringify(secrets)}\n`

    await Promise.all([
      writeFile(topologyPath, topologyPayload, { encoding: 'utf8', mode: 0o600 }),
      writeFile(secretsPath, secretsPayload, { encoding: 'utf8', mode: 0o600 }),
    ])
  }

  const persistQueued = async (): Promise<void> => {
    writeQueue = writeQueue.then(async () => {
      await persist()
    })

    return await writeQueue
  }

  const listEndpoints = async (): Promise<ListWorkerEndpointsResult> => {
    await ensureLoaded()

    const local: WorkerEndpointDto = {
      endpointId: 'local',
      kind: 'local',
      displayName: 'Local',
      createdAt: LOCAL_ENDPOINT_TIMESTAMP,
      updatedAt: LOCAL_ENDPOINT_TIMESTAMP,
      remote: null,
    }

    const endpoints = [local, ...topology.endpoints.map(toEndpointDto)]
    endpoints.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return { endpoints }
  }

  const registerEndpoint = async (
    input: RegisterWorkerEndpointInput,
  ): Promise<RegisterWorkerEndpointResult> => {
    await ensureLoaded()

    const hostname = normalizeHostname(input.hostname)
    const port = normalizePort(input.port)
    const token = normalizeNonEmptyString(input.token)
    if (!hostname || port === null || !token) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'endpoint.register requires hostname/port/token.',
      })
    }

    const displayName = normalizeNonEmptyString(input.displayName) ?? `${hostname}:${String(port)}`

    const now = new Date().toISOString()
    const endpointId = randomUUID()
    const credentialRef = endpointId

    const record: RemoteEndpointRecord = {
      endpointId,
      kind: 'remote_worker',
      displayName,
      hostname,
      port,
      credentialRef,
      createdAt: now,
      updatedAt: now,
    }

    topology.endpoints = [...topology.endpoints, record]
    secrets.tokensByCredentialRef[credentialRef] = token

    await persistQueued()

    return { endpoint: toEndpointDto(record) }
  }

  const removeEndpoint = async (input: RemoveWorkerEndpointInput): Promise<void> => {
    await ensureLoaded()

    const endpointId = normalizeNonEmptyString(input.endpointId)
    if (!endpointId || endpointId === 'local') {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid endpointId.' })
    }

    const matched = topology.endpoints.find(endpoint => endpoint.endpointId === endpointId) ?? null
    if (!matched) {
      return
    }

    topology.endpoints = topology.endpoints.filter(endpoint => endpoint.endpointId !== endpointId)
    topology.mounts = topology.mounts.filter(mount => mount.endpointId !== endpointId)
    delete secrets.tokensByCredentialRef[matched.credentialRef]

    await persistQueued()
  }

  const resolveRemoteEndpointConnection = async (
    endpointId: string,
  ): Promise<RemoteEndpointConnection | null> => {
    await ensureLoaded()

    if (endpointId === 'local') {
      return null
    }

    const endpoint =
      topology.endpoints.find(candidate => candidate.endpointId === endpointId) ?? null
    if (!endpoint) {
      return null
    }

    const token = secrets.tokensByCredentialRef[endpoint.credentialRef]
    if (typeof token !== 'string' || token.trim().length === 0) {
      return null
    }

    return {
      hostname: endpoint.hostname,
      port: endpoint.port,
      token,
    }
  }

  const listMounts = async (input: ListMountsInput): Promise<ListMountsResult> => {
    await ensureLoaded()

    const projectId = normalizeNonEmptyString(input.projectId)
    if (!projectId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mount.list requires projectId.',
      })
    }

    const mounts = topology.mounts
      .filter(mount => mount.projectId === projectId)
      .map(toMountDto)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    return { projectId, mounts }
  }

  const createMount = async (input: CreateMountInput): Promise<CreateMountResult> => {
    await ensureLoaded()

    const projectId = normalizeNonEmptyString(input.projectId)
    const endpointId = normalizeNonEmptyString(input.endpointId)
    const rootPath = normalizeNonEmptyString(input.rootPath)
    if (!projectId || !endpointId || !rootPath) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mount.create requires projectId/endpointId/rootPath.',
      })
    }

    if (endpointId !== 'local') {
      const exists =
        topology.endpoints.some(endpoint => endpoint.endpointId === endpointId) ?? false
      if (!exists) {
        throw createAppError('common.invalid_input', {
          debugMessage: `Unknown endpointId: ${endpointId}`,
        })
      }
    }

    const name =
      normalizeNonEmptyString(input.name) ??
      (endpointId === 'local' ? 'Local' : `Remote (${endpointId.slice(0, 8)})`)

    const now = new Date().toISOString()
    const mountId = randomUUID()
    const targetId = randomUUID()
    const rootUri = toFileUri(rootPath)
    const sortOrder =
      topology.mounts
        .filter(mount => mount.projectId === projectId)
        .reduce((acc, mount) => Math.max(acc, mount.sortOrder), -1) + 1

    const record: MountRecord = {
      mountId,
      projectId,
      name,
      sortOrder,
      endpointId,
      targetId,
      rootPath,
      rootUri,
      createdAt: now,
      updatedAt: now,
    }

    topology.mounts = [...topology.mounts, record]
    await persistQueued()

    return { mount: toMountDto(record) }
  }

  const removeMount = async (input: RemoveMountInput): Promise<void> => {
    await ensureLoaded()

    const mountId = normalizeNonEmptyString(input.mountId)
    if (!mountId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mount.remove requires mountId.',
      })
    }

    const existing = topology.mounts.some(mount => mount.mountId === mountId)
    if (!existing) {
      return
    }

    topology.mounts = topology.mounts.filter(mount => mount.mountId !== mountId)
    await persistQueued()
  }

  const promoteMount = async (input: PromoteMountInput): Promise<void> => {
    await ensureLoaded()

    const mountId = normalizeNonEmptyString(input.mountId)
    if (!mountId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mount.promote requires mountId.',
      })
    }

    const selected = topology.mounts.find(candidate => candidate.mountId === mountId) ?? null
    if (!selected) {
      return
    }

    const projectId = selected.projectId
    const projectMounts = topology.mounts
      .filter(mount => mount.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    if (projectMounts.length === 0) {
      return
    }

    const nextMountIds = [
      mountId,
      ...projectMounts.filter(mount => mount.mountId !== mountId).map(mount => mount.mountId),
    ]

    const nextOrderById = new Map<string, number>()
    for (const [index, id] of nextMountIds.entries()) {
      nextOrderById.set(id, index)
    }

    const now = new Date().toISOString()
    topology.mounts = topology.mounts.map(mount => {
      if (mount.projectId !== projectId) {
        return mount
      }

      const nextOrder = nextOrderById.get(mount.mountId)
      if (nextOrder === undefined || mount.sortOrder === nextOrder) {
        return mount
      }

      return {
        ...mount,
        sortOrder: nextOrder,
        updatedAt: now,
      }
    })

    await persistQueued()
  }

  const resolveMountTarget = async (
    input: ResolveMountTargetInput,
  ): Promise<ResolveMountTargetResult | null> => {
    await ensureLoaded()

    const mountId = normalizeNonEmptyString(input.mountId)
    if (!mountId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mountTarget.resolve requires mountId.',
      })
    }

    const mount = topology.mounts.find(candidate => candidate.mountId === mountId) ?? null
    if (!mount) {
      return null
    }

    return {
      mountId: mount.mountId,
      endpointId: mount.endpointId,
      targetId: mount.targetId,
      rootPath: mount.rootPath,
      rootUri: mount.rootUri,
    }
  }

  return {
    listEndpoints,
    registerEndpoint,
    removeEndpoint,
    resolveRemoteEndpointConnection,
    listMounts,
    createMount,
    removeMount,
    promoteMount,
    resolveMountTarget,
  }
}
