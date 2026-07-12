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
} from '@contexts/settings/domain/agentSettings'
import {
  getCanvasInputModeLabel,
  getCanvasWheelBehaviorLabel,
  getCanvasWheelZoomModifierLabel,
} from '@app/renderer/i18n/labels'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  canvasWheelBehavior: CanvasWheelBehavior
  canvasWheelZoomModifier: CanvasWheelZoomModifier
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  archiveSpaceDeleteWorktreeByDefault: boolean
  archiveSpaceDeleteBranchByDefault: boolean
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeCanvasWheelBehavior: (behavior: CanvasWheelBehavior) => void
  onChangeCanvasWheelZoomModifier: (modifier: CanvasWheelZoomModifier) => void
  onChangeFocusNodeOnClick: (enabled: boolean) => void
  onChangeFocusNodeTargetZoom: (zoom: FocusNodeTargetZoom) => void
  onChangeFocusNodeUseVisibleCanvasCenter: (enabled: boolean) => void
  onChangeArchiveSpaceDeleteWorktreeByDefault: (enabled: boolean) => void
  onChangeArchiveSpaceDeleteBranchByDefault: (enabled: boolean) => void
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    canvasInputMode,
    canvasWheelBehavior,
    canvasWheelZoomModifier,
    focusNodeOnClick,
    focusNodeTargetZoom,
    focusNodeUseVisibleCanvasCenter,
    archiveSpaceDeleteWorktreeByDefault,
    archiveSpaceDeleteBranchByDefault,
    onChangeCanvasInputMode,
    onChangeCanvasWheelBehavior,
    onChangeCanvasWheelZoomModifier,
    onChangeFocusNodeOnClick,
    onChangeFocusNodeTargetZoom,
    onChangeFocusNodeUseVisibleCanvasCenter,
    onChangeArchiveSpaceDeleteWorktreeByDefault,
    onChangeArchiveSpaceDeleteBranchByDefault,
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
  return (
    <>
      <SettingsGroup
        id="settings-section-canvas"
        title={t('settingsPanel.groups.canvasWindows.canvasInput')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.canvas.inputModeLabel')}</strong>
              <span>{t('settingsPanel.canvas.inputModeHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <CoveSelect
                id="settings-canvas-input-mode"
                testId="settings-canvas-input-mode"
                ariaLabel={t('settingsPanel.canvas.inputModeLabel')}
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
                ariaLabel={t('settingsPanel.canvas.wheelBehaviorLabel')}
                value={canvasWheelBehavior}
                options={CANVAS_WHEEL_BEHAVIORS.map(behavior => ({
                  value: behavior,
                  label: getCanvasWheelBehaviorLabel(t, behavior),
                }))}
                onChange={nextValue =>
                  onChangeCanvasWheelBehavior(nextValue as CanvasWheelBehavior)
                }
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
                  ariaLabel={t('settingsPanel.canvas.wheelZoomModifierLabel')}
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
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-canvas-node-focus"
        title={t('settingsPanel.groups.canvasWindows.nodeFocus')}
      >
        <SettingsGroupBody>
          <div className="settings-panel__row" id="settings-focus-node-on-click">
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
                  aria-label={t('settingsPanel.canvas.focusOnClickLabel')}
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
                  aria-label={t('settingsPanel.canvas.focusVisibleCenterLabel')}
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
                  aria-label={t('settingsPanel.canvas.focusTargetZoomLabel')}
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
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-space-archiving"
        title={t('settingsPanel.groups.canvasWindows.spaceArchiving')}
        description={t('settingsPanel.canvas.archiveSpaceDefaultsHelp')}
      >
        <SettingsGroupBody>
          <div
            className="settings-panel__row"
            data-testid="settings-archive-space-delete-worktree-default"
          >
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.canvas.archiveSpaceDeleteWorktreeDefaultLabel')}</strong>
            </div>
            <div className="settings-panel__control">
              <label className="cove-toggle">
                <input
                  type="checkbox"
                  checked={archiveSpaceDeleteWorktreeByDefault}
                  aria-label={t('settingsPanel.canvas.archiveSpaceDeleteWorktreeDefaultLabel')}
                  onChange={event =>
                    onChangeArchiveSpaceDeleteWorktreeByDefault(event.target.checked)
                  }
                />
                <span className="cove-toggle__slider"></span>
              </label>
            </div>
          </div>

          <div
            className="settings-panel__row"
            data-testid="settings-archive-space-delete-branch-default"
          >
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.canvas.archiveSpaceDeleteBranchDefaultLabel')}</strong>
            </div>
            <div className="settings-panel__control">
              <label className="cove-toggle">
                <input
                  type="checkbox"
                  checked={archiveSpaceDeleteBranchByDefault}
                  aria-label={t('settingsPanel.canvas.archiveSpaceDeleteBranchDefaultLabel')}
                  onChange={event =>
                    onChangeArchiveSpaceDeleteBranchByDefault(event.target.checked)
                  }
                />
                <span className="cove-toggle__slider"></span>
              </label>
            </div>
          </div>
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
