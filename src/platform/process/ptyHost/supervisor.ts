import {
  PTY_HOST_PROTOCOL_VERSION,
  isPtyHostMessage,
  isPtyHostReadyEnvelope,
  readPtyHostResponseIdentity,
  readPtyHostSpawnSuccessRetirementIdentity,
  type PtyHostMessage,
  type PtyHostReadyEnvelope,
  type PtyHostRequest,
  type PtyHostSpawnRequest,
  type PtyHostWriteEncoding,
  type PtyHostForegroundEvent,
  type PtyHostResponseMessage,
} from './protocol'
import { resolvePtyHostSpawnEnv } from './spawnEnv'
import {
  nowMs,
  normalizePtyHostError,
  PtyHostHandshakeError,
  resolveBackoffDelay,
  resolveBundledPtyHostEntryPath,
  sleep,
} from './supervisorSupport'
import { postIdentifiedPtyHostMessage, postPtyHostMessage } from './postMessage'
import { PtyHostPendingResponseCoordinator } from './pendingResponseCoordinator'
import { PtyHostExitEvidence } from './hostExitEvidence'
import { PtyHostAmbiguousExitRecovery } from './ambiguousExitRecovery'
import { attachPtyHostProcessLogging } from './processLogging'
import { parsePtyHostResizeResult, type PtyHostResizeResult } from './resizeAck'
import { PtyHostSupervisorEventBus } from './supervisorEventBus'
import { PtyHostSupervisorReadyState } from './supervisorReadyState'
import { PtyHostSessionEventOwner } from './ptyHostSessionEventOwner'
import { handlePtyHostResponse } from './ptyHostResponseOwner'
import type {
  PtyHostProcess,
  PtyHostProcessFactory,
  PtyHostSupervisorOptions,
} from './processTypes'
import type { PtyHostSpawnOptions } from './spawnOptions'
export type { PtyHostProcess, PtyHostProcessFactory, PtyHostSpawnOptions }

const READY_TIMEOUT_MS = 5_000
const SPAWN_TIMEOUT_MS = 10_000
const AMBIGUOUS_EXIT_TIMEOUT_MS = 2_000

