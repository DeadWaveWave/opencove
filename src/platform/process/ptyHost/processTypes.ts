export interface PtyHostProcess {
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  postMessage(message: unknown, callback?: (error: Error | null) => void): void
  kill(): boolean
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  pid: number | undefined
}

export type PtyHostProcessFactory = (modulePath: string) => PtyHostProcess
