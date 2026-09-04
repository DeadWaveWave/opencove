import { isRecord, normalizeTextValue } from './settingsNormalization'

export type TerminalDisplayRuntime = 'desktop' | 'browser' | 'unknown'
export type TerminalDisplayRendererKind = 'dom' | 'webgl'
export const TERMINAL_DISPLAY_REFERENCE_ALGORITHM_VERSION = 1

export interface TerminalDisplayReferenceCapture {
  algorithmVersion: typeof TERMINAL_DISPLAY_REFERENCE_ALGORITHM_VERSION
  rendererKind: TerminalDisplayRendererKind
}

export interface TerminalDisplayMeasurement {
  fontSize: number
  fontFamily: string | null
  lineHeight: number
  letterSpacing: number
  cols: number
  rows: number
  cssCellWidth: number
  cssCellHeight: number
  effectiveDpr: number
  windowDevicePixelRatio: number
  visualViewportScale: number | null
  runtime: TerminalDisplayRuntime
  measuredAt: string
}

export interface TerminalDisplayReference {
  version: 1
  measurement: TerminalDisplayMeasurement
  capture?: TerminalDisplayReferenceCapture
}

export interface TerminalClientDisplayCalibration {
  version: 1
  profileKey: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  target: Pick<
    TerminalDisplayMeasurement,
    'cols' | 'rows' | 'cssCellWidth' | 'cssCellHeight' | 'effectiveDpr'
  >
  measured?: Pick<
    TerminalDisplayMeasurement,
    'cols' | 'rows' | 'cssCellWidth' | 'cssCellHeight' | 'effectiveDpr'
  >
  score: number
  measuredAt: string
}

export type TerminalDisplayCalibrationQuality = 'exact' | 'close' | 'needsAdjustment'
export const TERMINAL_DISPLAY_CALIBRATION_LINE_HEIGHT = 1
export const MAX_TERMINAL_DISPLAY_CALIBRATION_CELL_DELTA_PX = 0.05

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeRuntime(value: unknown): TerminalDisplayRuntime {
  return value === 'desktop' || value === 'browser' || value === 'unknown' ? value : 'unknown'
}

function normalizeReferenceCapture(value: unknown): TerminalDisplayReferenceCapture | null {
  if (
    !isRecord(value) ||
    value.algorithmVersion !== TERMINAL_DISPLAY_REFERENCE_ALGORITHM_VERSION ||
    (value.rendererKind !== 'dom' && value.rendererKind !== 'webgl')
  ) {
    return null
  }

  return {
    algorithmVersion: TERMINAL_DISPLAY_REFERENCE_ALGORITHM_VERSION,
    rendererKind: value.rendererKind,
  }
}

function normalizeMeasurement(value: unknown): TerminalDisplayMeasurement | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    !isPositiveNumber(value.fontSize) ||
    !isPositiveNumber(value.lineHeight) ||
    !isFiniteNumber(value.letterSpacing) ||
    !isPositiveNumber(value.cols) ||
    !isPositiveNumber(value.rows) ||
    !isPositiveNumber(value.cssCellWidth) ||
    !isPositiveNumber(value.cssCellHeight) ||
    !isPositiveNumber(value.effectiveDpr) ||
    !isPositiveNumber(value.windowDevicePixelRatio)
  ) {
    return null
  }

  return {
    fontSize: value.fontSize,
    fontFamily: normalizeTextValue(value.fontFamily) || null,
    lineHeight: value.lineHeight,
    letterSpacing: value.letterSpacing,
    cols: Math.round(value.cols),
    rows: Math.round(value.rows),
    cssCellWidth: value.cssCellWidth,
    cssCellHeight: value.cssCellHeight,
    effectiveDpr: value.effectiveDpr,
    windowDevicePixelRatio: value.windowDevicePixelRatio,
    visualViewportScale: isPositiveNumber(value.visualViewportScale)
      ? value.visualViewportScale
      : null,
    runtime: normalizeRuntime(value.runtime),
    measuredAt: normalizeTextValue(value.measuredAt) || new Date().toISOString(),
  }
}

export function createTerminalDisplayProfileKey({
  terminalFontSize,
  terminalFontFamily,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
}): string {
  return JSON.stringify({
    fontSize: terminalFontSize,
    fontFamily: terminalFontFamily ?? null,
  })
}

function isCloseNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.001
}

export function getTerminalDisplayCalibrationQuality(
  score: number,
): TerminalDisplayCalibrationQuality {
  if (!Number.isFinite(score)) {
    return 'needsAdjustment'
  }

  if (score <= 0.001) {
    return 'exact'
  }

  return score <= 100 ? 'close' : 'needsAdjustment'
}

export function isTerminalDisplayCalibrationHighConfidence(
  calibration: TerminalClientDisplayCalibration,
): boolean {
  const quality = getTerminalDisplayCalibrationQuality(calibration.score)
  if (quality !== 'exact' && quality !== 'close') {
    return false
  }
  const measured = calibration.measured
  if (!measured) {
    return false
  }
  return (
    measured.cols === calibration.target.cols &&
    measured.rows === calibration.target.rows &&
    Math.abs(measured.cssCellWidth - calibration.target.cssCellWidth) <=
      MAX_TERMINAL_DISPLAY_CALIBRATION_CELL_DELTA_PX &&
    Math.abs(measured.cssCellHeight - calibration.target.cssCellHeight) <=
      MAX_TERMINAL_DISPLAY_CALIBRATION_CELL_DELTA_PX &&
    isCloseNumber(measured.effectiveDpr, calibration.target.effectiveDpr)
  )
}

