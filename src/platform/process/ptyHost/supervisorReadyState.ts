export class PtyHostSupervisorReadyState {
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null

  public get promise(): Promise<void> | null {
    return this.readyPromise
  }

  public begin(timeoutMs: number, onTimeout: () => void): void {
    this.clearTimer()
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.readyTimer = setTimeout(onTimeout, timeoutMs)
  }

  public markReady(): void {
    this.clearTimer()
    this.resolveReady?.()
    this.resolveReady = null
    this.rejectReady = null
  }

  public fail(error: Error): void {
    this.clearTimer()
    this.rejectReady?.(error)
    this.resolveReady = null
    this.rejectReady = null
    this.readyPromise = null
  }

  private clearTimer(): void {
    if (!this.readyTimer) {
      return
    }
    clearTimeout(this.readyTimer)
    this.readyTimer = null
  }
}
