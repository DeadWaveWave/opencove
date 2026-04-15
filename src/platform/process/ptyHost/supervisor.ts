import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PTY_HOST_PROTOCOL_VERSION, isPtyHostMessage } from './protocol'
import type {
  PtyHostMessage,
  PtyHostRequest,
  PtyHostSpawnRequest,
  PtyHostWriteEncoding,
  PtyHostResponseMessage,
} from './protocol'

const READY_TIMEOUT_MS = 5_000
const SPAWN_TIMEOUT_MS = 10_000
const RESTART_BACKOFF_BASE_DELAY_MS = 250
const RESTART_BACKOFF_MAX_DELAY_MS = 15_000

export interface PtyHostSpawnOptions {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export interface PtyHostProcess {
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  postMessage(message: unknown): void
  kill(): boolean
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  pid: number | undefined
}

export type PtyHostProcessFactory = (modulePath: string) => PtyHostProcess

type UnsubscribeFn = () => void

function resolveBackoffDelay(attempt: number): number {
  if (attempt <= 0) {
    return RESTART_BACKOFF_BASE_DELAY_MS
  }
  const delay = RESTART_BACKOFF_BASE_DELAY_MS * 2 ** attempt
  return Math.min(delay, RESTART_BACKOFF_MAX_DELAY_MS)
}

function nowMs(): number {
  return Date.now()
}

function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve()
  }
  return new Promise(resolve => {
    setTimeout(resolve, delayMs)
  })
}

function resolveBundledPtyHostEntryPath(baseDir: string): string {
  const candidates = [join(baseDir, 'ptyHost.js'), join(baseDir, '..', 'ptyHost.js')]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`[pty-host] missing entry: ${candidates.join(', ')}`)
  }

  return resolved
}

export class PtyHostSupervisor {
  private readonly createProcess: PtyHostProcessFactory
  private readonly resolveEntryPath: () => string
  private readonly reportIssue: (message: string) => void
  private readonly logFilePath: string | null
  private readonly readyTimeoutMs: number
  private readonly spawnTimeoutMs: number

  private readonly dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  private readonly exitListeners = new Set<
    (event: { sessionId: string; exitCode: number }) => void
  >()