export class PtyHostSupervisor {
  private readonly createProcess: PtyHostProcessFactory
  private readonly resolveEntryPath: () => string
  private readonly reportIssue: (message: string) => void
  private readonly logFilePath: string | null
  private readonly readyTimeoutMs: number
  private readonly spawnTimeoutMs: number
  private readonly ambiguousExitRecovery: PtyHostAmbiguousExitRecovery
  private readonly readyState = new PtyHostSupervisorReadyState()
  private readonly events = new PtyHostSupervisorEventBus()
  private readonly sessionEvents: PtyHostSessionEventOwner
  private process: PtyHostProcess | null = null
  private readonly pendingResponses = new PtyHostPendingResponseCoordinator()
  private readonly hostExitEvidence = new PtyHostExitEvidence()
  private hostInstanceId: string | null = null

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
  }: PtyHostSupervisorOptions) {
    this.createProcess = createProcess
    this.reportIssue = reportIssue ?? (message => process.stderr.write(`${message}\n`))
    this.logFilePath = logFilePath ?? null
    this.sessionEvents = new PtyHostSessionEventOwner({
      emitData: event => this.events.emitData(event),
      emitExit: event => this.events.emitExit(event),
      retireUnowned: sessionId => {
        postIdentifiedPtyHostMessage(
          this.process,
          this.hostInstanceId,
          hostInstanceId => ({ type: 'kill', hostInstanceId, sessionId }),
          (child, error) => this.handleHostError(child, error),
        )
      },
    })
    this.readyTimeoutMs = readyTimeoutMs
    this.spawnTimeoutMs = spawnTimeoutMs
    this.ambiguousExitRecovery = new PtyHostAmbiguousExitRecovery(ambiguousExitTimeoutMs)
    this.resolveEntryPath = resolveEntryPath ?? (() => resolveBundledPtyHostEntryPath(baseDir))
  }
  public onData(listener: (event: { sessionId: string; data: string }) => void): () => void {
    return this.events.onData(listener)
  }
  public onExit(listener: (event: { sessionId: string; exitCode: number }) => void): () => void {
    return this.events.onExit(listener)
  }
  public onForeground(listener: (event: PtyHostForegroundEvent) => void): () => void {
    return this.events.onForeground(listener)
  }

  private handleHostExit(exitCode: number): void {
    const error = new Error(`[pty-host] exited with code ${exitCode}`)
    this.pendingResponses.failAll(error)

    this.sessionEvents.failAll(exitCode)

    if (this.readyState.promise) {
      this.readyState.fail(error)
    }

    this.process = null
    this.hostInstanceId = null

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

    const normalizedError = normalizePtyHostError(error)
    this.reportIssue(`[pty-host] process error: ${normalizedError.message}`)
    this.hostExitEvidence.beginAmbiguousExit(child, 1)
    this.ambiguousExitRecovery.begin(child, () => {
      if (this.isDisposed || this.process !== child) {
        return
      }
      this.reportIssue('[pty-host] ambiguous exit deadline reached; escalating termination')
      try {
        child.kill('SIGKILL')
      } catch (killError) {
        const failure = normalizePtyHostError(killError)
        this.reportIssue(`[pty-host] exact-child SIGKILL failed: ${failure.message}`)
      }
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
    this.hostInstanceId = null

    this.readyState.begin(this.readyTimeoutMs, () => {
      const error = new Error(`[pty-host] ready timeout after ${this.readyTimeoutMs}ms`)
      this.reportIssue(error.message)
      this.readyState.fail(error)
      this.handleHostError(child, error)
    })

    child.on('message', raw => {
      if (this.process !== child) {
        return
      }

      if (isPtyHostReadyEnvelope(raw)) {
        this.handleHostMessage(raw)
        return
      }

      if (!isPtyHostMessage(raw)) {
        const responseIdentity = readPtyHostResponseIdentity(raw)
        if (responseIdentity?.hostInstanceId === this.hostInstanceId) {
          const expectedRequestType = this.pendingResponses.expectedRequestType(
            responseIdentity.requestId,
          )
          const spawnIdentity = readPtyHostSpawnSuccessRetirementIdentity(raw)
          const error = new Error('[pty-host] malformed response')
          this.pendingResponses.reject(responseIdentity.requestId, error)
          if (spawnIdentity?.hostInstanceId === this.hostInstanceId) {
            this.sessionEvents.resolveSpawn(spawnIdentity.sessionId, false)
          } else if (expectedRequestType === 'spawn') {
            this.handleHostError(child, error)
          }
        }
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

  private handleHostMessage(message: PtyHostMessage | PtyHostReadyEnvelope): void {
    if (message.type === 'ready') {
      if (message.protocolVersion !== PTY_HOST_PROTOCOL_VERSION) {
        const error = new PtyHostHandshakeError(
          `[pty-host] protocol mismatch: expected ${PTY_HOST_PROTOCOL_VERSION}, got ${message.protocolVersion}`,
        )
        this.reportIssue(error.message)
        const child = this.process
        if (child) {
          this.readyState.fail(error)
          this.handleHostError(child, error)
        }
        return
      }

      if (this.hostInstanceId && this.hostInstanceId !== message.hostInstanceId) {
        const error = new PtyHostHandshakeError(
          '[pty-host] ready host instance changed on a live process',
        )
        this.reportIssue(error.message)
        const child = this.process
        if (child) {
          this.readyState.fail(error)
          this.handleHostError(child, error)
        }
        return
      }

      this.hostInstanceId = message.hostInstanceId
      this.restartAttempt = 0
      this.nextStartAllowedAtMs = 0
      this.readyState.markReady()
      return
    }

    if (!this.hostInstanceId || message.hostInstanceId !== this.hostInstanceId) {
      return
    }

    if (message.type === 'response') {
      handlePtyHostResponse(
        message,
        this.pendingResponses,
        this.sessionEvents,
        this.process,
        (child, error) => this.handleHostError(child, error),
      )
      return
    }

    if (message.type === 'data') {
      this.sessionEvents.observeData({ sessionId: message.sessionId, data: message.data })
      return
    }

    if (message.type === 'exit') {
      this.sessionEvents.observeExit({
        sessionId: message.sessionId,
        exitCode: message.exitCode,
      })
      return
    }

    if (message.type === 'foreground' && this.sessionEvents.has(message.sessionId)) {
      const { type: _type, ...event } = message
      const { hostInstanceId: _hostInstanceId, ...foregroundEvent } = event
      this.events.emitForeground(foregroundEvent)
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('[pty-host] supervisor disposed')
    }
    this.hostExitEvidence.assertNoAmbiguousExit()

    if (this.process && this.readyState.promise) {
      return await this.readyState.promise
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

    if (!this.readyState.promise) {
      throw new Error('[pty-host] missing ready promise')
    }

    return await this.readyState.promise
  }

  private requestHostResponse(
    child: PtyHostProcess,
    request: Extract<PtyHostRequest, { type: 'spawn' | 'resize' }>,
    timeoutMessage: string,
  ): Promise<PtyHostResponseMessage> {
    const responsePromise = this.pendingResponses.waitFor(request.requestId, {
      timeoutMs: this.spawnTimeoutMs,
      timeoutMessage,
      expectedRequestType: request.type,
      ...(request.type === 'resize' ? { expectedSessionId: request.sessionId } : {}),
    })
    postPtyHostMessage(child, request, error => {
      const normalizedError = normalizePtyHostError(error)
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
      const hostInstanceId = this.hostInstanceId
      if (!child || !hostInstanceId) {
        throw new Error('[pty-host] missing ready process identity')
      }
      attemptedChild = child
      const requestId = crypto.randomUUID()

      const request: PtyHostSpawnRequest = {
        type: 'spawn',
        hostInstanceId,
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
        request,
        `[pty-host] spawn timeout after ${this.spawnTimeoutMs}ms`,
      )
      const response = await responsePromise
      if (!response.ok) {
        throw new Error(
          `[pty-host] spawn failed: ${response.error.name ?? 'Error'}: ${response.error.message}`,
        )
      }
      if (response.requestType !== 'spawn') {
        throw new Error('[pty-host] spawn response type mismatch')
      }
      const sessionId = response.result.sessionId
      return { sessionId }
    }
    try {
      return await spawnOnce()
    } catch (error) {
      const retryIsIdentitySafe = this.hostExitEvidence.isRetrySafe(attemptedChild)
      if (retryIsIdentitySafe && !this.isDisposed && !(error instanceof PtyHostHandshakeError)) {
        return await spawnOnce()
      }
      throw error
    }
  }

  public write(sessionId: string, data: string, encoding: PtyHostWriteEncoding = 'utf8'): void {
    postIdentifiedPtyHostMessage(
      this.process,
      this.hostInstanceId,
      hostInstanceId => ({ type: 'write', hostInstanceId, sessionId, data, encoding }),
      (child, error) => this.handleHostError(child, error),
    )
  }

  public probeForeground(sessionId: string): void {
    if (!this.sessionEvents.has(sessionId)) {
      return
    }
    postIdentifiedPtyHostMessage(
      this.process,
      this.hostInstanceId,
      hostInstanceId => ({ type: 'foreground_probe', hostInstanceId, sessionId }),
      (child, error) => this.handleHostError(child, error),
    )
  }

  public async resize(sessionId: string, cols: number, rows: number): Promise<PtyHostResizeResult> {
    if (!this.sessionEvents.has(sessionId)) {
      throw new Error(`[pty-host] unknown active session: ${sessionId}`)
    }

    await this.ensureReady()
    const child = this.process
    const hostInstanceId = this.hostInstanceId
    if (!child || !hostInstanceId) {
      throw new Error('[pty-host] missing ready process identity')
    }

    const requestId = crypto.randomUUID()
    const responsePromise = this.requestHostResponse(
      child,
      { type: 'resize', hostInstanceId, requestId, sessionId, cols, rows },
      `[pty-host] resize timeout after ${this.spawnTimeoutMs}ms`,
    )
    const response = await responsePromise
    if (!response.ok) {
      throw new Error(
        `[pty-host] resize failed: ${response.error.name ?? 'Error'}: ${response.error.message}`,
      )
    }
    if (response.requestType !== 'resize') {
      throw new Error('[pty-host] resize response type mismatch')
    }

    return parsePtyHostResizeResult(response.result.sessionId, response.result.resize)
  }

  public kill(sessionId: string): void {
    if (!this.sessionEvents.beginTermination(sessionId)) {
      return
    }
    postIdentifiedPtyHostMessage(
      this.process,
      this.hostInstanceId,
      hostInstanceId => ({ type: 'kill', hostInstanceId, sessionId }),
      (child, error) => this.handleHostError(child, error),
    )
  }

  public async crash(): Promise<void> {
    const child = this.process
    if (!child || !this.readyState.promise) {
      return
    }
    const confirmedExit = new Promise<void>(resolve => {
      child.on('exit', () => resolve())
    })
    this.handleHostError(child, new Error('[pty-host] crash requested'))
    await confirmedExit
  }

  public dispose(): void {
    this.isDisposed = true

    this.ambiguousExitRecovery.dispose()
    const disposeError = new Error('[pty-host] supervisor disposed')
    this.readyState.fail(disposeError)
    this.pendingResponses.failAll(disposeError)
    this.sessionEvents.clear()

    const child = this.process
    const hostInstanceId = this.hostInstanceId
    this.process = null
    this.hostInstanceId = null

    if (child) {
      if (hostInstanceId) {
        postPtyHostMessage(child, { type: 'shutdown', hostInstanceId }, () => {
          // The host can already be gone during shutdown; cleanup continues via kill below.
        })
      }

      try {
        child.kill()
      } catch {
        // ignore
      }
    }
  }
}
