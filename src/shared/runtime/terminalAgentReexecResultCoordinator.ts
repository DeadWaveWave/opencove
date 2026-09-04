import type { TerminalAgentReexecResult } from '../contracts/dto'

type PendingResult = {
  readonly reject: (error: Error) => void
  readonly resolve: (result: TerminalAgentReexecResult) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export class TerminalAgentReexecResultCoordinator {
  private readonly pendingBySessionId = new Map<string, Map<string, PendingResult>>()

  public waitFor(options: {
    sessionId: string
    operationId: string
    timeoutMs: number
  }): Promise<TerminalAgentReexecResult> {
    const pendingByOperationId = this.pendingBySessionId.get(options.sessionId) ?? new Map()
    if (pendingByOperationId.has(options.operationId)) {
      return Promise.reject(new Error('Terminal Agent re-exec operation is already pending.'))
    }
    this.pendingBySessionId.set(options.sessionId, pendingByOperationId)
    return new Promise<TerminalAgentReexecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.take(options.sessionId, options.operationId)
        reject(new Error(`Timed out waiting for terminal Agent re-exec: ${options.sessionId}`))
      }, options.timeoutMs)
      pendingByOperationId.set(options.operationId, { reject, resolve, timer })
    })
  }

  public resolve(result: TerminalAgentReexecResult): boolean {
    const pending = this.take(result.sessionId, result.operationId)
    if (!pending) {
      return false
    }
    pending.resolve(result)
    return true
  }

  public reject(sessionId: string, operationId: string, error: Error): boolean {
    const pending = this.take(sessionId, operationId)
    if (!pending) {
      return false
    }
    pending.reject(error)
    return true
  }

  public rejectSession(sessionId: string, error: Error): void {
    const pendingByOperationId = this.pendingBySessionId.get(sessionId)
    if (!pendingByOperationId) {
      return
    }
    this.pendingBySessionId.delete(sessionId)
    pendingByOperationId.forEach(pending => {
      clearTimeout(pending.timer)
      pending.reject(error)
    })
  }

  public rejectAll(error: Error): void {
    const sessionIds = [...this.pendingBySessionId.keys()]
    sessionIds.forEach(sessionId => this.rejectSession(sessionId, error))
  }

  private take(sessionId: string, operationId: string): PendingResult | null {
    const pendingByOperationId = this.pendingBySessionId.get(sessionId)
    const pending = pendingByOperationId?.get(operationId) ?? null
    if (!pending || !pendingByOperationId) {
      return null
    }
    clearTimeout(pending.timer)
    pendingByOperationId.delete(operationId)
    if (pendingByOperationId.size === 0) {
      this.pendingBySessionId.delete(sessionId)
    }
    return pending
  }
}
