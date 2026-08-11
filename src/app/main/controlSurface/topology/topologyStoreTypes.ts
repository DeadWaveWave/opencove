import type {
  CreateMountInput,
  CreateMountResult,
  ListMountsInput,
  ListMountsResult,
  ListWorkerEndpointsResult,
  PromoteMountInput,
  RegisterManagedSshWorkerEndpointInput,
  RegisterManagedSshWorkerEndpointResult,
  RegisterWorkerEndpointInput,
  RegisterWorkerEndpointResult,
  RemoveMountInput,
  RemoveWorkerEndpointInput,
  RemoveWorkerEndpointResult,
  ResolveMountTargetInput,
  ResolveMountTargetResult,
  UpdateManagedSshWorkerEndpointInput,
  UpdateManagedSshWorkerEndpointResult,
} from '../../../../shared/contracts/dto'
import type { EndpointRemovalImpact } from '../../../../contexts/topology/domain/endpointRemovalImpact'
import type { EndpointRuntimeAccess, RemoteEndpointConnection } from './topologyEndpointAccess'
import type { TopologyPersistenceIssue } from './topologyWriteQueue'

export interface WorkerTopologyStore {
  listEndpoints: () => Promise<ListWorkerEndpointsResult>
  registerEndpoint: (input: RegisterWorkerEndpointInput) => Promise<RegisterWorkerEndpointResult>
  registerManagedSshEndpoint: (
    input: RegisterManagedSshWorkerEndpointInput,
  ) => Promise<RegisterManagedSshWorkerEndpointResult>
  updateManagedSshEndpoint: (
    input: UpdateManagedSshWorkerEndpointInput,
  ) => Promise<UpdateManagedSshWorkerEndpointResult>
  removeEndpoint: (input: RemoveWorkerEndpointInput) => Promise<RemoveWorkerEndpointResult>
  getEndpointRemovalImpact: (endpointId: string) => Promise<EndpointRemovalImpact>
  getEndpointRemovalImpacts: (
    endpointIds: readonly string[],
  ) => Promise<ReadonlyMap<string, EndpointRemovalImpact>>
  resolveEndpointRuntimeAccess: (endpointId: string) => Promise<EndpointRuntimeAccess | null>
  resolveRemoteEndpointConnection: (endpointId: string) => Promise<RemoteEndpointConnection | null>
  listMounts: (input: ListMountsInput) => Promise<ListMountsResult>
  createMount: (input: CreateMountInput) => Promise<CreateMountResult>
  removeMount: (input: RemoveMountInput) => Promise<void>
  promoteMount: (input: PromoteMountInput) => Promise<void>
  resolveMountTarget: (input: ResolveMountTargetInput) => Promise<ResolveMountTargetResult | null>
  getPersistenceIssue?: () => Promise<TopologyPersistenceIssue | null>
  retryPersistence?: () => Promise<void>
}
