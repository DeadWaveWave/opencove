export type TerminalDisplayCalibrationAttemptOutcome =
  | 'disabled'
  | 'reference-unavailable'
  | 'environment-unstable'
  | 'already-calibrated'
  | 'suppressed'
  | 'candidate-unavailable'
  | 'candidate-rejected'
  | 'storage-unavailable'
  | 'applied'

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

export function resetTerminalDisplayCalibrationAttemptForTests(): void {
  latestAttempt = null
}
