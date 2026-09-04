import type { PtyHostResponseMessage, PtyHostResponseRequestType } from './protocol'

export type PtyHostPendingResponseResolution =
  | { status: 'accepted' }
  | { status: 'unowned' }
  | {
      status: 'mismatched'
      expectedRequestType: PtyHostResponseRequestType
      expectedSessionId: string | null
    }

type PendingResponse = {
  resolve: (message: PtyHostResponseMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  expectedRequestType: PtyHostResponseRequestType
  expectedSessionId: string | null
}

export class PtyHostPendingResponseCoordinator {
  private readonly pendingByRequestId = new Map<string, PendingResponse>()

  public waitFor(
    requestId: string,
    options: {
      timeoutMs: number
      timeoutMessage: string
      expectedRequestType: PtyHostResponseRequestType
      expectedSessionId?: string
    },
  ): Promise<PtyHostResponseMessage> {
    return new Promise<PtyHostResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingByRequestId.delete(requestId)
        reject(new Error(options.timeoutMessage))
      }, options.timeoutMs)
      this.pendingByRequestId.set(requestId, {
        resolve,
        reject,
        timer,
        expectedRequestType: options.expectedRequestType,
        expectedSessionId: options.expectedSessionId ?? null,
      })
    })
  }

  public expectedRequestType(requestId: string): PtyHostResponseRequestType | null {
    return this.pendingByRequestId.get(requestId)?.expectedRequestType ?? null
  }

  public resolve(message: PtyHostResponseMessage): PtyHostPendingResponseResolution {
    const pending = this.pendingByRequestId.get(message.requestId) ?? null
    if (!pending) {
      return { status: 'unowned' }
    }
    if (
      message.requestType !== pending.expectedRequestType ||
      (message.ok &&
        pending.expectedSessionId !== null &&
        message.result.sessionId !== pending.expectedSessionId)
    ) {
      this.take(message.requestId)
      pending.reject(new Error('[pty-host] response does not match its pending request'))
      return {
        status: 'mismatched',
        expectedRequestType: pending.expectedRequestType,
        expectedSessionId: pending.expectedSessionId,
      }
    }
    this.take(message.requestId)
    pending.resolve(message)
    return { status: 'accepted' }
  }

  public reject(requestId: string, error: Error): boolean {
    const pending = this.take(requestId)
    if (!pending) {
      return false
    }
    pending.reject(error)
    return true
  }

  public failAll(error: Error): void {
    for (const requestId of this.pendingByRequestId.keys()) {
      this.reject(requestId, error)
    }
  }

  private take(requestId: string): PendingResponse | null {
    const pending = this.pendingByRequestId.get(requestId) ?? null
    if (!pending) {
      return null
    }
    clearTimeout(pending.timer)
    this.pendingByRequestId.delete(requestId)
    return pending
  }
}
