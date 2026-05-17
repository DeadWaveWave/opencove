export interface WorkerConnectionInfoDto {
  version: number
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
  appVersion: string | null
  startedBy?: 'cli' | 'desktop'
}

export interface WorkerStatusResult {
  status: 'running' | 'stopped'
  connection: WorkerConnectionInfoDto | null
}
