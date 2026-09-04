import {
  createTerminalDisplayProfileKey,
  createTerminalDisplayReference,
  createTerminalDisplayReferenceSignature,
  isTerminalDisplayReferenceCurrent,
  isTerminalDisplayReferenceForProfile,
  type TerminalDisplayMeasurement,
  type TerminalDisplayReference,
  type TerminalDisplayRendererKind,
  type TerminalDisplayRuntime,
} from '../domain/terminalDisplayCalibration'

export type TerminalDisplayReferenceCaptureContext = {
  enabled: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference | null
  runtime: TerminalDisplayRuntime
}

export interface TerminalDisplayReferenceCapturePorts {
  hasMountedTerminal: () => boolean
  rendererKind: () => TerminalDisplayRendererKind | null
  measure: (profile: {
    terminalFontSize: number
    terminalFontFamily: string | null
  }) => Promise<TerminalDisplayMeasurement | null>
  commit: (input: {
    expectedProfileKey: string
    expectedReferenceSignature: string
    reference: TerminalDisplayReference
  }) => void
}

export interface TerminalDisplayReferenceCaptureOwner {
  update: (context: TerminalDisplayReferenceCaptureContext) => void
  refresh: () => void
  dispose: () => void
}

function canReplaceReference(
  referenceRuntime: TerminalDisplayRuntime | null,
  currentRuntime: TerminalDisplayRuntime,
): boolean {
  if (referenceRuntime === null) {
    return true
  }
  return referenceRuntime !== 'unknown' && currentRuntime === referenceRuntime
}

function captureKey(context: TerminalDisplayReferenceCaptureContext): string {
  return JSON.stringify({
    enabled: context.enabled,
    profileKey: createTerminalDisplayProfileKey({
      terminalFontSize: context.terminalFontSize,
      terminalFontFamily: context.terminalFontFamily,
    }),
    reference: createTerminalDisplayReferenceSignature(context.reference),
    runtime: context.runtime,
  })
}

export function createTerminalDisplayReferenceCaptureOwner(
  ports: TerminalDisplayReferenceCapturePorts,
): TerminalDisplayReferenceCaptureOwner {
  let context: TerminalDisplayReferenceCaptureContext | null = null
  let contextSignature = 'none'
  let generation = 0
  let disposed = false
  let inFlightKey: string | null = null
  let rerunRequested = false

  const start = (): void => {
    const capturedContext = context
    if (!capturedContext || disposed) {
      return
    }
    const profileKey = createTerminalDisplayProfileKey({
      terminalFontSize: capturedContext.terminalFontSize,
      terminalFontFamily: capturedContext.terminalFontFamily,
    })
    const observedReferenceSignature = createTerminalDisplayReferenceSignature(
      capturedContext.reference,
    )
    const hasCurrentReference =
      isTerminalDisplayReferenceForProfile(capturedContext.reference, {
        terminalFontSize: capturedContext.terminalFontSize,
        terminalFontFamily: capturedContext.terminalFontFamily,
      }) && isTerminalDisplayReferenceCurrent(capturedContext.reference)
    if (
      !capturedContext.enabled ||
      hasCurrentReference ||
      !canReplaceReference(
        capturedContext.reference?.measurement.runtime ?? null,
        capturedContext.runtime,
      ) ||
      !ports.hasMountedTerminal()
    ) {
      return
    }

    const rendererKind = ports.rendererKind()
    const operationKey = `${profileKey}::${observedReferenceSignature}`
    if (!rendererKind) {
      return
    }
    if (inFlightKey === operationKey) {
      rerunRequested = true
      return
    }
    generation += 1
    const expectedGeneration = generation
    inFlightKey = operationKey
    void ports
      .measure({
        terminalFontSize: capturedContext.terminalFontSize,
        terminalFontFamily: capturedContext.terminalFontFamily,
      })
      .then(measurement => {
        if (
          disposed ||
          expectedGeneration !== generation ||
          !measurement ||
          ports.rendererKind() !== rendererKind
        ) {
          return
        }
        ports.commit({
          expectedProfileKey: profileKey,
          expectedReferenceSignature: observedReferenceSignature,
          reference: createTerminalDisplayReference({ measurement, rendererKind }),
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (inFlightKey !== operationKey) {
          return
        }
        inFlightKey = null
        if (rerunRequested && !disposed) {
          rerunRequested = false
          queueMicrotask(start)
        }
      })
  }

  return {
    update: nextContext => {
      if (disposed) {
        return
      }
      context = nextContext
      const nextSignature = captureKey(nextContext)
      if (nextSignature === contextSignature) {
        return
      }
      contextSignature = nextSignature
      generation += 1
      start()
    },
    refresh: start,
    dispose: () => {
      disposed = true
      generation += 1
      context = null
      inFlightKey = null
      rerunRequested = false
    },
  }
}
