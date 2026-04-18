export interface WorkerConnectionInfoDto {
  version: number
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
}

export interface WorkerStatusResult {
  status: 'running' | 'stopped'
  connection: WorkerConnectionInfoDto | null
}
