import {
  getTerminalDisplayCalibrationQuality,
  isTerminalDisplayReferenceCurrent,
  MAX_TERMINAL_DISPLAY_CALIBRATION_CELL_DELTA_PX,
  type TerminalClientDisplayCalibration,
  type TerminalDisplayMeasurement,
  type TerminalDisplayReference,
} from '../domain/terminalDisplayCalibration'

export interface TerminalDisplayCalibrationCandidateResult {
  candidate: { fontSize: number; lineHeight: number; letterSpacing: number }
  measurement: TerminalDisplayMeasurement
  score: number
}

const inFlightBySignature = new Map<string, Promise<unknown>>()

export function createTerminalDisplayCalibrationFromCandidate(input: {
  profileKey: string
  reference: TerminalDisplayReference
  result: TerminalDisplayCalibrationCandidateResult | null
}): TerminalClientDisplayCalibration | null {
  const result = input.result
  if (!result || !isTerminalDisplayReferenceCurrent(input.reference)) {
    return null
  }
  const quality = getTerminalDisplayCalibrationQuality(result.score)
  const target = input.reference.measurement
  const measured = result.measurement
  if (
    (quality !== 'exact' && quality !== 'close') ||
    measured.cols !== target.cols ||
    measured.rows !== target.rows ||
    Math.abs(measured.cssCellWidth - target.cssCellWidth) >
      MAX_TERMINAL_DISPLAY_CALIBRATION_CELL_DELTA_PX ||
    Math.abs(measured.cssCellHeight - target.cssCellHeight) >
      MAX_TERMINAL_DISPLAY_CALIBRATION_CELL_DELTA_PX ||
    Math.abs(measured.effectiveDpr - target.effectiveDpr) > 0.001
  ) {
    return null
  }

  return {
    version: 1,
    profileKey: input.profileKey,
    fontSize: result.candidate.fontSize,
    lineHeight: result.candidate.lineHeight,
    letterSpacing: result.candidate.letterSpacing,
    target: {
      cols: target.cols,
      rows: target.rows,
      cssCellWidth: target.cssCellWidth,
      cssCellHeight: target.cssCellHeight,
      effectiveDpr: target.effectiveDpr,
    },
    measured: {
      cols: measured.cols,
      rows: measured.rows,
      cssCellWidth: measured.cssCellWidth,
      cssCellHeight: measured.cssCellHeight,
      effectiveDpr: measured.effectiveDpr,
    },
    score: result.score,
    measuredAt: measured.measuredAt,
  }
}

export function runTerminalDisplayCalibrationSingleFlight<T>(
  signature: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = inFlightBySignature.get(signature) as Promise<T> | undefined
  if (existing) {
    return existing
  }
  const current = operation()
  inFlightBySignature.set(signature, current)
  const cleanup = (): void => {
    if (inFlightBySignature.get(signature) === current) {
      inFlightBySignature.delete(signature)
    }
  }
  void current.then(cleanup, cleanup)
  return current
}
