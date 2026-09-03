import { useSyncExternalStore } from 'react'
import {
  isTerminalDisplayCalibrationForReference,
  isTerminalDisplayReferenceForProfile,
  type TerminalClientDisplayCalibration,
  type TerminalDisplayReference,
} from '../../domain/terminalDisplayCalibration'
import { terminalDisplayCalibrationOwner } from './terminalDisplayCalibrationRuntime'

export function useTerminalDisplayCalibrationProjection({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}): TerminalClientDisplayCalibration | null {
  const snapshot = useSyncExternalStore(
    terminalDisplayCalibrationOwner.subscribe,
    terminalDisplayCalibrationOwner.getSnapshot,
    terminalDisplayCalibrationOwner.getSnapshot,
  )
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
