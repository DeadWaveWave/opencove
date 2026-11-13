import { writeStreamRecord } from './streamOutput'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { CliError } from './errors'
export interface CliIo {
  stdout: { write(text: string): unknown; isTTY?: boolean }
  stderr: { write(text: string): unknown; isTTY?: boolean }
  readonly outputCancelled?: boolean
  writeRecord?(text: string, signal: AbortSignal): Promise<void>
  readStdinText(): Promise<string>
  readTextFile(path: string): Promise<string>
  env: Record<string, string | undefined>
  fetch: typeof fetch
  now(): number
  signal?: AbortSignal
  dispose?(): void
  profileCandidates?(): string[]
  isProcessAlive?(pid: number): boolean
}
export function createNodeCliIo(): CliIo {
  const controller = new AbortController()
  let cancelledOutput = false
  const interrupt = () => controller.abort(new CliError('cli.interrupted', 130, 'Interrupted'))
  const terminate = () => controller.abort(new CliError('cli.terminated', 143, 'Terminated'))
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  return {
    signal: controller.signal,
    get outputCancelled() {
      return cancelledOutput
    },
    dispose: () => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    },
    async writeRecord(text, signal) {
      const cancelled = () => {
        cancelledOutput = true
      }
      signal.addEventListener('abort', cancelled, { once: true })
      if (signal.aborted) {
        cancelled()
      }
      try {
        await writeStreamRecord(process.stdout, text, signal)
      } finally {
        signal.removeEventListener('abort', cancelled)
      }
    },
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    fetch,
    now: Date.now,
    readTextFile: file => readFile(file, 'utf8'),
    readStdinText() {
      const signal = controller.signal
      const interrupted = () => new CliError('cli.interrupted', 130, 'Interrupted')
      if (signal.aborted) {
        return Promise.reject(interrupted())
      }
      const stdin = process.stdin
      return new Promise<string>((resolve, reject) => {
        const decoder = new StringDecoder('utf8')
        let text = ''
        const cleanup = () => {
          stdin.pause()
          stdin.off('data', onData)
          stdin.off('end', onEnd)
          stdin.off('error', onError)
          stdin.off('close', onClose)
          signal.removeEventListener('abort', onAbort)
        }
        const onData = (chunk: Buffer | string) => {
          text += decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        }
        const onEnd = () => {
          cleanup()
          resolve(text + decoder.end())
        }
        const onError = (error: Error) => {
          cleanup()
          reject(error)
        }
        const onClose = () => onError(new Error('Stdin closed before end of input'))
        const onAbort = () => onError(interrupted())
        stdin.on('data', onData)
        stdin.once('end', onEnd)
        stdin.once('error', onError)
        stdin.once('close', onClose)
        signal.addEventListener('abort', onAbort, { once: true })
        if (stdin.readableEnded) {
          onEnd()
        } else if (stdin.destroyed) {
          onClose()
        }
      })
    },
    profileCandidates() {
      const home = os.homedir()
      const root =
        process.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support')
          : process.platform === 'win32'
            ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
            : process.env.XDG_CONFIG_HOME || path.join(home, '.config')
      return ['opencove-dev', 'opencove'].map(name => path.join(root, name))
    },
    isProcessAlive(pid) {
      if (!Number.isInteger(pid) || pid <= 0) {
        return false
      }
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        // EPERM means the process exists but belongs to another user or sandbox.
        return (error as NodeJS.ErrnoException).code === 'EPERM'
      }
    },
  }
}
