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
import { PtyHostPendingResponseCoordinator } from './pendingResponseCoordinator'
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
  private readonly pendingResponses = new PtyHostPendingResponseCoordinator()
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

  private normalizeHostError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }

  private handleHostExit(exitCode: number): void {
    const error = new Error(`[pty-host] exited with code ${exitCode}`)
    this.pendingResponses.failAll(error)

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
      this.pendingResponses.resolve(message)
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

  private requestHostResponse(
    child: PtyHostProcess,
    request: PtyHostRequest & { requestId: string },
    timeoutMessage: string,
  ): Promise<PtyHostResponseMessage> {
    const responsePromise = this.pendingResponses.waitFor(request.requestId, {
      timeoutMs: this.spawnTimeoutMs,
      timeoutMessage,
    })
    postPtyHostMessage(child, request, error => {
      const normalizedError = this.normalizeHostError(error)
      this.pendingResponses.reject(request.requestId, normalizedError)
      if (this.process === child) {
        this.handleHostExit(1)
      }
    })
    return responsePromise
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

      const responsePromise = this.requestHostResponse(
        child,
        request satisfies PtyHostRequest & { requestId: string },
        `[pty-host] spawn timeout after ${this.spawnTimeoutMs}ms`,
      )
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

  public async resize(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<{ sessionId: string; cols: number; rows: number }> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`[pty-host] unknown active session: ${sessionId}`)
    }

    await this.ensureReady()
    const child = this.process
    if (!child) {
      throw new Error('[pty-host] missing process')
    }

    const requestId = crypto.randomUUID()
    const responsePromise = this.requestHostResponse(
      child,
      { type: 'resize', requestId, sessionId, cols, rows } satisfies PtyHostRequest,
      `[pty-host] resize timeout after ${this.spawnTimeoutMs}ms`,
    )
    const response = await responsePromise
    if (!response.ok) {
      throw new Error(
        `[pty-host] resize failed: ${response.error.name ?? 'Error'}: ${response.error.message}`,
      )
    }

    return {
      sessionId: response.result.sessionId,
      cols: response.result.cols ?? cols,
      rows: response.result.rows ?? rows,
    }
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
    this.pendingResponses.failAll(new Error('[pty-host] supervisor disposed'))
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
