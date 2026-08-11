export interface PtyHostSpawnOptions {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}
