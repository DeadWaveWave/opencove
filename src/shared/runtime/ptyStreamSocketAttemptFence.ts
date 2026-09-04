export type PtyStreamSocketAttempt = object

export class PtyStreamSocketAttemptFence {
  private current: PtyStreamSocketAttempt | null = null

  public begin(): PtyStreamSocketAttempt {
    const attempt = Object.freeze({})
    this.current = attempt
    return attempt
  }

  public retire(): void {
    this.current = null
  }

  public isCurrent(attempt: PtyStreamSocketAttempt): boolean {
    return this.current === attempt
  }

  public assertCurrent(attempt: PtyStreamSocketAttempt): void {
    if (!this.isCurrent(attempt)) {
      throw new Error('PTY stream connection attempt was retired.')
    }
  }
}
