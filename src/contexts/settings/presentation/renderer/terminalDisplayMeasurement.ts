import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalDisplayMeasurement,
  TerminalDisplayReference,
} from '../../domain/terminalDisplayCalibration'
import { DEFAULT_TERMINAL_FONT_FAMILY } from '@contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { installTerminalEffectiveDevicePixelRatioController } from '@contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio'

export type TerminalDisplayCandidate = {
  fontSize: number
  lineHeight: number
  letterSpacing: number
}

export type TerminalDisplayCandidateResult = {
  candidate: TerminalDisplayCandidate
  measurement: TerminalDisplayMeasurement
  score: number
  preferenceDistance: number
}

type XtermIntrospection = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: { width?: number; height?: number }
        }
      }
    }
  }
}

export const TERMINAL_DISPLAY_MEASUREMENT_WIDTH = 638
export const TERMINAL_DISPLAY_MEASUREMENT_HEIGHT = 384
export const TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED =
  'opencove:terminal-display-measurement-handles-changed'

const DEFAULT_LINE_HEIGHTS = [1, 1.05, 1.1]
const DEFAULT_LETTER_SPACINGS = [0]
const terminalDisplayMeasurementHandles = new Map<
  string,
  {
    terminal: Terminal
    fitAddon: FitAddon
  }
>()

export function roundDisplayMetric(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function readRuntime(): TerminalDisplayMeasurement['runtime'] {
  const runtime = window.opencoveApi?.meta?.runtime
  return runtime === 'browser' ? 'browser' : runtime === 'electron' ? 'desktop' : 'unknown'
}

function buildCandidates(baseFontSize: number): TerminalDisplayCandidate[] {
  const candidates: TerminalDisplayCandidate[] = []
  for (let fontSize = baseFontSize - 1.5; fontSize <= baseFontSize + 1.5; fontSize += 0.25) {
    for (const lineHeight of DEFAULT_LINE_HEIGHTS) {
      for (const letterSpacing of DEFAULT_LETTER_SPACINGS) {
        candidates.push({ fontSize: roundDisplayMetric(fontSize, 3), lineHeight, letterSpacing })
      }
    }
  }
  return candidates.filter(candidate => candidate.fontSize > 0)
}

function scoreMeasurement(
  candidate: TerminalDisplayCandidate,
  measurement: TerminalDisplayMeasurement,
  target: TerminalDisplayMeasurement,
  preferred: TerminalDisplayCandidate,
): TerminalDisplayCandidateResult {
  const score = roundDisplayMetric(
    Math.abs(measurement.cols - target.cols) * 1000 +
      Math.abs(measurement.rows - target.rows) * 1000 +
      Math.abs(measurement.cssCellWidth - target.cssCellWidth) * 100 +
      Math.abs(measurement.cssCellHeight - target.cssCellHeight) * 100,
  )
  const preferenceDistance = roundDisplayMetric(
    Math.abs(candidate.fontSize - preferred.fontSize) +
      Math.abs(candidate.lineHeight - preferred.lineHeight) * 10 +
      Math.abs(candidate.letterSpacing - preferred.letterSpacing),
  )
  return { candidate, measurement, score, preferenceDistance }
}

function compareCandidateResults(
  left: TerminalDisplayCandidateResult,
  right: TerminalDisplayCandidateResult,
): number {
  if (left.score !== right.score) {
    return left.score - right.score
  }
  if (left.preferenceDistance !== right.preferenceDistance) {
    return left.preferenceDistance - right.preferenceDistance
  }
  return left.candidate.fontSize - right.candidate.fontSize
}

function waitForAnimationFrames(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function readMeasurement({
  terminal,
  fitAddon,
  fontSize,
  fontFamily,
}: {
  terminal: Terminal
  fitAddon: FitAddon
  fontSize?: number
  fontFamily: string | null
}): TerminalDisplayMeasurement | null {
  const proposed = fitAddon.proposeDimensions()
  const core = terminal as XtermIntrospection
  const cssCell = core._core?._renderService?.dimensions?.css?.cell
  const effectiveDpr = (core._core as { _coreBrowserService?: { dpr?: unknown } } | undefined)
    ?._coreBrowserService?.dpr

  if (
    !proposed ||
    typeof cssCell?.width !== 'number' ||
    typeof cssCell.height !== 'number' ||
    typeof effectiveDpr !== 'number'
  ) {
    return null
  }

  return {
    fontSize: fontSize ?? terminal.options.fontSize ?? 13,
    fontFamily,
    lineHeight: terminal.options.lineHeight ?? 1,
    letterSpacing: terminal.options.letterSpacing ?? 0,
    cols: proposed.cols,
    rows: proposed.rows,
    cssCellWidth: cssCell.width,
    cssCellHeight: cssCell.height,
    effectiveDpr,
    windowDevicePixelRatio: window.devicePixelRatio || 1,
    visualViewportScale: window.visualViewport?.scale ?? null,
    runtime: readRuntime(),
    measuredAt: new Date().toISOString(),
  }
}

function emitMeasurementHandlesChanged(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED))
}

