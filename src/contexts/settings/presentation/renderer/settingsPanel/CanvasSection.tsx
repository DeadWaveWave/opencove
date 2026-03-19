import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_INPUT_MODES,
  UI_THEMES,
  MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MAX_TERMINAL_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MIN_TERMINAL_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type CanvasInputMode,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { getCanvasInputModeLabel, getUiThemeLabel } from '@app/renderer/i18n/labels'
import type { TerminalProfile } from '@shared/contracts/dto'

export function CanvasSection(props: {
  uiTheme: UiTheme
  canvasInputMode: CanvasInputMode
  normalizeZoomOnTerminalClick: boolean
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  uiFontSize: number
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
  onChangeNormalizeZoomOnTerminalClick: (enabled: boolean) => void
  onChangeDefaultTerminalWindowScalePercent: (percent: number) => void
  onChangeTerminalFontSize: (size: number) => void
  onChangeUiFontSize: (size: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    uiTheme,
    canvasInputMode,
    normalizeZoomOnTerminalClick,
    defaultTerminalWindowScalePercent,
    terminalFontSize,
    uiFontSize,
    defaultTerminalProfileId,
    terminalProfiles,
    detectedDefaultTerminalProfileId,
    onChangeUiTheme,
    onChangeCanvasInputMode,
    onChangeDefaultTerminalProfileId,
    onChangeNormalizeZoomOnTerminalClick,
    onChangeDefaultTerminalWindowScalePercent,
    onChangeTerminalFontSize,
    onChangeUiFontSize,
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
          <strong>{t('settingsPanel.canvas.uiThemeLabel')}</strong>
          <span>{t('settingsPanel.canvas.uiThemeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <select
            id="settings-ui-theme"
            data-testid="settings-ui-theme"
            value={uiTheme}
            onChange={event => onChangeUiTheme(event.target.value as UiTheme)}
          >
            {UI_THEMES.map(theme => (
              <option key={theme} value={theme}>
                {getUiThemeLabel(t, theme)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.inputModeLabel')}</strong>
          <span>{t('settingsPanel.canvas.inputModeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <select
            id="settings-canvas-input-mode"
            data-testid="settings-canvas-input-mode"
            value={canvasInputMode}
            onChange={event => onChangeCanvasInputMode(event.target.value as CanvasInputMode)}
          >
            {CANVAS_INPUT_MODES.map(mode => (
              <option key={mode} value={mode}>
                {getCanvasInputModeLabel(t, mode)}
              </option>
            ))}
          </select>
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
            <select
              id="settings-terminal-profile"
              data-testid="settings-terminal-profile"
              value={selectedProfileId ?? ''}
              onChange={event =>
                onChangeDefaultTerminalProfileId(
                  event.target.value.trim().length > 0 ? event.target.value : null,
                )
              }
            >
              <option value="">
                {t('settingsPanel.canvas.terminalProfileAutoWithDefault', {
                  defaultProfile:
                    terminalProfiles.find(
                      profile => profile.id === detectedDefaultTerminalProfileId,
                    )?.label ?? t('settingsPanel.canvas.terminalProfileAuto'),
                })}
              </option>
              {terminalProfiles.map(profile => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.initialWindowSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
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
          <strong>{t('settingsPanel.canvas.terminalFontSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            style={{ width: '80px' }}
            type="number"
            min={MIN_TERMINAL_FONT_SIZE}
            max={MAX_TERMINAL_FONT_SIZE}
            value={terminalFontSize}
            onChange={event => onChangeTerminalFontSize(Number(event.target.value))}
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.pixelUnit')}
          </span>
        </div>
      </div>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.interfaceFontSize')}</strong>
        </div>
        <div className="settings-panel__control" style={{ alignItems: 'center', gap: '8px' }}>
          <input
            style={{ width: '80px' }}
            type="number"
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            value={uiFontSize}
            onChange={event => onChangeUiFontSize(Number(event.target.value))}
          />
          <span style={{ fontSize: '12px', color: 'var(--cove-text-muted)' }}>
            {t('common.pixelUnit')}
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
