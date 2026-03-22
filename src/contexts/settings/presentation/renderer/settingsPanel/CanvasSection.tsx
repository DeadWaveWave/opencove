import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_INPUT_MODES,
  MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  type CanvasInputMode,
} from '@contexts/settings/domain/agentSettings'
import { getCanvasInputModeLabel } from '@app/renderer/i18n/labels'
import type { TerminalProfile } from '@shared/contracts/dto'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  normalizeZoomOnTerminalClick: boolean
  defaultTerminalWindowScalePercent: number
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
  onChangeNormalizeZoomOnTerminalClick: (enabled: boolean) => void
  onChangeDefaultTerminalWindowScalePercent: (percent: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    canvasInputMode,
    normalizeZoomOnTerminalClick,
    defaultTerminalWindowScalePercent,
    defaultTerminalProfileId,
    terminalProfiles,
    detectedDefaultTerminalProfileId,
    onChangeCanvasInputMode,
    onChangeDefaultTerminalProfileId,
    onChangeNormalizeZoomOnTerminalClick,
    onChangeDefaultTerminalWindowScalePercent,
  } = props
  const selectedProfileId = terminalProfiles.some(
    profile => profile.id === defaultTerminalProfileId,
  )
    ? defaultTerminalProfileId
    : null

  return (
    <div className="settings-panel__section" id="settings-section-canvas">
      <h3 className="settings-panel__section-title">{t('settingsPanel.canvas.title')}</h3>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.inputModeLabel')}</strong>
          <span>{t('settingsPanel.canvas.inputModeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-canvas-input-mode"
            testId="settings-canvas-input-mode"
            value={canvasInputMode}
            options={CANVAS_INPUT_MODES.map(mode => ({
              value: mode,
              label: getCanvasInputModeLabel(t, mode),
            }))}
            onChange={nextValue => onChangeCanvasInputMode(nextValue as CanvasInputMode)}
          />
        </div>
      </div>

      {terminalProfiles.length > 0 ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.canvas.terminalProfileLabel')}</strong>
            <span>
              {t('settingsPanel.canvas.terminalProfileHelp', {
                defaultProfile:
                  terminalProfiles.find(profile => profile.id === detectedDefaultTerminalProfileId)
                    ?.label ?? t('settingsPanel.canvas.terminalProfileAuto'),
              })}
            </span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-terminal-profile"
              testId="settings-terminal-profile"
              value={selectedProfileId ?? ''}
              options={[
                {
                  value: '',
                  label: t('settingsPanel.canvas.terminalProfileAutoWithDefault', {
                    defaultProfile:
                      terminalProfiles.find(
                        profile => profile.id === detectedDefaultTerminalProfileId,
                      )?.label ?? t('settingsPanel.canvas.terminalProfileAuto'),
                  }),
                },
                ...terminalProfiles.map(profile => ({
                  value: profile.id,
                  label: profile.label,
                })),
              ]}
              onChange={nextValue =>
                onChangeDefaultTerminalProfileId(nextValue.trim().length > 0 ? nextValue : null)
              }
            />
          </div>
        </div>
      ) : null}

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.initialWindowSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            className="cove-field"
            style={{ width: '80px' }}
            type="number"
            min={MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT}
            max={MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT}
            value={defaultTerminalWindowScalePercent}
            onChange={event =>
              onChangeDefaultTerminalWindowScalePercent(Number(event.target.value))
            }
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.percentUnit')}
          </span>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.autoZoomLabel')}</strong>
          <span>{t('settingsPanel.canvas.autoZoomHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-normalize-zoom-on-terminal-click"
              checked={normalizeZoomOnTerminalClick}
              onChange={event => onChangeNormalizeZoomOnTerminalClick(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>
    </div>
  )
}
