import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_INPUT_MODES,
  CANVAS_WHEEL_BEHAVIORS,
  CANVAS_WHEEL_ZOOM_MODIFIERS,
  FOCUS_NODE_TARGET_ZOOM_STEP,
  MAX_FOCUS_NODE_TARGET_ZOOM,
  MIN_FOCUS_NODE_TARGET_ZOOM,
  type CanvasInputMode,
  type CanvasWheelBehavior,
  type CanvasWheelZoomModifier,
  type FocusNodeTargetZoom,
  STANDARD_WINDOW_SIZE_BUCKETS,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import {
  getCanvasInputModeLabel,
  getCanvasWheelBehaviorLabel,
  getCanvasWheelZoomModifierLabel,
  getStandardWindowSizeBucketLabel,
} from '@app/renderer/i18n/labels'
import type { TerminalProfile } from '@shared/contracts/dto'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  canvasWheelBehavior: CanvasWheelBehavior
  canvasWheelZoomModifier: CanvasWheelZoomModifier
  standardWindowSizeBucket: StandardWindowSizeBucket
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeCanvasWheelBehavior: (behavior: CanvasWheelBehavior) => void
  onChangeCanvasWheelZoomModifier: (modifier: CanvasWheelZoomModifier) => void
  onChangeStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
  onChangeFocusNodeOnClick: (enabled: boolean) => void
  onChangeFocusNodeTargetZoom: (zoom: FocusNodeTargetZoom) => void
  onChangeFocusNodeUseVisibleCanvasCenter: (enabled: boolean) => void
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    canvasInputMode,
    canvasWheelBehavior,
    canvasWheelZoomModifier,
    standardWindowSizeBucket,
    focusNodeOnClick,
    focusNodeTargetZoom,
    focusNodeUseVisibleCanvasCenter,
    defaultTerminalProfileId,
    terminalProfiles,
    detectedDefaultTerminalProfileId,
    onChangeCanvasInputMode,
    onChangeCanvasWheelBehavior,
    onChangeCanvasWheelZoomModifier,
    onChangeStandardWindowSizeBucket,
    onChangeDefaultTerminalProfileId,
    onChangeFocusNodeOnClick,
    onChangeFocusNodeTargetZoom,
    onChangeFocusNodeUseVisibleCanvasCenter,
    onFocusNodeTargetZoomPreviewChange,
  } = props
  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined
  const isMac = platform === 'darwin'
  const wheelZoomModifierHelpLabel = (() => {
    switch (canvasWheelZoomModifier) {
      case 'primary':
        return isMac ? 'Cmd' : 'Ctrl'
      case 'ctrl':
        return 'Ctrl'
      case 'alt':
        return isMac ? 'Option' : 'Alt'
    }
  })()
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

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.wheelBehaviorLabel')}</strong>
          <span>{t('settingsPanel.canvas.wheelBehaviorHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-canvas-wheel-behavior"
            testId="settings-canvas-wheel-behavior"
            value={canvasWheelBehavior}
            options={CANVAS_WHEEL_BEHAVIORS.map(behavior => ({
              value: behavior,
              label: getCanvasWheelBehaviorLabel(t, behavior),
            }))}
            onChange={nextValue => onChangeCanvasWheelBehavior(nextValue as CanvasWheelBehavior)}
          />
        </div>
      </div>

      {canvasWheelBehavior === 'pan' ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.canvas.wheelZoomModifierLabel')}</strong>
            <span>
              {t('settingsPanel.canvas.wheelZoomModifierHelp', {
                modifier: wheelZoomModifierHelpLabel,
              })}
            </span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-canvas-wheel-zoom-modifier"
              testId="settings-canvas-wheel-zoom-modifier"
              value={canvasWheelZoomModifier}
              options={CANVAS_WHEEL_ZOOM_MODIFIERS.filter(modifier =>
                modifier === 'ctrl' ? isMac : true,
              ).map(modifier => ({
                value: modifier,
                label: getCanvasWheelZoomModifierLabel(t, modifier, platform),
              }))}
              onChange={nextValue =>
                onChangeCanvasWheelZoomModifier(nextValue as CanvasWheelZoomModifier)
              }
            />
          </div>
        </div>
      ) : null}

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.standardWindowSizeLabel')}</strong>
          <span>{t('settingsPanel.canvas.standardWindowSizeHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <CoveSelect
            id="settings-standard-window-size"
            testId="settings-standard-window-size"
            value={standardWindowSizeBucket}
            options={STANDARD_WINDOW_SIZE_BUCKETS.map(bucket => ({
              value: bucket,
              label: getStandardWindowSizeBucketLabel(t, bucket),
            }))}
            onChange={nextValue =>
              onChangeStandardWindowSizeBucket(nextValue as StandardWindowSizeBucket)
            }
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

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.canvas.focusVisibleCenterLabel')}</strong>
          <span>{t('settingsPanel.canvas.focusVisibleCenterHelp')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-focus-node-visible-center"
              checked={focusNodeUseVisibleCanvasCenter}
              onChange={event => onChangeFocusNodeUseVisibleCanvasCenter(event.target.checked)}
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
