export type WorkerEndpointKind = 'local' | 'remote_worker'

// Durable registry ids (M6): `local` or an opaque id.
export type WorkerEndpointId = string

export interface WorkerEndpointRef {
  endpointId: WorkerEndpointId
  kind: WorkerEndpointKind
}

export const LOCAL_WORKER_ENDPOINT: WorkerEndpointRef = {
  endpointId: 'local',
  kind: 'local',
}
