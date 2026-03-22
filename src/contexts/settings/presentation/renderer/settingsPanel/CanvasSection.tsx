import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_INPUT_MODES,
  FOCUS_NODE_TARGET_ZOOM_STEP,
  MAX_FOCUS_NODE_TARGET_ZOOM,
  MIN_FOCUS_NODE_TARGET_ZOOM,
  MAX_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  MIN_DEFAULT_TERMINAL_WINDOW_SCALE_PERCENT,
  type CanvasInputMode,
  type FocusNodeTargetZoom,
} from '@contexts/settings/domain/agentSettings'
import { getCanvasInputModeLabel } from '@app/renderer/i18n/labels'
import type { TerminalProfile } from '@shared/contracts/dto'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  defaultTerminalWindowScalePercent: number
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
  onChangeFocusNodeOnClick: (enabled: boolean) => void
  onChangeFocusNodeTargetZoom: (zoom: FocusNodeTargetZoom) => void
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
  onChangeDefaultTerminalWindowScalePercent: (percent: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    canvasInputMode,
    focusNodeOnClick,
    focusNodeTargetZoom,
    defaultTerminalWindowScalePercent,
    defaultTerminalProfileId,
    terminalProfiles,
    detectedDefaultTerminalProfileId,
    onChangeCanvasInputMode,
    onChangeDefaultTerminalProfileId,
    onChangeFocusNodeOnClick,
    onChangeFocusNodeTargetZoom,
    onFocusNodeTargetZoomPreviewChange,
    onChangeDefaultTerminalWindowScalePercent,
  } = props
  const neutralTargetZoom = 1
  const neutralTargetZoomRatioRaw =
    (neutralTargetZoom - MIN_FOCUS_NODE_TARGET_ZOOM) /
    (MAX_FOCUS_NODE_TARGET_ZOOM - MIN_FOCUS_NODE_TARGET_ZOOM)
  const neutralTargetZoomRatio = Number.isFinite(neutralTargetZoomRatioRaw)
    ? Math.max(0, Math.min(1, neutralTargetZoomRatioRaw))
    : 0.5
  const focusTargetZoomRangeStyle: React.CSSProperties & Record<string, string | number> = {
    '--settings-panel-range-neutral-ratio': neutralTargetZoomRatio,
  }
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
          <strong>{t('settingsPanel.canvas.focusOnClickLabel')}</strong>
          <span>{t('settingsPanel.canvas.focusOnClickHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-focus-node-on-click"
              checked={focusNodeOnClick}
              onChange={event => onChangeFocusNodeOnClick(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-panel__row settings-panel__row--focus-target-zoom">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.focusTargetZoomLabel')}</strong>
          <span>{t('settingsPanel.canvas.focusTargetZoomHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <div
            className="settings-panel__range settings-panel__range--neutral-marker"
            style={focusTargetZoomRangeStyle}
          >
            <input
              id="settings-focus-node-target-zoom"
              data-testid="settings-focus-node-target-zoom"
              value={focusNodeTargetZoom}
              disabled={!focusNodeOnClick}
              type="range"
              min={MIN_FOCUS_NODE_TARGET_ZOOM}
              max={MAX_FOCUS_NODE_TARGET_ZOOM}
              step={FOCUS_NODE_TARGET_ZOOM_STEP}
              onPointerDown={() => onFocusNodeTargetZoomPreviewChange(true)}
              onPointerUp={() => onFocusNodeTargetZoomPreviewChange(false)}
              onPointerCancel={() => onFocusNodeTargetZoomPreviewChange(false)}
              onBlur={() => onFocusNodeTargetZoomPreviewChange(false)}
              onChange={event => onChangeFocusNodeTargetZoom(Number(event.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
