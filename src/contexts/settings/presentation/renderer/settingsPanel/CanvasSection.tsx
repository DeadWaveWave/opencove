import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_INPUT_MODES,
  MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MAX_TERMINAL_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MIN_TERMINAL_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type CanvasInputMode,
} from '@contexts/settings/domain/agentSettings'
import { getCanvasInputModeLabel } from '@app/renderer/i18n/labels'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  normalizeZoomOnTerminalClick: boolean
  defaultTerminalWindowScalePercent: number
  terminalFontSize: number
  uiFontSize: number
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeNormalizeZoomOnTerminalClick: (enabled: boolean) => void
  onChangeDefaultTerminalWindowScalePercent: (percent: number) => void
  onChangeTerminalFontSize: (size: number) => void
  onChangeUiFontSize: (size: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    canvasInputMode,
    normalizeZoomOnTerminalClick,
    defaultTerminalWindowScalePercent,
    terminalFontSize,
    uiFontSize,
    onChangeCanvasInputMode,
    onChangeNormalizeZoomOnTerminalClick,
    onChangeDefaultTerminalWindowScalePercent,
    onChangeTerminalFontSize,
    onChangeUiFontSize,
  } = props

  return (
    <div className="settings-panel__section" id="settings-section-canvas">
      <h3 className="settings-panel__section-title">{t('settingsPanel.canvas.title')}</h3>

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
          <span style={{ fontSize: '12px', color: '#666' }}>{t('common.percentUnit')}</span>
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
          <span style={{ fontSize: '12px', color: '#666' }}>{t('common.pixelUnit')}</span>
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
          <span style={{ fontSize: '12px', color: '#666' }}>{t('common.pixelUnit')}</span>
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
