import React, { useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  TerminalClientDisplayCalibration,
  TerminalDisplayReference,
} from '@contexts/settings/domain/terminalDisplayCalibration'
import {
  createTerminalDisplayProfileKey,
  isTerminalDisplayReferenceForProfile,
} from '@contexts/settings/domain/terminalDisplayCalibration'
import {
  clearTerminalClientDisplayCalibration,
  useTerminalClientDisplayCalibration,
  writeTerminalClientDisplayCalibration,
} from '../terminalDisplayCalibrationStorage'
import {
  calibrateTerminalDisplayProfile,
  measureTerminalDisplayProfile,
  roundDisplayMetric,
  TERMINAL_DISPLAY_MEASUREMENT_HEIGHT,
  TERMINAL_DISPLAY_MEASUREMENT_WIDTH,
} from '../terminalDisplayMeasurement'

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
      measureTerminalDisplayProfile({ container: host, terminalFontSize, terminalFontFamily }),
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
      calibrateTerminalDisplayProfile({
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
                  cellWidth: roundDisplayMetric(activeReference.measurement.cssCellWidth, 2),
                  cellHeight: roundDisplayMetric(activeReference.measurement.cssCellHeight, 2),
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
        className="terminal-node__terminal nodrag"
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: -10_000,
          top: -10_000,
          width: TERMINAL_DISPLAY_MEASUREMENT_WIDTH,
          height: TERMINAL_DISPLAY_MEASUREMENT_HEIGHT,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
