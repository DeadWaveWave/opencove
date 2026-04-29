const DEFAULT_LINE_HEIGHTS = [1, 1.05, 1.1]
const DEFAULT_LETTER_SPACINGS = [0]
const DEFAULT_FONT_SIZE_RADIUS = 1.5
const DEFAULT_FONT_SIZE_STEP = 0.25

function uniqueSortedNumbers(values) {
  return [
    ...new Set(values.filter(value => Number.isFinite(value)).map(value => round(value, 3))),
  ].sort((left, right) => left - right)
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function buildCenteredRange(center, radius, step) {
  if (!Number.isFinite(center) || center <= 0) {
    return []
  }

  const safeRadius = Number.isFinite(radius) && radius >= 0 ? radius : DEFAULT_FONT_SIZE_RADIUS
  const safeStep = Number.isFinite(step) && step > 0 ? step : DEFAULT_FONT_SIZE_STEP
  const start = center - safeRadius
  const end = center + safeRadius
  const values = []

  for (let value = start; value <= end + safeStep / 2; value += safeStep) {
    if (value > 0) {
      values.push(value)
    }
  }

  return uniqueSortedNumbers(values)
}

function readPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function createDelta(left, right) {
  if (left === null || right === null) {
    return null
  }

  return round(left - right, 4)
}

function normalizeMeasurement(input, geometrySource) {
  const size = geometrySource === 'proposed' ? input.proposedGeometry : input.size
  const fallbackSize = geometrySource === 'proposed' ? input.size : input.proposedGeometry
  const resolvedSize = size ?? fallbackSize ?? null
  const renderMetrics = input.renderMetrics ?? {}

  return {
    cols: readPositiveNumber(resolvedSize?.cols),
    rows: readPositiveNumber(resolvedSize?.rows),
    cssCellWidth: readPositiveNumber(renderMetrics.cssCellWidth),
    cssCellHeight: readPositiveNumber(renderMetrics.cssCellHeight),
    effectiveDpr: readPositiveNumber(renderMetrics.effectiveDpr),
  }
}

function scoreDeltas(deltas) {
  const missingPenalty = 1_000_000
  const colsPenalty = deltas.cols === null ? missingPenalty : Math.abs(deltas.cols) * 1_000
  const rowsPenalty = deltas.rows === null ? missingPenalty : Math.abs(deltas.rows) * 1_000
  const cellWidthPenalty =
    deltas.cssCellWidth === null ? missingPenalty : Math.abs(deltas.cssCellWidth) * 100
  const cellHeightPenalty =
    deltas.cssCellHeight === null ? missingPenalty : Math.abs(deltas.cssCellHeight) * 100
  return round(colsPenalty + rowsPenalty + cellWidthPenalty + cellHeightPenalty, 4)
}

function createPreferenceDistance(candidate, preferredCandidate) {
  if (!preferredCandidate) {
    return 0
  }

  const fontSizeDistance = Math.abs(
    (readFiniteNumber(candidate?.fontSize) ?? 0) -
      (readFiniteNumber(preferredCandidate.fontSize) ?? 0),
  )
  const lineHeightDistance = Math.abs(
    (readFiniteNumber(candidate?.lineHeight) ?? 0) -
      (readFiniteNumber(preferredCandidate.lineHeight) ?? 0),
  )
  const letterSpacingDistance = Math.abs(
    (readFiniteNumber(candidate?.letterSpacing) ?? 0) -
      (readFiniteNumber(preferredCandidate.letterSpacing) ?? 0),
  )

  return round(fontSizeDistance + lineHeightDistance * 10 + letterSpacingDistance, 4)
}

function readPreferenceDistance(result) {
  return readFiniteNumber(result.preferenceDistance) ?? 0
}

export function buildTerminalDisplayCalibrationCandidates({
  baseFontSize,
  fontSizes,
  lineHeights,
  letterSpacings,
  fontSizeRadius = DEFAULT_FONT_SIZE_RADIUS,
  fontSizeStep = DEFAULT_FONT_SIZE_STEP,
} = {}) {
  const resolvedFontSizes =
    Array.isArray(fontSizes) && fontSizes.length > 0
      ? uniqueSortedNumbers(fontSizes)
      : buildCenteredRange(baseFontSize, fontSizeRadius, fontSizeStep)
  const resolvedLineHeights =
    Array.isArray(lineHeights) && lineHeights.length > 0
      ? uniqueSortedNumbers(lineHeights)
      : DEFAULT_LINE_HEIGHTS
  const resolvedLetterSpacings =
    Array.isArray(letterSpacings) && letterSpacings.length > 0
      ? uniqueSortedNumbers(letterSpacings)
      : DEFAULT_LETTER_SPACINGS
  const candidates = []

  for (const fontSize of resolvedFontSizes) {
    for (const lineHeight of resolvedLineHeights) {
      for (const letterSpacing of resolvedLetterSpacings) {
        candidates.push({ fontSize, lineHeight, letterSpacing })
      }
    }
  }

  return candidates
}

export function scoreTerminalDisplayCalibrationCandidate({
  targetMetrics,
  candidateMetrics,
  candidate,
  preferredCandidate,
}) {
  const target = normalizeMeasurement(targetMetrics, 'size')
  const measurement = normalizeMeasurement(candidateMetrics, 'proposed')
  const deltas = {
    cols: createDelta(measurement.cols, target.cols),
    rows: createDelta(measurement.rows, target.rows),
    cssCellWidth: createDelta(measurement.cssCellWidth, target.cssCellWidth),
    cssCellHeight: createDelta(measurement.cssCellHeight, target.cssCellHeight),
    effectiveDpr: createDelta(measurement.effectiveDpr, target.effectiveDpr),
  }
  const score = scoreDeltas(deltas)

  return {
    candidate,
    score,
    preferenceDistance: createPreferenceDistance(candidate, preferredCandidate),
    target,
    measurement,
    deltas,
    exactGeometry: deltas.cols === 0 && deltas.rows === 0,
    exactCellMetrics: deltas.cssCellWidth === 0 && deltas.cssCellHeight === 0,
  }
}

export function rankTerminalDisplayCalibrationCandidates(results) {
  return [...results].sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score
    }

    if (readPreferenceDistance(left) !== readPreferenceDistance(right)) {
      return readPreferenceDistance(left) - readPreferenceDistance(right)
    }

    const leftFontSize = readFiniteNumber(left.candidate?.fontSize) ?? Number.POSITIVE_INFINITY
    const rightFontSize = readFiniteNumber(right.candidate?.fontSize) ?? Number.POSITIVE_INFINITY
    return leftFontSize - rightFontSize
  })
}

