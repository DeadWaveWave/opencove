import type { PtyHostResponseMessage } from './protocol'

type PendingResponse = {
  resolve: (message: PtyHostResponseMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class PtyHostPendingResponseCoordinator {
  private readonly pendingByRequestId = new Map<string, PendingResponse>()

  public waitFor(
    requestId: string,
    options: { timeoutMs: number; timeoutMessage: string },
  ): Promise<PtyHostResponseMessage> {
    return new Promise<PtyHostResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingByRequestId.delete(requestId)
        reject(new Error(options.timeoutMessage))
      }, options.timeoutMs)
      this.pendingByRequestId.set(requestId, { resolve, reject, timer })
    })
  }

  public resolve(message: PtyHostResponseMessage): boolean {
    const pending = this.take(message.requestId)
    if (!pending) {
      return false
    }
    pending.resolve(message)
    return true
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