  private process: PtyHostProcess | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private pendingResponses = new Map<
    string,
    {
      resolve: (message: PtyHostResponseMessage) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private activeSessions = new Set<string>()

  private isDisposed = false
  private restartAttempt = 0
  private nextStartAllowedAtMs = 0

  public constructor({
    baseDir,
    createProcess,
    resolveEntryPath,
    reportIssue,
    logFilePath,
    readyTimeoutMs = READY_TIMEOUT_MS,
    spawnTimeoutMs = SPAWN_TIMEOUT_MS,
  }: {
    baseDir: string
    createProcess: PtyHostProcessFactory
    resolveEntryPath?: () => string
    reportIssue?: (message: string) => void
    logFilePath?: string | null
    readyTimeoutMs?: number
    spawnTimeoutMs?: number
  }) {
    this.createProcess = createProcess
    this.reportIssue = reportIssue ?? (message => process.stderr.write(`${message}\n`))
    this.logFilePath = logFilePath ?? null
    this.readyTimeoutMs = readyTimeoutMs
    this.spawnTimeoutMs = spawnTimeoutMs
    this.resolveEntryPath = resolveEntryPath ?? (() => resolveBundledPtyHostEntryPath(baseDir))
  }

  public onData(listener: (event: { sessionId: string; data: string }) => void): UnsubscribeFn {
    this.dataListeners.add(listener)
    return () => {
      this.dataListeners.delete(listener)
    }
  }

  public onExit(listener: (event: { sessionId: string; exitCode: number }) => void): UnsubscribeFn {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  private emitData(sessionId: string, data: string): void {
    this.dataListeners.forEach(listener => {
      listener({ sessionId, data })
    })
  }

  private emitExit(sessionId: string, exitCode: number): void {
    this.exitListeners.forEach(listener => {
      listener({ sessionId, exitCode })
    })
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) {
      return
    }

    clearTimeout(this.readyTimer)
    this.readyTimer = null
  }

  private failReady(error: Error): void {
    this.clearReadyTimer()

    this.rejectReady?.(error)
    this.resolveReady = null
    this.rejectReady = null
    this.readyPromise = null
  }

  private markReady(): void {
    this.clearReadyTimer()
    this.restartAttempt = 0
    this.nextStartAllowedAtMs = 0

    this.resolveReady?.()
    this.resolveReady = null
    this.rejectReady = null
  }

  private failPendingResponses(error: Error): void {
    for (const [, pending] of this.pendingResponses.entries()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingResponses.clear()
  }

  private handleHostExit(exitCode: number): void {
    const error = new Error(`[pty-host] exited with code ${exitCode}`)
    this.failPendingResponses(error)

    for (const sessionId of this.activeSessions.values()) {
      this.emitExit(sessionId, exitCode)
    }
    this.activeSessions.clear()

    if (this.readyPromise) {
      this.failReady(error)
    }

    this.process = null

    this.restartAttempt += 1
    const delayMs = resolveBackoffDelay(this.restartAttempt - 1)
    this.nextStartAllowedAtMs = nowMs() + delayMs
  }

  private attachProcessLogging(child: PtyHostProcess): void {
    if (!this.logFilePath) {
      return
    }

    try {
      mkdirSync(dirname(this.logFilePath), { recursive: true })
    } catch {
      // ignore
    }

    const stream = createWriteStream(this.logFilePath, { flags: 'a' })
    stream.write(`[${new Date().toISOString()}] pty-host start pid=${child.pid ?? 'unknown'}\n`)

    const writeChunk = (label: 'stdout' | 'stderr', chunk: unknown): void => {
      try {
        stream.write(`[${label}] ${String(chunk)}`)
      } catch {
        // ignore
      }
    }

    child.stdout?.on('data', chunk => {
      writeChunk('stdout', chunk)
    })

    child.stderr?.on('data', chunk => {
      writeChunk('stderr', chunk)
    })

    child.on('exit', code => {
      stream.write(`[${new Date().toISOString()}] pty-host exit code=${code}\n`)
      stream.end()
    })
  }

  private startHost(): void {
    const entryPath = this.resolveEntryPath()
    const child = this.createProcess(entryPath)
    this.process = child

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })

    this.readyTimer = setTimeout(() => {
      this.reportIssue(`[pty-host] ready timeout after ${this.readyTimeoutMs}ms`)
      child.kill()
      if (this.process === child) {
        this.handleHostExit(1)
      }
    }, this.readyTimeoutMs)

    child.on('message', raw => {
      if (this.process !== child) {
        return
      }

      if (!isPtyHostMessage(raw)) {
        return
      }

      this.handleHostMessage(raw)
    })

    child.on('exit', code => {
      if (this.isDisposed) {
        return
      }

      if (this.process !== child) {
        return
      }

      this.handleHostExit(code)
    })

    this.attachProcessLogging(child)
  }

  private handleHostMessage(message: PtyHostMessage): void {
    if (message.type === 'ready') {
      if (message.protocolVersion !== PTY_HOST_PROTOCOL_VERSION) {
        this.reportIssue(
          `[pty-host] protocol mismatch: expected ${PTY_HOST_PROTOCOL_VERSION}, got ${message.protocolVersion}`,
        )
        this.handleHostExit(1)
        return
      }

      this.markReady()
      return
    }

    if (message.type === 'response') {
      const pending = this.pendingResponses.get(message.requestId)
      if (!pending) {
        return
      }

      clearTimeout(pending.timer)
      this.pendingResponses.delete(message.requestId)
      pending.resolve(message)
      return
    }

    if (message.type === 'data') {
      this.emitData(message.sessionId, message.data)
      return
    }

    if (message.type === 'exit') {
      this.activeSessions.delete(message.sessionId)
      this.emitExit(message.sessionId, message.exitCode)
      return
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('[pty-host] supervisor disposed')
    }

    if (this.process && this.readyPromise) {
      return await this.readyPromise
    }

    const waitMs = Math.max(0, this.nextStartAllowedAtMs - nowMs())
    if (waitMs > 0) {
      await sleep(waitMs)
      if (this.isDisposed) {
        throw new Error('[pty-host] supervisor disposed')
      }
    }

    if (!this.process) {
      this.startHost()
    }

    if (!this.readyPromise) {
      throw new Error('[pty-host] missing ready promise')
    }

    return await this.readyPromise
  }