export function resolveTerminalDisplayCalibrationCompensation({
  calibration,
  compensationEnabled,
}: {
  calibration: TerminalClientDisplayCalibration | null
  compensationEnabled: boolean
}): TerminalClientDisplayCalibration | null {
  return compensationEnabled ? calibration : null
}

export function createTerminalDisplayCalibrationSignature(
  calibration: TerminalClientDisplayCalibration | null,
): string {
  if (!calibration) {
    return 'none'
  }

  return JSON.stringify({
    version: calibration.version,
    profileKey: calibration.profileKey,
    fontSize: calibration.fontSize,
    lineHeight: calibration.lineHeight,
    letterSpacing: calibration.letterSpacing,
    target: calibration.target,
    measured: calibration.measured ?? null,
    score: calibration.score,
  })
}

export function isTerminalDisplayReferenceForProfile(
  reference: TerminalDisplayReference | null,
  {
    terminalFontSize,
    terminalFontFamily,
  }: {
    terminalFontSize: number
    terminalFontFamily: string | null
  },
): reference is TerminalDisplayReference {
  if (!reference) {
    return false
  }

  return (
    createTerminalDisplayProfileKey({
      terminalFontSize: reference.measurement.fontSize,
      terminalFontFamily: reference.measurement.fontFamily,
    }) === createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily })
  )
}

export function createTerminalDisplayReference({
  measurement,
  rendererKind,
}: {
  measurement: TerminalDisplayMeasurement
  rendererKind: TerminalDisplayRendererKind
}): TerminalDisplayReference {
  return {
    version: 1,
    capture: {
      algorithmVersion: TERMINAL_DISPLAY_REFERENCE_ALGORITHM_VERSION,
      rendererKind,
    },
    measurement,
  }
}

export function isTerminalDisplayReferenceCurrent(
  reference: TerminalDisplayReference | null,
): reference is TerminalDisplayReference & { capture: TerminalDisplayReferenceCapture } {
  return (
    reference?.capture?.algorithmVersion === TERMINAL_DISPLAY_REFERENCE_ALGORITHM_VERSION &&
    (reference.capture.rendererKind === 'dom' || reference.capture.rendererKind === 'webgl')
  )
}

export function createTerminalDisplayReferenceSignature(
  reference: TerminalDisplayReference | null,
): string {
  if (!reference) {
    return 'none'
  }
  return JSON.stringify({
    version: reference.version,
    capture: reference.capture ?? null,
    measurement: reference.measurement,
  })
}

export function isTerminalDisplayCalibrationForReference(
  calibration: TerminalClientDisplayCalibration | null,
  reference: TerminalDisplayReference | null,
): calibration is TerminalClientDisplayCalibration {
  if (
    !calibration ||
    !reference ||
    !isTerminalDisplayReferenceCurrent(reference) ||
    !isTerminalDisplayCalibrationHighConfidence(calibration)
  ) {
    return false
  }

  return (
    calibration.target.cols === reference.measurement.cols &&
    calibration.target.rows === reference.measurement.rows &&
    isCloseNumber(calibration.target.cssCellWidth, reference.measurement.cssCellWidth) &&
    isCloseNumber(calibration.target.cssCellHeight, reference.measurement.cssCellHeight) &&
    isCloseNumber(calibration.target.effectiveDpr, reference.measurement.effectiveDpr)
  )
}

export function normalizeTerminalDisplayReference(value: unknown): TerminalDisplayReference | null {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }

  const measurement = normalizeMeasurement(value.measurement)
  if (!measurement) {
    return null
  }

  const capture = normalizeReferenceCapture(value.capture)
  return {
    version: 1,
    measurement,
    ...(capture ? { capture } : {}),
  }
}

export function normalizeTerminalClientDisplayCalibration(
  value: unknown,
): TerminalClientDisplayCalibration | null {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }

  const target = isRecord(value.target) ? value.target : null
  if (
    !target ||
    !isPositiveNumber(target.cols) ||
    !isPositiveNumber(target.rows) ||
    !isPositiveNumber(target.cssCellWidth) ||
    !isPositiveNumber(target.cssCellHeight) ||
    !isPositiveNumber(target.effectiveDpr) ||
    !isPositiveNumber(value.fontSize) ||
    !isPositiveNumber(value.lineHeight) ||
    !isFiniteNumber(value.letterSpacing) ||
    !isFiniteNumber(value.score)
  ) {
    return null
  }

  const profileKey = normalizeTextValue(value.profileKey)
  if (!profileKey) {
    return null
  }

  const measured = isRecord(value.measured) ? value.measured : null
  const normalizedMeasured =
    measured &&
    isPositiveNumber(measured.cols) &&
    isPositiveNumber(measured.rows) &&
    isPositiveNumber(measured.cssCellWidth) &&
    isPositiveNumber(measured.cssCellHeight) &&
    isPositiveNumber(measured.effectiveDpr)
      ? {
          cols: Math.round(measured.cols),
          rows: Math.round(measured.rows),
          cssCellWidth: measured.cssCellWidth,
          cssCellHeight: measured.cssCellHeight,
          effectiveDpr: measured.effectiveDpr,
        }
      : null

  return {
    version: 1,
    profileKey,
    fontSize: value.fontSize,
    lineHeight: TERMINAL_DISPLAY_CALIBRATION_LINE_HEIGHT,
    letterSpacing: value.letterSpacing,
    target: {
      cols: Math.round(target.cols),
      rows: Math.round(target.rows),
      cssCellWidth: target.cssCellWidth,
      cssCellHeight: target.cssCellHeight,
      effectiveDpr: target.effectiveDpr,
    },
    ...(normalizedMeasured ? { measured: normalizedMeasured } : {}),
    score: value.score,
    measuredAt: normalizeTextValue(value.measuredAt) || new Date().toISOString(),
  }
}
