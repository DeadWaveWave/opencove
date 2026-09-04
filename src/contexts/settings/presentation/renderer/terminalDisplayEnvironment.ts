import {
  createTerminalDisplayProfileKey,
  createTerminalDisplayReferenceSignature,
  type TerminalDisplayMeasurement,
  type TerminalDisplayReference,
} from '../../domain/terminalDisplayCalibration'
import {
  measureFirstMountedTerminalDisplay,
  measureTerminalDisplayReferenceBaseline,
  resolveMountedTerminalDisplayRendererKind,
  roundDisplayMetric,
  type TerminalDisplayRendererKind,
} from './terminalDisplayMeasurement'

export interface TerminalDisplayEnvironment {
  signature: string
  rendererKind: TerminalDisplayRendererKind
  measurement: TerminalDisplayMeasurement
}

function waitForFrame(): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

function measurementsAreStable(
  left: TerminalDisplayMeasurement,
  right: TerminalDisplayMeasurement,
): boolean {
  return (
    left.cols === right.cols &&
    left.rows === right.rows &&
    Math.abs(left.cssCellWidth - right.cssCellWidth) <= 0.001 &&
    Math.abs(left.cssCellHeight - right.cssCellHeight) <= 0.001 &&
    Math.abs(left.effectiveDpr - right.effectiveDpr) <= 0.001
  )
}

export function createTerminalDisplayEnvironmentSignature(input: {
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference
  rendererKind: TerminalDisplayRendererKind
  measurement: TerminalDisplayMeasurement
}): string {
  return JSON.stringify({
    algorithmVersion: 1,
    profileKey: createTerminalDisplayProfileKey({
      terminalFontSize: input.terminalFontSize,
      terminalFontFamily: input.terminalFontFamily,
    }),
    referenceSignature: createTerminalDisplayReferenceSignature(input.reference),
    runtime: input.measurement.runtime,
    rendererKind: input.rendererKind,
    windowDevicePixelRatio: roundDisplayMetric(input.measurement.windowDevicePixelRatio),
    visualViewportScale:
      input.measurement.visualViewportScale === null
        ? null
        : roundDisplayMetric(input.measurement.visualViewportScale),
    fontFingerprint: {
      cssCellWidth: roundDisplayMetric(input.measurement.cssCellWidth),
      cssCellHeight: roundDisplayMetric(input.measurement.cssCellHeight),
    },
  })
}

export async function resolveStableTerminalDisplayEnvironment(input: {
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference
}): Promise<TerminalDisplayEnvironment | null> {
  try {
    await document.fonts?.ready
  } catch {
    return null
  }
  const rendererKind = resolveMountedTerminalDisplayRendererKind()
  if (!rendererKind) {
    return null
  }

  await waitForFrame()
  const first = measureFirstMountedTerminalDisplay(input)
  await waitForFrame()
  const second = measureFirstMountedTerminalDisplay(input)
  if (
    !first ||
    !second ||
    !measurementsAreStable(first, second) ||
    resolveMountedTerminalDisplayRendererKind() !== rendererKind
  ) {
    return null
  }

  const baseMeasurement = await measureTerminalDisplayReferenceBaseline(input)
  if (!baseMeasurement || resolveMountedTerminalDisplayRendererKind() !== rendererKind) {
    return null
  }
  return {
    rendererKind,
    measurement: baseMeasurement,
    signature: createTerminalDisplayEnvironmentSignature({
      ...input,
      rendererKind,
      measurement: baseMeasurement,
    }),
  }
}
