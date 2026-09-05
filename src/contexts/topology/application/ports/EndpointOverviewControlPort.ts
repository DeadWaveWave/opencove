import type {
  PrepareWorkerEndpointInput,
  RepairWorkerEndpointInput,
  WorkerEndpointOverviewDto,
} from '@shared/contracts/dto'

export interface EndpointOverviewControlPort {
  list(): Promise<WorkerEndpointOverviewDto[]>
  prepare(input: PrepareWorkerEndpointInput): Promise<WorkerEndpointOverviewDto>
  repair(input: RepairWorkerEndpointInput): Promise<WorkerEndpointOverviewDto>
}
