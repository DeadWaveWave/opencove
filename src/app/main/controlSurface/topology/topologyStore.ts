import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  CreateMountInput,
  CreateMountResult,
  ListMountsInput,
  ListMountsResult,
  RegisterManagedSshWorkerEndpointInput,
  RegisterManagedSshWorkerEndpointResult,
  ListWorkerEndpointsResult,
  PromoteMountInput,
  RegisterWorkerEndpointInput,
  RegisterWorkerEndpointResult,
  RemoveMountInput,
  ResolveMountTargetInput,
  ResolveMountTargetResult,
  UpdateManagedSshWorkerEndpointInput,
  UpdateManagedSshWorkerEndpointResult,
} from '../../../../shared/contracts/dto'
import {
  resolveEndpointRemovalImpact,
  resolveEndpointRemovalImpacts,
  type EndpointRemovalImpact,
} from '../../../../contexts/topology/domain/endpointRemovalImpact'
import {
  SECRETS_FILE_NAME,
  TOPOLOGY_FILE_NAME,
  type MountRecord,
  normalizeNonEmptyString,
  type SecretsFileV1,
  type TopologyFileV1,
  toEndpointDto,
  toLocalEndpointDto,
  toMountDto,
} from './topologyFileV1'
import {
  type EndpointRuntimeAccess,
  type ManagedSshEndpointConnectionResolver,
  type ManagedSshEndpointRuntimeDisposer,
  type RemoteEndpointConnection,
} from './topologyEndpointAccess'
import {
  createManagedSshEndpointRegistration,
  createManualEndpointRegistration,
} from './topologyEndpointRegistration'
import { removeTopologyEndpoint } from './topologyEndpointRemoval'
import { runManagedSshEndpointUpdate } from './topologyManagedSshUpdate'
import { createTopologyMutationQueue, type TopologyPersistenceIssue } from './topologyWriteQueue'
import { persistTopologyState, readTopologyState, type TopologyState } from './topologyPersistence'
import type { WorkerTopologyStore } from './topologyStoreTypes'
export type { WorkerTopologyStore } from './topologyStoreTypes'

