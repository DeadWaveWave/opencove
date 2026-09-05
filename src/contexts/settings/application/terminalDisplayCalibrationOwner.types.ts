import type {
  TerminalClientDisplayCalibration,
  TerminalDisplayReference,
  TerminalDisplayRendererKind,
  TerminalDisplayRuntime,
} from '../domain/terminalDisplayCalibration'
import type { TerminalDisplayCalibrationCandidateResult } from './terminalDisplayAutoCalibration'

export type TerminalDisplayCalibrationAttemptOutcome =
  | 'disabled'
  | 'reference-unavailable'
  | 'no-terminal'
  | 'mixed-renderers'
  | 'renderer-mismatch'
  | 'environment-unstable'
  | 'already-calibrated'
  | 'suppressed'
  | 'candidate-unavailable'
  | 'candidate-rejected'
  | 'storage-unavailable'
  | 'applied'

export type TerminalDisplayCalibrationStatus =
  | 'idle'
  | 'checking'
  | TerminalDisplayCalibrationAttemptOutcome

export type TerminalDisplayCalibrationMetadata = {
  environmentSignature: string
  source: 'automatic' | 'manual'
}

export type StoredTerminalDisplayCalibration = {
  calibration: TerminalClientDisplayCalibration
  metadata: TerminalDisplayCalibrationMetadata | null
  proof: 'atomic' | 'legacy' | null
}

export type TerminalDisplayCalibrationContext = {
  enabled: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference | null
}

// Renderer counts and frame size are not display-environment identity.
export type TerminalDisplayEnvironmentObservation = {
  runtime: TerminalDisplayRuntime
  rendererKind: TerminalDisplayRendererKind | 'mixed' | 'none'
  windowDevicePixelRatio: number
  visualViewportScale: number | null
}

export type TerminalDisplayEnvironmentEvidence = {
  signature: string
  rendererKind: TerminalDisplayRendererKind
}

export type TerminalDisplayCalibrationOwnerSnapshot = {
  appliedCalibration: TerminalClientDisplayCalibration | null
  environmentSignature: string | null
  status: TerminalDisplayCalibrationStatus
}

export interface TerminalDisplayCalibrationOwnerPorts {
  readStored: () => StoredTerminalDisplayCalibration | null
  writeStored: (
    calibration: TerminalClientDisplayCalibration,
    metadata: TerminalDisplayCalibrationMetadata,
  ) => boolean
  clearStored: (options?: { suppressEnvironmentSignature?: string | null }) => boolean
  isSuppressed: (environmentSignature: string) => boolean
  readEnvironmentObservation: () => TerminalDisplayEnvironmentObservation
  resolveEnvironment: (
    context: Omit<TerminalDisplayCalibrationContext, 'enabled'> & {
      reference: TerminalDisplayReference
    },
  ) => Promise<TerminalDisplayEnvironmentEvidence | null>
  measureReference: (input: {
    terminalFontSize: number
    terminalFontFamily: string | null
  }) => Promise<{
    measurement: TerminalDisplayReference['measurement']
    rendererKind: TerminalDisplayRendererKind
  } | null>
  calibrate: (input: {
    terminalFontSize: number
    terminalFontFamily: string | null
    reference: TerminalDisplayReference
    rendererKind: TerminalDisplayRendererKind
  }) => Promise<TerminalDisplayCalibrationCandidateResult | null>
  recordAttempt?: (
    outcome: TerminalDisplayCalibrationAttemptOutcome,
    environmentSignature?: string,
  ) => void
}

export type ManualTerminalDisplayReferenceResult =
  | { outcome: 'captured'; reference: TerminalDisplayReference }
  | { outcome: 'measurement-unavailable' }

export type ManualTerminalDisplayCalibrationResult =
  | { outcome: 'saved'; score: number }
  | {
      outcome:
        | 'reference-unavailable'
        | 'no-terminal'
        | 'mixed-renderers'
        | 'renderer-mismatch'
        | 'environment-unstable'
        | 'candidate-unavailable'
        | 'storage-unavailable'
    }
  | { outcome: 'candidate-rejected'; score: number }

export interface TerminalDisplayCalibrationOwner {
  update: (context: TerminalDisplayCalibrationContext) => void
  observeEnvironment: () => void
  refresh: () => void
  captureReferenceNow: () => Promise<ManualTerminalDisplayReferenceResult>
  calibrateNow: () => Promise<ManualTerminalDisplayCalibrationResult>
  reset: () => boolean
  getSnapshot: () => TerminalDisplayCalibrationOwnerSnapshot
  subscribe: (listener: () => void) => () => void
  whenIdle: () => Promise<void>
  dispose: () => void
}
