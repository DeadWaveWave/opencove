import { useSyncExternalStore } from 'react'
import {
  isTerminalDisplayCalibrationForReference,
  isTerminalDisplayReferenceForProfile,
  type TerminalClientDisplayCalibration,
  type TerminalDisplayReference,
} from '../../domain/terminalDisplayCalibration'
import { terminalDisplayCalibrationOwner } from './terminalDisplayCalibrationRuntime'
import type { TerminalDisplayCalibrationOwnerSnapshot } from '../../application/terminalDisplayCalibrationOwner'

export function useTerminalDisplayCalibrationSnapshot(): TerminalDisplayCalibrationOwnerSnapshot {
  return useSyncExternalStore(
    terminalDisplayCalibrationOwner.subscribe,
    terminalDisplayCalibrationOwner.getSnapshot,
    terminalDisplayCalibrationOwner.getSnapshot,
  )
}

export function useTerminalDisplayCalibrationProjection({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}): TerminalClientDisplayCalibration | null {
  const snapshot = useTerminalDisplayCalibrationSnapshot()
  const calibration = snapshot.appliedCalibration
  if (
    !calibration ||
    !isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
      terminalFontSize,
      terminalFontFamily,
    }) ||
    !isTerminalDisplayCalibrationForReference(calibration, terminalDisplayReference)
  ) {
    return null
  }
  return calibration
}
