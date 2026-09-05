import type { RuntimeBuildIdentity } from '../../../../shared/contracts/runtimeBuild'

export interface ManagedRuntimeInstallation {
  root: string
  build: RuntimeBuildIdentity
}

export interface ManagedRuntimeObservation {
  instanceId: string
  build: RuntimeBuildIdentity
  phase: 'active' | 'candidate' | 'maintenance' | 'stopping'
  activationId?: string | null
}

export interface ManagedDeploymentRecord {
  version: 1
  revision: number
  operationId: string
  phase: 'prepared' | 'maintenance' | 'stopped' | 'starting' | 'active' | 'recovery_required'
  desired: ManagedRuntimeInstallation
  active: ManagedRuntimeInstallation | null
  previous: ManagedRuntimeInstallation | null
  snapshot: string | null
  instanceId: string | null
  retiredBuildIds?: string[]
}

export interface ManagedDeploymentPort {
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>
  read: () => ManagedDeploymentRecord | null
  write: (record: ManagedDeploymentRecord) => void
  observe: () => Promise<ManagedRuntimeObservation | null>
  maintenance: (
    action: 'acquire' | 'release' | 'stop' | 'activate',
    instanceId: string,
    lease: string,
  ) => Promise<boolean>
  waitStopped: (instanceId: string) => Promise<void>
  snapshot: (operationId: string) => Promise<string>
  start: (
    installation: ManagedRuntimeInstallation,
    operationId: string,
  ) => Promise<ManagedRuntimeObservation>
}