export function summarizeTerminalDisplayCalibration(results, limit = 5) {
  const ranked = rankTerminalDisplayCalibrationCandidates(results)
  const best = ranked[0] ?? null
  return {
    best,
    topCandidates: ranked.slice(0, limit),
    candidateCount: results.length,
  }
}

export function compareTerminalDisplayMetrics(desktop, web) {
  const desktopRender = desktop.renderMetrics ?? {}
  const webRender = web.renderMetrics ?? {}
  return {
    colsDelta: (web.size?.cols ?? 0) - (desktop.size?.cols ?? 0),
    rowsDelta: (web.size?.rows ?? 0) - (desktop.size?.rows ?? 0),
    cssCellWidthDelta: (webRender.cssCellWidth ?? 0) - (desktopRender.cssCellWidth ?? 0),
    cssCellHeightDelta: (webRender.cssCellHeight ?? 0) - (desktopRender.cssCellHeight ?? 0),
    effectiveDprDelta: (webRender.effectiveDpr ?? 0) - (desktopRender.effectiveDpr ?? 0),
  }
}

export function isTerminalDisplayParity(comparison) {
  return (
    comparison.colsDelta === 0 &&
    comparison.rowsDelta === 0 &&
    Math.abs(comparison.cssCellWidthDelta) <= 0.05 &&
    Math.abs(comparison.cssCellHeightDelta) <= 0.05
  )
}
