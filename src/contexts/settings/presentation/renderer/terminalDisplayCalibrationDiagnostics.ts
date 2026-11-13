import type { TerminalDisplayCalibrationAttemptOutcome } from '../../application/terminalDisplayCalibrationOwner'

export interface TerminalDisplayCalibrationAttemptDiagnostic {
  outcome: TerminalDisplayCalibrationAttemptOutcome
  environmentSignature: string | null
  recordedAt: string
}

let latestAttempt: TerminalDisplayCalibrationAttemptDiagnostic | null = null

export function recordTerminalDisplayCalibrationAttempt(
  outcome: TerminalDisplayCalibrationAttemptOutcome,
  environmentSignature: string | null = null,
): void {
  latestAttempt = {
    outcome,
    environmentSignature,
    recordedAt: new Date().toISOString(),
  }
}

export function readTerminalDisplayCalibrationAttempt(): TerminalDisplayCalibrationAttemptDiagnostic | null {
  return latestAttempt
}

/** @internal Test seam: only specs call this. */
export function resetTerminalDisplayCalibrationAttemptForTests(): void {
  latestAttempt = null
}