  public async spawn(options: PtyHostSpawnOptions): Promise<{ sessionId: string }> {
    const env = options.env ? { ...options.env } : { ...process.env }
    // The app uses ELECTRON_RUN_AS_NODE to run bundled CLI/worker entrypoints via Electron.
    // Leaking it into interactive shells breaks launching Electron-based tooling (including
    // OpenCove dev via electron-vite).
    delete env.ELECTRON_RUN_AS_NODE
    let attemptedChild: PtyHostProcess | null = null
    const spawnOnce = async (): Promise<{ sessionId: string }> => {
      await this.ensureReady()
      const child = this.process
      if (!child) {
        throw new Error('[pty-host] missing process')
      }
      attemptedChild = child
      const requestId = crypto.randomUUID()

      const request: PtyHostSpawnRequest = {
        type: 'spawn',
        requestId,
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        env,
        cols: options.cols,
        rows: options.rows,
      }

      const responsePromise = new Promise<PtyHostResponseMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingResponses.delete(requestId)
          reject(new Error(`[pty-host] spawn timeout after ${this.spawnTimeoutMs}ms`))
        }, this.spawnTimeoutMs)

        this.pendingResponses.set(requestId, {
          resolve,
          reject,
          timer,
        })
      })
      try {
        child.postMessage(request satisfies PtyHostRequest)
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        const pending = this.pendingResponses.get(requestId)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingResponses.delete(requestId)
          pending.reject(normalizedError)
        }
        if (this.process === child) {
          this.handleHostExit(1)
        }
      }
      const response = await responsePromise
      if (!response.ok) {
        throw new Error(
          `[pty-host] spawn failed: ${response.error.name ?? 'Error'}: ${response.error.message}`,
        )
      }
      const sessionId = response.result.sessionId
      this.activeSessions.add(sessionId)
      return { sessionId }
    }
    try {
      return await spawnOnce()
    } catch (error) {
      const hostLost =
        !this.process ||
        !this.readyPromise ||
        (attemptedChild !== null && this.process !== attemptedChild)
      if (hostLost && !this.isDisposed) {
        return await spawnOnce()
      }
      throw error
    }
  }

  public write(sessionId: string, data: string, encoding: PtyHostWriteEncoding = 'utf8'): void {
    const child = this.process
    if (!child || !this.readyPromise) {
      return
    }

    child.postMessage({ type: 'write', sessionId, data, encoding } satisfies PtyHostRequest)
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const child = this.process
    if (!child || !this.readyPromise) {
      return
    }

    child.postMessage({ type: 'resize', sessionId, cols, rows } satisfies PtyHostRequest)
  }

  public kill(sessionId: string): void {
    const child = this.process
    this.activeSessions.delete(sessionId)

    if (!child || !this.readyPromise) {
      return
    }

    child.postMessage({ type: 'kill', sessionId } satisfies PtyHostRequest)
  }

  public crash(): void {
    const child = this.process
    if (!child || !this.readyPromise) {
      return
    }

    child.postMessage({ type: 'crash' } satisfies PtyHostRequest)
  }

  public dispose(): void {
    this.isDisposed = true

    this.clearReadyTimer()
    this.failPendingResponses(new Error('[pty-host] supervisor disposed'))
    this.activeSessions.clear()

    const child = this.process
    this.process = null

    if (child) {
      try {
        child.postMessage({ type: 'shutdown' } satisfies PtyHostRequest)
      } catch {
        // ignore
      }

      try {
        child.kill()
      } catch {
        // ignore
      }
    }

    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
  }
}
