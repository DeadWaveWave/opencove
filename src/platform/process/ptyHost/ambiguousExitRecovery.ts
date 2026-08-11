import type { PtyHostProcess } from './processTypes'

export class PtyHostAmbiguousExitRecovery {
  private pending: { process: PtyHostProcess; timer: NodeJS.Timeout } | null = null

  public constructor(private readonly timeoutMs: number) {}

  public begin(process: PtyHostProcess, onDeadline: () => void): void {
    if (this.pending?.process === process) {
      return
    }
    this.clear()
    const timer = setTimeout(() => {
      if (this.pending?.process !== process) {
        return
      }
      this.pending = null
      onDeadline()
    }, this.timeoutMs)
    this.pending = { process, timer }
  }

  public confirm(process: PtyHostProcess): void {
    if (this.pending?.process === process) {
      this.clear()
    }
  }

  public dispose(): void {
    this.clear()
  }

  private clear(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending = null
    }
  }
}
