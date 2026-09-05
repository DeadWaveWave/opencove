import React, { useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalDisplayReference } from '@contexts/settings/domain/terminalDisplayCalibration'
import {
  getTerminalDisplayCalibrationQuality,
  isTerminalDisplayReferenceCurrent,
  isTerminalDisplayReferenceForProfile,
} from '@contexts/settings/domain/terminalDisplayCalibration'
import {
  readTerminalDisplayCalibrationStorageMetadata,
  readTerminalDisplayCalibrationSuppression,
  useTerminalClientDisplayCalibrationInspection,
} from '../terminalDisplayCalibrationStorage'
import { useTerminalDisplayCalibrationProjection } from '../useTerminalDisplayCalibrationProjection'
import { terminalDisplayCalibrationOwner } from '../terminalDisplayCalibrationRuntime'
import { readTerminalDisplayClientRuntime } from '../terminalDisplayClientApi'
import { readTerminalDisplayCalibrationAttempt } from '../terminalDisplayCalibrationDiagnostics'
import {
  resolveMountedTerminalDisplayRendererInventory,
  roundDisplayMetric,
} from '../terminalDisplayMeasurement'
import { SettingsModule } from './SettingsGroup'

export function TerminalDisplayCalibrationRow({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayAutoReferenceEnabled,
  terminalDisplayCalibrationCompensationEnabled,
  terminalDisplayReference,
  onChangeTerminalDisplayAutoReferenceEnabled,
  onChangeTerminalDisplayCalibrationCompensationEnabled,
  onChangeTerminalDisplayReference,
}: {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayAutoReferenceEnabled: boolean
  terminalDisplayCalibrationCompensationEnabled: boolean
  terminalDisplayReference: TerminalDisplayReference | null
  onChangeTerminalDisplayAutoReferenceEnabled: (enabled: boolean) => void
  onChangeTerminalDisplayCalibrationCompensationEnabled: (enabled: boolean) => void
  onChangeTerminalDisplayReference: (reference: TerminalDisplayReference | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const clientCalibration = useTerminalDisplayCalibrationProjection({
    terminalFontSize,
    terminalFontFamily,
    terminalDisplayReference,
  })
  const calibrationInspection = useTerminalClientDisplayCalibrationInspection({
    terminalFontSize,
    terminalFontFamily,
    terminalDisplayReference,
  })
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const referenceMatchesProfile = isTerminalDisplayReferenceForProfile(terminalDisplayReference, {
    terminalFontSize,
    terminalFontFamily,
  })
  const activeReference =
    referenceMatchesProfile && isTerminalDisplayReferenceCurrent(terminalDisplayReference)
      ? terminalDisplayReference
      : null
  const clientRuntime = readTerminalDisplayClientRuntime()
  const hasVerifiedStoredCalibration =
    calibrationInspection.atomicProofPresent && calibrationInspection.calibrationMatchesReference
  const getQualityLabel = (score: number): string =>
    t(
      `settingsPanel.general.terminalDisplayCalibration.quality.${getTerminalDisplayCalibrationQuality(score)}`,
    )

  const setCurrentAsReference = async (): Promise<void> => {
    if (isBusy) {
      return
    }
    setIsBusy(true)
    try {
      const result = await terminalDisplayCalibrationOwner.captureReferenceNow()
      if (result.outcome !== 'captured') {
        setStatus(t('settingsPanel.general.terminalDisplayCalibration.measureFailed'))
        return
      }
      onChangeTerminalDisplayReference(result.reference)
      setStatus(t('settingsPanel.general.terminalDisplayCalibration.referenceSaved'))
    } finally {
      setIsBusy(false)
    }
  }

  const calibrateThisDevice = async (): Promise<void> => {
    if (isBusy) {
      return
    }
    if (!activeReference) {
      setStatus(t('settingsPanel.general.terminalDisplayCalibration.referenceRequired'))
      return
    }

    setIsBusy(true)
    try {
      const result = await terminalDisplayCalibrationOwner.calibrateNow()
      if (result.outcome === 'saved') {
        setStatus(
          t('settingsPanel.general.terminalDisplayCalibration.calibrationSaved', {
            quality: getQualityLabel(result.score),
          }),
        )
        return
      }
      if (result.outcome === 'candidate-rejected') {
        setStatus(
          t('settingsPanel.general.terminalDisplayCalibration.calibrationUnmatchable', {
            quality: getQualityLabel(result.score),
          }),
        )
        return
      }
      setStatus(
        t(
          result.outcome === 'storage-unavailable'
            ? 'settingsPanel.general.terminalDisplayCalibration.storageFailed'
            : 'settingsPanel.general.terminalDisplayCalibration.measureFailed',
        ),
      )
    } finally {
      setIsBusy(false)
    }
  }

  const resetThisDevice = (): void => {
    setStatus(
      t(
        terminalDisplayCalibrationOwner.reset()
          ? 'settingsPanel.general.terminalDisplayCalibration.resetDone'
          : 'settingsPanel.general.terminalDisplayCalibration.storageFailed',
      ),
    )
  }

  const copyDiagnostics = async (): Promise<void> => {
    const payload = {
      terminalFontSize,
      terminalFontFamily,
      autoReferenceEnabled: terminalDisplayAutoReferenceEnabled,
      calibrationCompensationEnabled: terminalDisplayCalibrationCompensationEnabled,
      reference: terminalDisplayReference,
      referenceMatchesCurrentProfile: referenceMatchesProfile,
      referenceUsesCurrentCalibrationAlgorithm:
        isTerminalDisplayReferenceCurrent(terminalDisplayReference),
      referenceCapture: terminalDisplayReference?.capture ?? null,
      mountedRendererInventory: resolveMountedTerminalDisplayRendererInventory(),
      clientCalibrationSuppression: readTerminalDisplayCalibrationSuppression(),
      clientCalibrationInspection: {
        ...calibrationInspection,
        applicableCalibrationPresent: clientCalibration !== null,
      },
      latestAutomaticCalibrationAttempt: readTerminalDisplayCalibrationAttempt(),
      clientCalibration,
      clientCalibrationStorageMetadata: readTerminalDisplayCalibrationStorageMetadata(),
      clientCalibrationQuality: clientCalibration
        ? getTerminalDisplayCalibrationQuality(clientCalibration.score)
        : null,
      runtime: clientRuntime,
      devicePixelRatio: window.devicePixelRatio || 1,
      visualViewportScale: window.visualViewport?.scale ?? null,
    }
    await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
    setStatus(t('settingsPanel.general.terminalDisplayCalibration.diagnosticsCopied'))
  }

  const summary = !terminalDisplayCalibrationCompensationEnabled
    ? hasVerifiedStoredCalibration && calibrationInspection.calibrationScore !== null
      ? t('settingsPanel.general.terminalDisplayCalibration.clientCalibrationPaused', {
          quality: getQualityLabel(calibrationInspection.calibrationScore),
        })
      : t(
          calibrationInspection.rawCalibrationPresent
            ? 'settingsPanel.general.terminalDisplayCalibration.clientCalibrationDisabledUnavailable'
            : 'settingsPanel.general.terminalDisplayCalibration.clientCalibrationDisabled',
        )
    : clientCalibration
      ? t('settingsPanel.general.terminalDisplayCalibration.clientCalibrated', {
          fontSize: clientCalibration.fontSize,
          lineHeight: clientCalibration.lineHeight,
          quality: getQualityLabel(clientCalibration.score),
        })
      : calibrationInspection.rawCalibrationPresent
        ? t('settingsPanel.general.terminalDisplayCalibration.clientCalibrationUnavailable')
        : t('settingsPanel.general.terminalDisplayCalibration.clientDefault')

  return (
    <SettingsModule
      id="settings-section-terminal-display-calibration"
      title={t('settingsPanel.general.terminalDisplayCalibration.title')}
      description={t('settingsPanel.general.terminalDisplayCalibration.help')}
    >
      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>
            {t('settingsPanel.general.terminalDisplayCalibration.autoReferenceLabel')}
          </strong>
          <span>{t('settingsPanel.general.terminalDisplayCalibration.autoReferenceHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-terminal-display-auto-reference"
              checked={terminalDisplayAutoReferenceEnabled}
              aria-label={t('settingsPanel.general.terminalDisplayCalibration.autoReferenceLabel')}
              onChange={event => onChangeTerminalDisplayAutoReferenceEnabled(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.general.terminalDisplayCalibration.compensationLabel')}</strong>
          <span>{t('settingsPanel.general.terminalDisplayCalibration.compensationHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-terminal-display-compensation"
              checked={terminalDisplayCalibrationCompensationEnabled}
              aria-label={t('settingsPanel.general.terminalDisplayCalibration.compensationLabel')}
              onChange={event =>
                onChangeTerminalDisplayCalibrationCompensationEnabled(event.target.checked)
              }
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
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
                : t(
                    terminalDisplayAutoReferenceEnabled
                      ? 'settingsPanel.general.terminalDisplayCalibration.referenceEmpty'
                      : 'settingsPanel.general.terminalDisplayCalibration.referenceEmptyAutoOff',
                  )}
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
            disabled={isBusy || !calibrationInspection.rawCalibrationPresent}
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
    </SettingsModule>
  )
}
