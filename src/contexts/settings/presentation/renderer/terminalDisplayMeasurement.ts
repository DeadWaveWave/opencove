import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalDisplayMeasurement,
  TerminalDisplayReference,
  TerminalDisplayRendererKind,
} from '../../domain/terminalDisplayCalibration'
import { DEFAULT_TERMINAL_FONT_FAMILY } from '@shared/terminal/displayDefaults'
import { readTerminalDisplayClientRuntime } from './terminalDisplayClientApi'
import { listTerminalDisplayMeasurementHandles } from '@shared/runtime/terminalDisplayMeasurementRegistry'
export {
  notifyTerminalDisplayMeasurementHandlesChanged,
  TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED,
} from '@shared/runtime/terminalDisplayMeasurementRegistry'

export type { TerminalDisplayRendererKind } from '../../domain/terminalDisplayCalibration'

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

const DEFAULT_LINE_HEIGHTS = [1]
const DEFAULT_LETTER_SPACINGS = [0]

export function roundDisplayMetric(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function readTerminalDisplayRuntime(): TerminalDisplayMeasurement['runtime'] {
  return readTerminalDisplayClientRuntime()
}

export function buildTerminalDisplayCalibrationCandidates(
  baseFontSize: number,
): TerminalDisplayCandidate[] {
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

  const actualFontSize = terminal.options.fontSize ?? 13
  const actualFontFamily = terminal.options.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY
  const expectedFontFamily = fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY
  if (
    !proposed ||
    typeof cssCell?.width !== 'number' ||
    typeof cssCell.height !== 'number' ||
    typeof effectiveDpr !== 'number' ||
    (fontSize !== undefined && Math.abs(actualFontSize - fontSize) > 0.001) ||
    actualFontFamily !== expectedFontFamily
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
    runtime: readTerminalDisplayRuntime(),
    measuredAt: new Date().toISOString(),
  }
}

function createTemporaryMeasurementContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  const container = document.createElement('div')
  container.className = 'terminal-node__terminal nodrag'
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: `${TERMINAL_DISPLAY_MEASUREMENT_WIDTH}px`,
    height: `${TERMINAL_DISPLAY_MEASUREMENT_HEIGHT}px`,
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.append(container)
  return container
}

export function hasMountedTerminalDisplayMeasurementHandle(): boolean {
  return listTerminalDisplayMeasurementHandles().length > 0
}

export function resolveMountedTerminalDisplayRendererInventory(): Record<
  TerminalDisplayRendererKind,
  number
> {
  const inventory: Record<TerminalDisplayRendererKind, number> = { dom: 0, webgl: 0 }
  for (const handle of listTerminalDisplayMeasurementHandles()) {
    inventory[handle.getRendererKind()] += 1
  }
  return inventory
}

export function resolveMountedTerminalDisplayRendererKind(): TerminalDisplayRendererKind | null {
  const inventory = resolveMountedTerminalDisplayRendererInventory()
  const kinds = (Object.entries(inventory) as Array<[TerminalDisplayRendererKind, number]>)
    .filter(([, count]) => count > 0)
    .map(([kind]) => kind)
  return kinds.length === 1 ? (kinds[0] ?? null) : null
}

export function measureFirstMountedTerminalDisplay({
  terminalFontSize,
  terminalFontFamily,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
}): TerminalDisplayMeasurement | null {
  for (const { terminal, fitAddon } of listTerminalDisplayMeasurementHandles()) {
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

export async function measureTerminalDisplayReferenceBaseline({
  terminalFontSize,
  terminalFontFamily,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
}): Promise<TerminalDisplayMeasurement | null> {
  try {
    await document.fonts?.ready
  } catch {
    return null
  }
  const container = createTemporaryMeasurementContainer()
  const rendererKind = resolveMountedTerminalDisplayRendererKind()
  if (!container || !rendererKind) {
    container?.remove()
    return null
  }

  try {
    const measurement = await measureTerminalDisplayProfile({
      container,
      terminalFontSize,
      terminalFontFamily,
      rendererKind,
    })
    return resolveMountedTerminalDisplayRendererKind() === rendererKind ? measurement : null
  } finally {
    container.remove()
  }
}

export async function calibrateTerminalDisplayReferenceAutomatically(input: {
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference
  rendererKind: TerminalDisplayRendererKind
}): Promise<TerminalDisplayCandidateResult | null> {
  const container = createTemporaryMeasurementContainer()
  if (!container) {
    return null
  }
  try {
    return await calibrateTerminalDisplayProfile({ container, ...input })
  } finally {
    container.remove()
  }
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
  rendererKind,
}: {
  container: HTMLDivElement
  fontFamily: string | null
  baseCandidate: TerminalDisplayCandidate
  rendererKind: TerminalDisplayRendererKind
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
  const rendererAddon = rendererKind === 'webgl' ? new WebglAddon() : null
  if (rendererAddon) {
    terminal.loadAddon(rendererAddon)
  }
  await waitForAnimationFrames()

  return {
    terminal,
    fitAddon,
    dispose: () => {
      rendererAddon?.dispose()
      terminal.dispose()
      container.replaceChildren()
    },
  }
}

export async function measureTerminalDisplayProfile({
  container,
  terminalFontSize,
  terminalFontFamily,
  rendererKind = resolveMountedTerminalDisplayRendererKind() ?? 'dom',
}: {
  container: HTMLDivElement
  terminalFontSize: number
  terminalFontFamily: string | null
  rendererKind?: TerminalDisplayRendererKind
}): Promise<TerminalDisplayMeasurement | null> {
  const baseCandidate = { fontSize: terminalFontSize, lineHeight: 1, letterSpacing: 0 }
  const measuredTerminal = await createMeasuredTerminal({
    container,
    fontFamily: terminalFontFamily,
    baseCandidate,
    rendererKind,
  }).catch(() => null)
  if (!measuredTerminal) {
    return null
  }

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
  rendererKind = resolveMountedTerminalDisplayRendererKind() ?? 'dom',
}: {
  container: HTMLDivElement
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference
  rendererKind?: TerminalDisplayRendererKind
}): Promise<TerminalDisplayCandidateResult | null> {
  const baseCandidate = { fontSize: terminalFontSize, lineHeight: 1, letterSpacing: 0 }
  const measuredTerminal = await createMeasuredTerminal({
    container,
    fontFamily: terminalFontFamily,
    baseCandidate,
    rendererKind,
  }).catch(() => null)
  if (!measuredTerminal) {
    return null
  }

  try {
    const results: TerminalDisplayCandidateResult[] = []
    await buildTerminalDisplayCalibrationCandidates(terminalFontSize).reduce(
      async (previous, candidate) => {
        await previous
        await applyCandidate(measuredTerminal.terminal, candidate)
        const measurement = readMeasurement({
          terminal: measuredTerminal.terminal,
          fitAddon: measuredTerminal.fitAddon,
          fontFamily: terminalFontFamily,
        })
        if (measurement) {
          results.push(
            scoreMeasurement(candidate, measurement, reference.measurement, baseCandidate),
          )
        }
      },
      Promise.resolve(),
    )
    return results.sort(compareCandidateResults)[0] ?? null
  } finally {
    measuredTerminal.dispose()
  }
}
