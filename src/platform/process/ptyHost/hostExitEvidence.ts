import type { PtyHostProcess } from './processTypes'

export class PtyHostExitEvidence {
  private readonly confirmedProcesses = new WeakSet<PtyHostProcess>()
  private readonly forcedExitCodes = new WeakMap<PtyHostProcess, number>()
  private ambiguousProcess: PtyHostProcess | null = null

  public beginAmbiguousExit(process: PtyHostProcess, forcedExitCode: number): void {
    this.ambiguousProcess = process
    this.forcedExitCodes.set(process, forcedExitCode)
  }

  public confirmExit(process: PtyHostProcess, observedExitCode: number): number {
    this.confirmedProcesses.add(process)
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
