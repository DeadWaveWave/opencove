import { isRecord, normalizeTextValue } from './settingsNormalization'

export type TerminalDisplayRuntime = 'desktop' | 'browser' | 'unknown'

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
  score: number
  measuredAt: string
}

export type TerminalDisplayCalibrationQuality = 'exact' | 'close' | 'needsAdjustment'

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeRuntime(value: unknown): TerminalDisplayRuntime {
  return value === 'desktop' || value === 'browser' || value === 'unknown' ? value : 'unknown'
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

export function resolveTerminalDisplayCalibrationCompensation({
  calibration,
  compensationEnabled,
}: {
  calibration: TerminalClientDisplayCalibration | null
  compensationEnabled: boolean
}): TerminalClientDisplayCalibration | null {
  return compensationEnabled ? calibration : null
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

export function isTerminalDisplayCalibrationForReference(
  calibration: TerminalClientDisplayCalibration | null,
  reference: TerminalDisplayReference | null,
): calibration is TerminalClientDisplayCalibration {
  if (!calibration || !reference) {
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
  return measurement ? { version: 1, measurement } : null
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

  return {
    version: 1,
    profileKey,
    fontSize: value.fontSize,
    lineHeight: value.lineHeight,
    letterSpacing: value.letterSpacing,
    target: {
      cols: Math.round(target.cols),
      rows: Math.round(target.rows),
      cssCellWidth: target.cssCellWidth,
      cssCellHeight: target.cssCellHeight,
      effectiveDpr: target.effectiveDpr,
    },
    score: value.score,
    measuredAt: normalizeTextValue(value.measuredAt) || new Date().toISOString(),
  }
}
