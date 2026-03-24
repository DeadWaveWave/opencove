export interface SpawnPtyOptions {
  cwd: string
  shell?: string
  command?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}
