import { createTerminalDisplayCalibrationOwner } from '../../application/terminalDisplayCalibrationOwner'
import {
  clearTerminalClientDisplayCalibration,
  isTerminalDisplayCalibrationSuppressed,
  readStoredTerminalDisplayCalibration,
  writeTerminalClientDisplayCalibration,
} from './terminalDisplayCalibrationStorage'
import { resolveStableTerminalDisplayEnvironment } from './terminalDisplayEnvironment'
import {
  calibrateTerminalDisplayReferenceAutomatically,
  measureTerminalDisplayReferenceBaseline,
  resolveMountedTerminalDisplayRendererKind,
} from './terminalDisplayMeasurement'
import { recordTerminalDisplayCalibrationAttempt } from './terminalDisplayCalibrationDiagnostics'

let storageMutationDepth = 0

export const terminalDisplayCalibrationOwner = createTerminalDisplayCalibrationOwner({
  readStored: readStoredTerminalDisplayCalibration,
  writeStored: (calibration, metadata) => {
    storageMutationDepth += 1
    try {
      return writeTerminalClientDisplayCalibration(calibration, metadata)
    } finally {
      storageMutationDepth -= 1
    }
  },
  clearStored: options => {
    storageMutationDepth += 1
    try {
      return clearTerminalClientDisplayCalibration(options)
    } finally {
      storageMutationDepth -= 1
    }
  },
  isSuppressed: isTerminalDisplayCalibrationSuppressed,
  resolveEnvironment: async input => await resolveStableTerminalDisplayEnvironment(input),
  measureReference: async input => {
    const rendererKind = resolveMountedTerminalDisplayRendererKind()
    if (!rendererKind) {
      return null
    }
    const measurement = await measureTerminalDisplayReferenceBaseline(input)
    return measurement && resolveMountedTerminalDisplayRendererKind() === rendererKind
      ? { measurement, rendererKind }
      : null
  },
  calibrate: async input =>
    await calibrateTerminalDisplayReferenceAutomatically({
      terminalFontSize: input.terminalFontSize,
      terminalFontFamily: input.terminalFontFamily,
      reference: input.reference,
      rendererKind: input.rendererKind,
    }),
  recordAttempt: (outcome, environmentSignature) => {
    recordTerminalDisplayCalibrationAttempt(
      outcome as Parameters<typeof recordTerminalDisplayCalibrationAttempt>[0],
      environmentSignature ?? null,
    )
  },
})

export function isTerminalDisplayCalibrationStorageMutationInProgress(): boolean {
  return storageMutationDepth > 0
}
