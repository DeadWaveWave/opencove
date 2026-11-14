/** One cancellable deadline per owner; replacing a deadline never leaves an older callback live. */
export class ClaudeConversationTimer {
  private cancel?: () => void
  constructor(private readonly schedule: (callback: () => void, delay: number) => () => void) {}
  at(deadline: number, now: number, callback: () => void): void {
    this.clear()
    this.cancel = this.schedule(
      () => {
        this.cancel = undefined
        callback()
      },
      Math.max(0, deadline - now),
    )
  }
  clear(): void {
    this.cancel?.()
    this.cancel = undefined
  }
}