export function registerTerminalDisplayMeasurementHandle({
  nodeId,
  terminal,
  fitAddon,
}: {
  nodeId: string
  terminal: Terminal
  fitAddon: FitAddon
}): () => void {
  terminalDisplayMeasurementHandles.set(nodeId, { terminal, fitAddon })
  emitMeasurementHandlesChanged()

  return () => {
    terminalDisplayMeasurementHandles.delete(nodeId)
    emitMeasurementHandlesChanged()
  }
}

export function measureFirstMountedTerminalDisplay({
  terminalFontSize,
  terminalFontFamily,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
}): TerminalDisplayMeasurement | null {
  for (const { terminal, fitAddon } of terminalDisplayMeasurementHandles.values()) {
    const measurement = readMeasurement({
      terminal,
      fitAddon,
      fontSize: terminalFontSize,
      fontFamily: terminalFontFamily,
    })
    if (measurement) {
      return measurement
    }
  }

  return null
}

async function applyCandidate(
  terminal: Terminal,
  candidate: TerminalDisplayCandidate,
): Promise<void> {
  terminal.options.fontSize = candidate.fontSize
  terminal.options.lineHeight = candidate.lineHeight
  terminal.options.letterSpacing = candidate.letterSpacing
  await waitForAnimationFrames()
}

async function createMeasuredTerminal({
  container,
  fontFamily,
  baseCandidate,
}: {
  container: HTMLDivElement
  fontFamily: string | null
  baseCandidate: TerminalDisplayCandidate
}): Promise<{
  terminal: Terminal
  fitAddon: FitAddon
  dispose: () => void
}> {
  container.replaceChildren()
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: 80,
    rows: 24,
    fontFamily: fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: baseCandidate.fontSize,
    lineHeight: baseCandidate.lineHeight,
    letterSpacing: baseCandidate.letterSpacing,
    scrollback: 0,
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(container)
  const dprController = installTerminalEffectiveDevicePixelRatioController({
    terminal,
    initialViewportZoom: 1,
  })
  await waitForAnimationFrames()

  return {
    terminal,
    fitAddon,
    dispose: () => {
      dprController.dispose()
      terminal.dispose()
      container.replaceChildren()
    },
  }
}

export async function measureTerminalDisplayProfile({
  container,
  terminalFontSize,
  terminalFontFamily,
}: {
  container: HTMLDivElement
  terminalFontSize: number
  terminalFontFamily: string | null
}): Promise<TerminalDisplayMeasurement | null> {
  const baseCandidate = { fontSize: terminalFontSize, lineHeight: 1, letterSpacing: 0 }
  const measuredTerminal = await createMeasuredTerminal({
    container,
    fontFamily: terminalFontFamily,
    baseCandidate,
  })

  try {
    return readMeasurement({
      terminal: measuredTerminal.terminal,
      fitAddon: measuredTerminal.fitAddon,
      fontFamily: terminalFontFamily,
    })
  } finally {
    measuredTerminal.dispose()
  }
}

export async function calibrateTerminalDisplayProfile({
  container,
  terminalFontSize,
  terminalFontFamily,
  reference,
}: {
  container: HTMLDivElement
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference
}): Promise<TerminalDisplayCandidateResult | null> {
  const baseCandidate = { fontSize: terminalFontSize, lineHeight: 1, letterSpacing: 0 }
  const measuredTerminal = await createMeasuredTerminal({
    container,
    fontFamily: terminalFontFamily,
    baseCandidate,
  })

  try {
    const results: TerminalDisplayCandidateResult[] = []
    await buildCandidates(terminalFontSize).reduce(async (previous, candidate) => {
      await previous
      await applyCandidate(measuredTerminal.terminal, candidate)
      const measurement = readMeasurement({
        terminal: measuredTerminal.terminal,
        fitAddon: measuredTerminal.fitAddon,
        fontFamily: terminalFontFamily,
      })
      if (measurement) {
        results.push(scoreMeasurement(candidate, measurement, reference.measurement, baseCandidate))
      }
    }, Promise.resolve())
    return results.sort(compareCandidateResults)[0] ?? null
  } finally {
    measuredTerminal.dispose()
  }
}
