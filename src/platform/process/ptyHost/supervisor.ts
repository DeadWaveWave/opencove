import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PTY_HOST_PROTOCOL_VERSION, isPtyHostMessage } from './protocol'
import { resolvePtyHostSpawnEnv } from './spawnEnv'
import {
  nowMs,
  resolveBackoffDelay,
  resolveBundledPtyHostEntryPath,
  sleep,
} from './supervisorSupport'
import { postPtyHostMessage } from './postMessage'
export type { PtyHostProcess, PtyHostProcessFactory } from './processTypes'
import type {
  PtyHostMessage,
  PtyHostRequest,
  PtyHostSpawnRequest,
  PtyHostWriteEncoding,
  PtyHostResponseMessage,
} from './protocol'
import type { PtyHostProcess, PtyHostProcessFactory } from './processTypes'

const READY_TIMEOUT_MS = 5_000
const SPAWN_TIMEOUT_MS = 10_000

export interface PtyHostSpawnOptions {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}

type UnsubscribeFn = () => void

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

  private normalizeHostError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
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

  private handleHostError(child: PtyHostProcess, error: unknown): void {
    if (this.isDisposed) {
      return
    }

    if (this.process !== child) {
      return
    }

    const normalizedError = this.normalizeHostError(error)
    this.reportIssue(`[pty-host] process error: ${normalizedError.message}`)
    this.handleHostExit(1)
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

    child.on('error', error => {
      this.handleHostError(child, error)
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
    const env = resolvePtyHostSpawnEnv(options.env)
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
      const handleSendError = (error: unknown): void => {
        const normalizedError = this.normalizeHostError(error)
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
      postPtyHostMessage(child, request satisfies PtyHostRequest, handleSendError)
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

    postPtyHostMessage(child, { type: 'write', sessionId, data, encoding }, error => {
      this.handleHostError(child, error)
    })
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const child = this.process
    if (!child || !this.readyPromise) {
      return
    }

    postPtyHostMessage(child, { type: 'resize', sessionId, cols, rows }, error => {
      this.handleHostError(child, error)
    })
  }

  public kill(sessionId: string): void {
    const child = this.process
    this.activeSessions.delete(sessionId)

    if (!child || !this.readyPromise) {
      return
    }

    postPtyHostMessage(child, { type: 'kill', sessionId }, error => {
      this.handleHostError(child, error)
    })
  }

  public crash(): void {
    const child = this.process
    if (!child || !this.readyPromise) {
      return
    }

    try {
      child.kill()
    } catch {
      // ignore and force supervisor crash handling below
    }

    if (this.process === child) {
      this.handleHostExit(1)
    }
  }

  public dispose(): void {
    this.isDisposed = true

    this.clearReadyTimer()
    this.failPendingResponses(new Error('[pty-host] supervisor disposed'))
    this.activeSessions.clear()

    const child = this.process
    this.process = null

    if (child) {
      postPtyHostMessage(child, { type: 'shutdown' }, () => {
        // The host can already be gone during shutdown; cleanup continues via kill below.
      })

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
