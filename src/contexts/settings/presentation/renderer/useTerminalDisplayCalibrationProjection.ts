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

interface CalibrationProjectionSettings {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
}

/** The owner's applied calibration, if it fits the profile and reference of these settings. */
export function projectTerminalDisplayCalibration(
  calibration: TerminalClientDisplayCalibration | null,
  { terminalFontSize, terminalFontFamily, terminalDisplayReference }: CalibrationProjectionSettings,
): TerminalClientDisplayCalibration | null {
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

/** The projection now, for a command that runs later: nothing subscribes. */
export function readTerminalDisplayCalibration(
  settings: CalibrationProjectionSettings,
): TerminalClientDisplayCalibration | null {
  return projectTerminalDisplayCalibration(
    terminalDisplayCalibrationOwner.getSnapshot().appliedCalibration,
    settings,
  )
}

export function useTerminalDisplayCalibrationProjection(
  settings: CalibrationProjectionSettings,
): TerminalClientDisplayCalibration | null {
  return projectTerminalDisplayCalibration(
    useTerminalDisplayCalibrationSnapshot().appliedCalibration,
    settings,
  )
}
