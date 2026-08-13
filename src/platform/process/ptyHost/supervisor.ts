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
import { PtyHostExitEvidence } from './hostExitEvidence'
import { PtyHostAmbiguousExitRecovery } from './ambiguousExitRecovery'
import { attachPtyHostProcessLogging } from './processLogging'
import { parsePtyHostResizeResult, type PtyHostResizeResult } from './resizeAck'
export type { PtyHostProcess, PtyHostProcessFactory } from './processTypes'
export type { PtyHostSpawnOptions } from './spawnOptions'
import type {
  PtyHostMessage,
  PtyHostRequest,
  PtyHostSpawnRequest,
  PtyHostWriteEncoding,
  PtyHostResponseMessage,
} from './protocol'
import type { PtyHostProcess, PtyHostProcessFactory } from './processTypes'
import type { PtyHostSpawnOptions } from './spawnOptions'

const READY_TIMEOUT_MS = 5_000
const SPAWN_TIMEOUT_MS = 10_000
const AMBIGUOUS_EXIT_TIMEOUT_MS = 2_000

type UnsubscribeFn = () => void

export class PtyHostSupervisor {
  private readonly createProcess: PtyHostProcessFactory
  private readonly resolveEntryPath: () => string
  private readonly reportIssue: (message: string) => void
  private readonly logFilePath: string | null
  private readonly readyTimeoutMs: number
  private readonly spawnTimeoutMs: number
  private readonly ambiguousExitRecovery: PtyHostAmbiguousExitRecovery

  private readonly dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  private readonly exitListeners = new Set<
    (event: { sessionId: string; exitCode: number }) => void
  >()
  private readonly foregroundListeners = new Set<
    (event: { sessionId: string; agent: 'codex' | null; shellOnly: boolean }) => void
  >()

  private process: PtyHostProcess | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private readonly pendingResponses = new PtyHostPendingResponseCoordinator()
  private readonly hostExitEvidence = new PtyHostExitEvidence()
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
    ambiguousExitTimeoutMs = AMBIGUOUS_EXIT_TIMEOUT_MS,
  }: {
    baseDir: string
    createProcess: PtyHostProcessFactory
    resolveEntryPath?: () => string
    reportIssue?: (message: string) => void
    logFilePath?: string | null
    readyTimeoutMs?: number
    spawnTimeoutMs?: number
    ambiguousExitTimeoutMs?: number
  }) {
    this.createProcess = createProcess
    this.reportIssue = reportIssue ?? (message => process.stderr.write(`${message}\n`))
    this.logFilePath = logFilePath ?? null
    this.readyTimeoutMs = readyTimeoutMs
    this.spawnTimeoutMs = spawnTimeoutMs
    this.ambiguousExitRecovery = new PtyHostAmbiguousExitRecovery(ambiguousExitTimeoutMs)
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

  public onForeground(
    listener: (event: { sessionId: string; agent: 'codex' | null; shellOnly: boolean }) => void,
  ): UnsubscribeFn {
    this.foregroundListeners.add(listener)
    return () => {
      this.foregroundListeners.delete(listener)
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
    this.hostExitEvidence.beginAmbiguousExit(child, 1)
    this.ambiguousExitRecovery.begin(child, () => {
      if (this.isDisposed || this.process !== child) {
        return
      }
      this.reportIssue('[pty-host] ambiguous exit deadline reached; escalating termination')
      try {
        child.kill('SIGKILL')
      } catch {
        // The bounded fence still retires this exact child below.
      }
      if (this.process !== child) {
        return
      }
      this.hostExitEvidence.confirmExit(child, 1)
      this.handleHostExit(1)
    })
    this.pendingResponses.failAll(normalizedError)
    try {
      child.kill()
    } catch {
      // Keep the ambiguous host fenced until a real exit event confirms cleanup.
    }
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

      this.ambiguousExitRecovery.confirm(child)
      const resolvedExitCode = this.hostExitEvidence.confirmExit(child, code)
      if (this.process !== child) {
        return
      }

      this.handleHostExit(resolvedExitCode)
    })

    child.on('error', error => {
      this.handleHostError(child, error)
    })

    attachPtyHostProcessLogging(child, this.logFilePath)
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

    if (message.type === 'foreground') {
      this.foregroundListeners.forEach(listener => listener(message))
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('[pty-host] supervisor disposed')
    }
    this.hostExitEvidence.assertNoAmbiguousExit()

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
        this.handleHostError(child, normalizedError)
      }
    })
    return responsePromise
  }

  public async spawn(options: PtyHostSpawnOptions): Promise<{ sessionId: string }> {
    const env = resolvePtyHostSpawnEnv(options.env)
    const launchId = crypto.randomUUID()
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
        launchId,
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
      const retryIsIdentitySafe = this.hostExitEvidence.isRetrySafe(attemptedChild)
      if (retryIsIdentitySafe && !this.isDisposed) {
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

  public async resize(sessionId: string, cols: number, rows: number): Promise<PtyHostResizeResult> {
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

    return parsePtyHostResizeResult(response.result.sessionId, response.result.resize)
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
    this.ambiguousExitRecovery.dispose()
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
