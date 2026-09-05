import type {
  ManagedSshEndpointOperationPhase,
  ManagedSshStageFailureCode,
  WorkerEndpointManagedSshDto,
} from '../../../../shared/contracts/dto'

export type ManagedSshEndpointPreparationFailureKind = ManagedSshStageFailureCode | 'tunnel_failed'

export interface ManagedSshEndpointPreparationAccess {
  endpointId: string
  displayName: string
  token: string
  ssh: WorkerEndpointManagedSshDto
}

export interface ManagedSshEndpointPreparationRequest {
  operationId: string
  access: ManagedSshEndpointPreparationAccess
  restartTunnel: boolean
  reinstallRuntime: boolean
  signal: AbortSignal
  reportPhase: (phase: ManagedSshEndpointOperationPhase) => void
}

export type ManagedSshEndpointPreparationResult =
  | { status: 'ready' }
  | { status: 'failed'; failureKind: ManagedSshEndpointPreparationFailureKind }
  | { status: 'cancelled' }

export interface ManagedSshEndpointPreparationPort {
  execute: (
    request: ManagedSshEndpointPreparationRequest,
  ) => Promise<ManagedSshEndpointPreparationResult>
}
