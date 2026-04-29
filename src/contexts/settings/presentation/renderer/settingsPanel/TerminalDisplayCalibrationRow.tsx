import React, { useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useTranslation } from '@app/renderer/i18n'
import type {
  TerminalClientDisplayCalibration,
  TerminalDisplayMeasurement,
  TerminalDisplayReference,
} from '@contexts/settings/domain/terminalDisplayCalibration'
import {
  createTerminalDisplayProfileKey,
  isTerminalDisplayReferenceForProfile,
} from '@contexts/settings/domain/terminalDisplayCalibration'
import { DEFAULT_TERMINAL_FONT_FAMILY } from '@contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { installTerminalEffectiveDevicePixelRatioController } from '@contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio'
import {
  clearTerminalClientDisplayCalibration,
  useTerminalClientDisplayCalibration,
  writeTerminalClientDisplayCalibration,
} from '../terminalDisplayCalibrationStorage'

type Candidate = {
  fontSize: number
  lineHeight: number
  letterSpacing: number
}

type CandidateResult = {
  candidate: Candidate
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

const CALIBRATION_WIDTH = 640
const CALIBRATION_HEIGHT = 420
const DEFAULT_LINE_HEIGHTS = [1, 1.05, 1.1]
const DEFAULT_LETTER_SPACINGS = [0]

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function readRuntime(): TerminalDisplayMeasurement['runtime'] {
  const runtime = window.opencoveApi?.meta?.runtime
  return runtime === 'browser' ? 'browser' : runtime === 'electron' ? 'desktop' : 'unknown'
}

function buildCandidates(baseFontSize: number): Candidate[] {
  const candidates: Candidate[] = []
  for (let fontSize = baseFontSize - 1.5; fontSize <= baseFontSize + 1.5; fontSize += 0.25) {
    for (const lineHeight of DEFAULT_LINE_HEIGHTS) {
      for (const letterSpacing of DEFAULT_LETTER_SPACINGS) {
        candidates.push({ fontSize: round(fontSize, 3), lineHeight, letterSpacing })
      }
    }
  }
  return candidates.filter(candidate => candidate.fontSize > 0)
}

function scoreMeasurement(
  candidate: Candidate,
  measurement: TerminalDisplayMeasurement,
  target: TerminalDisplayMeasurement,
  preferred: Candidate,
): CandidateResult {
  const score = round(
    Math.abs(measurement.cols - target.cols) * 1000 +
      Math.abs(measurement.rows - target.rows) * 1000 +
      Math.abs(measurement.cssCellWidth - target.cssCellWidth) * 100 +
      Math.abs(measurement.cssCellHeight - target.cssCellHeight) * 100,
  )
  const preferenceDistance = round(
    Math.abs(candidate.fontSize - preferred.fontSize) +
      Math.abs(candidate.lineHeight - preferred.lineHeight) * 10 +
      Math.abs(candidate.letterSpacing - preferred.letterSpacing),
  )
  return { candidate, measurement, score, preferenceDistance }
}

function compareCandidateResults(left: CandidateResult, right: CandidateResult): number {
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
  fontFamily,
}: {
  terminal: Terminal
  fitAddon: FitAddon
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
    fontSize: terminal.options.fontSize ?? 13,
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

async function applyCandidate(terminal: Terminal, candidate: Candidate): Promise<void> {
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
  baseCandidate: Candidate
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

async function measureCurrentProfile({
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

async function calibrateCurrentProfile({
  container,
  terminalFontSize,
  terminalFontFamily,
  reference,
}: {
  container: HTMLDivElement
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference
}): Promise<CandidateResult | null> {
  const baseCandidate = { fontSize: terminalFontSize, lineHeight: 1, letterSpacing: 0 }
  const measuredTerminal = await createMeasuredTerminal({
    container,
    fontFamily: terminalFontFamily,
    baseCandidate,
  })

  try {
    const results: CandidateResult[] = []
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

export function TerminalDisplayCalibrationRow({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayReference,
  onChangeTerminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayReference: TerminalDisplayReference | null
  onChangeTerminalDisplayReference: (reference: TerminalDisplayReference | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const measurementHostRef = useRef<HTMLDivElement | null>(null)
  const clientCalibration = useTerminalClientDisplayCalibration({
    terminalFontSize,
    terminalFontFamily,
    terminalDisplayReference,
  })
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const profileKey = useMemo(
    () => createTerminalDisplayProfileKey({ terminalFontSize, terminalFontFamily }),
    [terminalFontFamily, terminalFontSize],
  )
  const activeReference = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })
    ? terminalDisplayReference
    : null

  const runWithHost = async <T,>(task: (host: HTMLDivElement) => Promise<T>): Promise<T | null> => {
    const host = measurementHostRef.current
    if (!host || isBusy) {
      return null
    }

    setIsBusy(true)
    try {
      return await task(host)
    } finally {
      setIsBusy(false)
    }
  }

  const setCurrentAsReference = async (): Promise<void> => {
    const measurement = await runWithHost(host =>
      measureCurrentProfile({ container: host, terminalFontSize, terminalFontFamily }),
    )
    if (!measurement) {
      setStatus(t('settingsPanel.general.terminalDisplayCalibration.measureFailed'))
      return
    }

    onChangeTerminalDisplayReference({ version: 1, measurement })
    setStatus(t('settingsPanel.general.terminalDisplayCalibration.referenceSaved'))
  }

  const calibrateThisDevice = async (): Promise<void> => {
    if (!activeReference) {
      setStatus(t('settingsPanel.general.terminalDisplayCalibration.referenceRequired'))
      return
    }

    const result = await runWithHost(host =>
      calibrateCurrentProfile({
        container: host,
        terminalFontSize,
        terminalFontFamily,
        reference: activeReference,
      }),
    )
    if (!result) {
      setStatus(t('settingsPanel.general.terminalDisplayCalibration.measureFailed'))
      return
    }

    const calibration: TerminalClientDisplayCalibration = {
      version: 1,
      profileKey,
      fontSize: result.candidate.fontSize,
      lineHeight: result.candidate.lineHeight,
      letterSpacing: result.candidate.letterSpacing,
      target: {
        cols: activeReference.measurement.cols,
        rows: activeReference.measurement.rows,
        cssCellWidth: activeReference.measurement.cssCellWidth,
        cssCellHeight: activeReference.measurement.cssCellHeight,
        effectiveDpr: activeReference.measurement.effectiveDpr,
      },
      score: result.score,
      measuredAt: new Date().toISOString(),
    }
    writeTerminalClientDisplayCalibration(calibration)
    setStatus(t('settingsPanel.general.terminalDisplayCalibration.calibrationSaved'))
  }

  const resetThisDevice = (): void => {
    clearTerminalClientDisplayCalibration()
    setStatus(t('settingsPanel.general.terminalDisplayCalibration.resetDone'))
  }

  const copyDiagnostics = async (): Promise<void> => {
    const payload = {
      terminalFontSize,
      terminalFontFamily,
      reference: terminalDisplayReference,
      referenceMatchesCurrentProfile: activeReference !== null,
      clientCalibration,
      runtime: window.opencoveApi?.meta?.runtime ?? 'unknown',
      devicePixelRatio: window.devicePixelRatio || 1,
      visualViewportScale: window.visualViewport?.scale ?? null,
    }
    await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
    setStatus(t('settingsPanel.general.terminalDisplayCalibration.diagnosticsCopied'))
  }

  const summary = clientCalibration
    ? t('settingsPanel.general.terminalDisplayCalibration.clientCalibrated', {
        fontSize: clientCalibration.fontSize,
        lineHeight: clientCalibration.lineHeight,
        score: clientCalibration.score,
      })
    : t('settingsPanel.general.terminalDisplayCalibration.clientDefault')

  return (
    <div className="settings-panel__subsection" id="settings-section-terminal-display-calibration">
      <div className="settings-panel__subsection-header">
        <h4 className="settings-panel__section-title">
          {t('settingsPanel.general.terminalDisplayCalibration.title')}
        </h4>
        <span>{t('settingsPanel.general.terminalDisplayCalibration.help')}</span>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.terminalDisplayCalibration.referenceLabel')}</strong>
          <span>
            {activeReference
              ? t('settingsPanel.general.terminalDisplayCalibration.referenceSummary', {
                  cols: activeReference.measurement.cols,
                  rows: activeReference.measurement.rows,
                  cellWidth: round(activeReference.measurement.cssCellWidth, 2),
                  cellHeight: round(activeReference.measurement.cssCellHeight, 2),
                })
              : terminalDisplayReference
                ? t('settingsPanel.general.terminalDisplayCalibration.referenceStale')
                : t('settingsPanel.general.terminalDisplayCalibration.referenceEmpty')}
          </span>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="secondary"
            data-testid="settings-terminal-display-set-reference"
            disabled={isBusy}
            onClick={() => void setCurrentAsReference()}
          >
            {t('settingsPanel.general.terminalDisplayCalibration.setReference')}
          </button>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.terminalDisplayCalibration.clientLabel')}</strong>
          <span>{summary}</span>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="primary"
            data-testid="settings-terminal-display-calibrate"
            disabled={isBusy || !activeReference}
            onClick={() => void calibrateThisDevice()}
          >
            {t('settingsPanel.general.terminalDisplayCalibration.calibrate')}
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="settings-terminal-display-reset"
            disabled={isBusy || !clientCalibration}
            onClick={resetThisDevice}
          >
            {t('settingsPanel.general.terminalDisplayCalibration.reset')}
          </button>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.terminalDisplayCalibration.diagnosticsLabel')}</strong>
          <span>
            {status ?? t('settingsPanel.general.terminalDisplayCalibration.diagnosticsHelp')}
          </span>
        </div>
        <div className="settings-panel__control">
          <button
            type="button"
            className="secondary"
            data-testid="settings-terminal-display-copy-diagnostics"
            onClick={() => void copyDiagnostics()}
          >
            {t('settingsPanel.general.terminalDisplayCalibration.copyDiagnostics')}
          </button>
        </div>
      </div>

      <div
        ref={measurementHostRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: -10_000,
          top: -10_000,
          width: CALIBRATION_WIDTH,
          height: CALIBRATION_HEIGHT,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