export function createWorkerTopologyStore(options: {
  userDataPath: string
  resolveManagedSshEndpointConnection?: ManagedSshEndpointConnectionResolver
  disposeManagedSshEndpointRuntime?: ManagedSshEndpointRuntimeDisposer
  writeFileImpl?: typeof writeFile
}): WorkerTopologyStore {
  const topologyPath = resolve(options.userDataPath, TOPOLOGY_FILE_NAME)
  const secretsPath = resolve(options.userDataPath, SECRETS_FILE_NAME)
  let loaded = false
  let loadPromise: Promise<void> | null = null
  let topology: TopologyFileV1 = { version: 1, endpoints: [], mounts: [] }
  let secrets: SecretsFileV1 = { version: 1, tokensByCredentialRef: {} }

  const readDurableState = async (): Promise<TopologyState> =>
    await readTopologyState({ topologyPath, secretsPath })

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) {
      return
    }

    loadPromise ??= (async () => {
      const durable = await readDurableState()
      topology = durable.topology
      secrets = durable.secrets
      loaded = true
    })()

    try {
      await loadPromise
    } finally {
      if (!loaded) {
        loadPromise = null
      }
    }
  }

  const persist = async (state: TopologyState): Promise<void> =>
    await persistTopologyState({
      topologyPath,
      secretsPath,
      state,
      writeFileImpl: options.writeFileImpl,
    })

  const mutationQueue = createTopologyMutationQueue({
    getCommittedState: () => ({ topology, secrets }),
    replaceCommittedState: state => {
      topology = state.topology
      secrets = state.secrets
    },
    readDurableState,
    persist,
  })

  const listEndpoints = async (): Promise<ListWorkerEndpointsResult> => {
    await ensureLoaded()

    const local = toLocalEndpointDto()
    const endpoints = [local, ...topology.endpoints.map(toEndpointDto)]
    endpoints.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return { endpoints }
  }

  const registerEndpoint = async (
    input: RegisterWorkerEndpointInput,
  ): Promise<RegisterWorkerEndpointResult> => {
    await ensureLoaded()
    let registration: ReturnType<typeof createManualEndpointRegistration> | null = null

    return await mutationQueue.enqueue({
      operation: 'endpoint.register',
      apply: draft => {
        registration ??= createManualEndpointRegistration(input, new Date().toISOString())
        const { record, token } = registration
        const existingIndex = draft.topology.endpoints.findIndex(
          endpoint => endpoint.endpointId === record.endpointId,
        )
        if (existingIndex === -1) {
          draft.topology.endpoints.push(record)
        } else {
          draft.topology.endpoints[existingIndex] = record
        }
        draft.secrets.tokensByCredentialRef[record.credentialRef] = token
        return { endpoint: toEndpointDto(record) }
      },
    })
  }

  const registerManagedSshEndpoint = async (
    input: RegisterManagedSshWorkerEndpointInput,
  ): Promise<RegisterManagedSshWorkerEndpointResult> => {
    await ensureLoaded()
    let registration: ReturnType<typeof createManagedSshEndpointRegistration> | null = null

    return await mutationQueue.enqueue({
      operation: 'endpoint.registerManagedSsh',
      apply: draft => {
        registration ??= createManagedSshEndpointRegistration(
          input,
          draft.topology.endpoints
            .map(endpoint => endpoint.managedSsh?.remotePort)
            .filter((candidate): candidate is number => typeof candidate === 'number'),
          new Date().toISOString(),
        )
        const { record, token } = registration
        const existingIndex = draft.topology.endpoints.findIndex(
          endpoint => endpoint.endpointId === record.endpointId,
        )
        if (existingIndex === -1) {
          draft.topology.endpoints.push(record)
        } else {
          draft.topology.endpoints[existingIndex] = record
        }
        draft.secrets.tokensByCredentialRef[record.credentialRef] = token
        return { endpoint: toEndpointDto(record) }
      },
    })
  }

  const updateManagedSshEndpoint = async (
    input: UpdateManagedSshWorkerEndpointInput,
  ): Promise<UpdateManagedSshWorkerEndpointResult> => {
    await ensureLoaded()
    const nextRecord = await runManagedSshEndpointUpdate({
      input,
      now: new Date().toISOString(),
      findCurrentEndpoint: endpointId =>
        topology.endpoints.find(endpoint => endpoint.endpointId === endpointId) ?? null,
      readToken: credentialRef => secrets.tokensByCredentialRef[credentialRef] ?? '',
      disposeRuntime: options.disposeManagedSshEndpointRuntime,
      commit: async record => {
        await mutationQueue.enqueue({
          operation: 'endpoint.updateManagedSsh',
          apply: draft => {
            const matched = draft.topology.endpoints.find(
              endpoint => endpoint.endpointId === record.endpointId,
            )
            if (!matched) {
              throw createAppError('common.invalid_input', {
                debugMessage: `Managed SSH endpoint not found: ${record.endpointId}`,
              })
            }

            draft.topology.endpoints = draft.topology.endpoints.map(endpoint =>
              endpoint.endpointId === record.endpointId ? record : endpoint,
            )
          },
        })
      },
    })

    return { endpoint: toEndpointDto(nextRecord) }
  }

  const getEndpointRemovalImpact = async (endpointId: string): Promise<EndpointRemovalImpact> => {
    await ensureLoaded()
    return resolveEndpointRemovalImpact(endpointId, topology.mounts)
  }

  const getEndpointRemovalImpacts = async (
    endpointIds: readonly string[],
  ): Promise<ReadonlyMap<string, EndpointRemovalImpact>> => {
    await ensureLoaded()
    return resolveEndpointRemovalImpacts(endpointIds, topology.mounts)
  }

  const removeEndpoint: WorkerTopologyStore['removeEndpoint'] = async input => {
    await ensureLoaded()
    return await removeTopologyEndpoint({
      input,
      mutationQueue,
      disposeManagedSshEndpointRuntime: options.disposeManagedSshEndpointRuntime,
    })
  }

  const resolveEndpointRuntimeAccess = async (
    endpointId: string,
  ): Promise<EndpointRuntimeAccess | null> => {
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

    const endpointDto = toEndpointDto(endpoint)
    if (endpoint.accessKind === 'managed_ssh' && endpoint.managedSsh) {
      return {
        endpoint: endpointDto,
        token,
        kind: 'managed_ssh',
        managedSsh: endpoint.managedSsh,
      }
    }

    return {
      endpoint: endpointDto,
      token,
      kind: 'manual',
      connection: {
        hostname: endpoint.hostname,
        port: endpoint.port,
        token,
      },
    }
  }

  const resolveRemoteEndpointConnection = async (
    endpointId: string,
  ): Promise<RemoteEndpointConnection | null> => {
    const access = await resolveEndpointRuntimeAccess(endpointId)
    if (!access) {
      return null
    }

    if (access.kind === 'manual') {
      return access.connection
    }

    return (
      (await options.resolveManagedSshEndpointConnection?.({
        endpointId: access.endpoint.endpointId,
        displayName: access.endpoint.displayName,
        token: access.token,
        ssh: access.managedSsh,
      })) ?? null
    )
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

    const name =
      normalizeNonEmptyString(input.name) ??
      (endpointId === 'local' ? 'Local' : `Remote (${endpointId.slice(0, 8)})`)
    const now = new Date().toISOString()
    const mountId = randomUUID()
    const targetId = randomUUID()
    const rootUri = toFileUri(rootPath)

    return await mutationQueue.enqueue({
      operation: 'mount.create',
      apply: draft => {
        if (
          endpointId !== 'local' &&
          !draft.topology.endpoints.some(endpoint => endpoint.endpointId === endpointId)
        ) {
          throw createAppError('common.invalid_input', {
            debugMessage: `Unknown endpointId: ${endpointId}`,
          })
        }

        const existing =
          draft.topology.mounts.find(candidate => candidate.mountId === mountId) ?? null
        const sortOrder =
          existing?.sortOrder ??
          draft.topology.mounts
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

        if (existing) {
          draft.topology.mounts = draft.topology.mounts.map(mount =>
            mount.mountId === mountId ? record : mount,
          )
        } else {
          draft.topology.mounts.push(record)
        }
        return { mount: toMountDto(record) }
      },
    })
  }

  const removeMount = async (input: RemoveMountInput): Promise<void> => {
    await ensureLoaded()

    const mountId = normalizeNonEmptyString(input.mountId)
    if (!mountId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mount.remove requires mountId.',
      })
    }

    await mutationQueue.enqueue({
      operation: 'mount.remove',
      apply: draft => {
        draft.topology.mounts = draft.topology.mounts.filter(mount => mount.mountId !== mountId)
      },
    })
  }

  const promoteMount = async (input: PromoteMountInput): Promise<void> => {
    await ensureLoaded()

    const mountId = normalizeNonEmptyString(input.mountId)
    if (!mountId) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'mount.promote requires mountId.',
      })
    }

    await mutationQueue.enqueue({
      operation: 'mount.promote',
      apply: draft => {
        const selected = draft.topology.mounts.find(candidate => candidate.mountId === mountId)
        if (!selected) {
          return
        }

        const projectId = selected.projectId
        const projectMounts = draft.topology.mounts
          .filter(mount => mount.projectId === projectId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
        const nextMountIds = [
          mountId,
          ...projectMounts.filter(mount => mount.mountId !== mountId).map(mount => mount.mountId),
        ]
        const nextOrderById = new Map<string, number>()
        for (const [index, id] of nextMountIds.entries()) {
          nextOrderById.set(id, index)
        }

        const now = new Date().toISOString()
        draft.topology.mounts = draft.topology.mounts.map(mount => {
          if (mount.projectId !== projectId) {
            return mount
          }

          const nextOrder = nextOrderById.get(mount.mountId)
          if (nextOrder === undefined || mount.sortOrder === nextOrder) {
            return mount
          }

          return { ...mount, sortOrder: nextOrder, updatedAt: now }
        })
      },
    })
  }

  const getPersistenceIssue = async (): Promise<TopologyPersistenceIssue | null> => {
    await ensureLoaded()
    return mutationQueue.getPersistenceIssue()
  }

  const retryPersistence = async (): Promise<void> => {
    await ensureLoaded()
    await mutationQueue.retryPersistence()
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
      projectId: mount.projectId,
      endpointId: mount.endpointId,
      targetId: mount.targetId,
      rootPath: mount.rootPath,
      rootUri: mount.rootUri,
    }
  }

  return {
    listEndpoints,
    registerEndpoint,
    registerManagedSshEndpoint,
    updateManagedSshEndpoint,
    removeEndpoint,
    getEndpointRemovalImpact,
    getEndpointRemovalImpacts,
    resolveEndpointRuntimeAccess,
    resolveRemoteEndpointConnection,
    listMounts,
    createMount,
    removeMount,
    promoteMount,
    resolveMountTarget,
    getPersistenceIssue,
    retryPersistence,
  }
}
