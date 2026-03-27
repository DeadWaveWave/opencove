export type WorkerEndpointKind = 'local'

// Landing: only implicit local exists. Remote endpoints arrive later.
export type WorkerEndpointId = 'local'

export interface WorkerEndpointRef {
  id: WorkerEndpointId
  kind: WorkerEndpointKind
}

export const LOCAL_WORKER_ENDPOINT: WorkerEndpointRef = {
  id: 'local',
  kind: 'local',
}
