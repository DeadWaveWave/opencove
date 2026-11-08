export interface PtyHostSpawnOptions {
  command: string
  args: string[]
  cwd: string
  sessionKind?: 'agent' | 'shell'
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}
