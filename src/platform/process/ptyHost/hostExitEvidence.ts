import type { PtyHostProcess } from './processTypes'

export class PtyHostExitEvidence {
  private readonly confirmedProcesses = new WeakSet<PtyHostProcess>()
  private readonly forcedExitCodes = new WeakMap<PtyHostProcess, number>()
  private readonly completion = new WeakMap<
    PtyHostProcess,
    { promise: Promise<void>; resolve: () => void }
  >()
  public whenCompleted(process: PtyHostProcess): Promise<void> {
    if (this.confirmedProcesses.has(process)) {
      return Promise.resolve()
    }
    let entry = this.completion.get(process)
    if (!entry) {
      let resolve!: () => void
      const promise = new Promise<void>(done => {
        resolve = done
      })
      entry = { promise, resolve }
      this.completion.set(process, entry)
    }
    return entry.promise
  }
  private ambiguousProcess: PtyHostProcess | null = null

  public beginAmbiguousExit(process: PtyHostProcess, forcedExitCode: number): void {
    this.ambiguousProcess = process
    this.forcedExitCodes.set(process, forcedExitCode)
  }

  public confirmExit(process: PtyHostProcess, observedExitCode: number): number {
    this.confirmedProcesses.add(process)
    this.completion.get(process)?.resolve()
    this.completion.delete(process)
    if (this.ambiguousProcess === process) {
      this.ambiguousProcess = null
    }
    return this.forcedExitCodes.get(process) ?? observedExitCode
  }

  public assertNoAmbiguousExit(): void {
    if (this.ambiguousProcess) {
      throw new Error('[pty-host] unavailable while prior host exit is unconfirmed')
    }
  }

  public isRetrySafe(process: PtyHostProcess | null): boolean {
    return process === null || this.confirmedProcesses.has(process)
  }
}
