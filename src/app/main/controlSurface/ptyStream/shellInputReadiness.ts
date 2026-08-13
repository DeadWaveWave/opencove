const DEFAULT_SHELL_INPUT_READY_TIMEOUT_MS = 5_000

export class ShellInputReadiness {
  private readonly readySessions = new Set<string>()
  private readonly waiters = new Map<string, Set<() => void>>()

  public constructor(private readonly timeoutMs: number = DEFAULT_SHELL_INPUT_READY_TIMEOUT_MS) {}

  public markReady(sessionId: string): void {
    this.readySessions.add(sessionId)
    this.settleWaiters(sessionId)
  }

  public forget(sessionId: string): void {
    this.readySessions.delete(sessionId)
    this.settleWaiters(sessionId)
  }

  public async wait(sessionId: string): Promise<void> {
    if (this.readySessions.has(sessionId)) {
      return
    }

    await new Promise<void>(resolve => {
      let settled = false
      const settle = (): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        this.waiters.get(sessionId)?.delete(settle)
        resolve()
      }
      const timer = setTimeout(settle, this.timeoutMs)
      timer.unref()
      const sessionWaiters = this.waiters.get(sessionId) ?? new Set<() => void>()
      sessionWaiters.add(settle)
      this.waiters.set(sessionId, sessionWaiters)
    })
  }

  public dispose(): void {
    for (const sessionId of this.waiters.keys()) {
      this.settleWaiters(sessionId)
    }
    this.readySessions.clear()
  }

  private settleWaiters(sessionId: string): void {
    const sessionWaiters = this.waiters.get(sessionId)
    this.waiters.delete(sessionId)
    sessionWaiters?.forEach(settle => settle())
  }
}
