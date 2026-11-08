import type { AgentProviderId } from '../../../shared/contracts/dto'

export interface SpawnPtyOptions {
  cwd: string
  agentProvider?: AgentProviderId
  sessionKind?: 'agent' | 'shell'
  shell?: string
  command?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}
