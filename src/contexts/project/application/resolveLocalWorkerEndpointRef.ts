import { LOCAL_WORKER_ENDPOINT, type WorkerEndpointRef } from '../domain/workerEndpoint'

export function resolveLocalWorkerEndpointRef(): WorkerEndpointRef {
  return LOCAL_WORKER_ENDPOINT
}
