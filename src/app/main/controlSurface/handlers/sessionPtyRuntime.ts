export interface ControlSurfacePtyRuntime {
  spawnSession: (options: {
    cwd: string
    cols: number
    rows: number
    command: string
    args: string[]
    env?: NodeJS.ProcessEnv
  }) => Promise<{ sessionId: string }>
  kill: (sessionId: string) => void
}
