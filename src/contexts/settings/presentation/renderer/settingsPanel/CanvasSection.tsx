import React from 'react'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import {
  VIEWPORT_TRANSITIONS,
  CANVAS_INPUT_MODES,
  CANVAS_WHEEL_BEHAVIORS,
  CANVAS_WHEEL_ZOOM_MODIFIERS,
  FOCUS_NODE_TARGET_ZOOM_STEP,
  MAX_FOCUS_NODE_TARGET_ZOOM,
  MIN_FOCUS_NODE_TARGET_ZOOM,
  type ViewportTransition,
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
import { RangeField } from './RangeField'

export function CanvasSection(props: {
  canvasInputMode: CanvasInputMode
  canvasWheelBehavior: CanvasWheelBehavior
  canvasWheelZoomModifier: CanvasWheelZoomModifier
  viewportTransition: ViewportTransition
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  archiveSpaceDeleteWorktreeByDefault: boolean
  archiveSpaceDeleteBranchByDefault: boolean
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeCanvasWheelBehavior: (behavior: CanvasWheelBehavior) => void
  onChangeCanvasWheelZoomModifier: (modifier: CanvasWheelZoomModifier) => void
  onChangeViewportTransition: (effect: ViewportTransition) => void
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
    viewportTransition,
    focusNodeOnClick,
    focusNodeTargetZoom,
    focusNodeUseVisibleCanvasCenter,
    archiveSpaceDeleteWorktreeByDefault,
    archiveSpaceDeleteBranchByDefault,
    onChangeCanvasInputMode,
    onChangeCanvasWheelBehavior,
    onChangeCanvasWheelZoomModifier,
    onChangeViewportTransition,
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
          <SettingRow
            label={t('settingsPanel.canvas.inputModeLabel')}
            description={t('settingsPanel.canvas.inputModeHelp')}
            control={
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
            }
          />

          <SettingRow
            label={t('settingsPanel.canvas.wheelBehaviorLabel')}
            description={t('settingsPanel.canvas.wheelBehaviorHelp')}
            control={
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
            }
          />

          {canvasWheelBehavior === 'pan' ? (
            <SettingRow
              label={t('settingsPanel.canvas.wheelZoomModifierLabel')}
              description={t('settingsPanel.canvas.wheelZoomModifierHelp', {
                modifier: wheelZoomModifierHelpLabel,
              })}
              control={
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
              }
            />
          ) : null}
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-canvas-node-focus"
        title={t('settingsPanel.groups.canvasWindows.nodeFocus')}
      >
        <SettingsGroupBody>
          <SettingRow
            id="settings-viewport-transition"
            label={t('settingsPanel.canvas.viewportTransitionLabel')}
            description={t('settingsPanel.canvas.viewportTransitionHelp')}
            control={
              <CoveSelect
                testId="settings-viewport-transition"
                value={viewportTransition}
                ariaLabel={t('settingsPanel.canvas.viewportTransitionLabel')}
                options={VIEWPORT_TRANSITIONS.map(value => ({
                  value,
                  label: t(`settingsPanel.canvas.viewportTransition.${value}`),
                }))}
                onChange={value => {
                  if (value === 'fly' || value === 'slide') {
                    onChangeViewportTransition(value)
                  }
                }}
              />
            }
          />
          <SettingRow
            id="settings-focus-node-on-click"
            label={t('settingsPanel.canvas.focusOnClickLabel')}
            description={t('settingsPanel.canvas.focusOnClickHelp')}
            control={
              <Toggle
                data-testid="settings-focus-node-on-click"
                checked={focusNodeOnClick}
                label={t('settingsPanel.canvas.focusOnClickLabel')}
                onCheckedChange={checked => onChangeFocusNodeOnClick(checked)}
              />
            }
          />

          <SettingRow
            label={t('settingsPanel.canvas.focusVisibleCenterLabel')}
            description={t('settingsPanel.canvas.focusVisibleCenterHelp')}
            control={
              <Toggle
                data-testid="settings-focus-node-visible-center"
                checked={focusNodeUseVisibleCanvasCenter}
                label={t('settingsPanel.canvas.focusVisibleCenterLabel')}
                onCheckedChange={checked => onChangeFocusNodeUseVisibleCanvasCenter(checked)}
              />
            }
          />

          <SettingRow
            className="settings-panel__row--focus-target-zoom"
            label={t('settingsPanel.canvas.focusTargetZoomLabel')}
            description={t('settingsPanel.canvas.focusTargetZoomHelp')}
            control={
              <RangeField
                neutralMarker
                wrapperStyle={focusTargetZoomRangeStyle}
                id="settings-focus-node-target-zoom"
                data-testid="settings-focus-node-target-zoom"
                value={focusNodeTargetZoom}
                disabled={!focusNodeOnClick}
                min={MIN_FOCUS_NODE_TARGET_ZOOM}
                max={MAX_FOCUS_NODE_TARGET_ZOOM}
                step={FOCUS_NODE_TARGET_ZOOM_STEP}
                onPointerDown={() => onFocusNodeTargetZoomPreviewChange(true)}
                onPointerUp={() => onFocusNodeTargetZoomPreviewChange(false)}
                onPointerCancel={() => onFocusNodeTargetZoomPreviewChange(false)}
                onBlur={() => onFocusNodeTargetZoomPreviewChange(false)}
                onChange={event => onChangeFocusNodeTargetZoom(Number(event.target.value))}
              />
            }
          />
        </SettingsGroupBody>
      </SettingsGroup>

      <SettingsGroup
        id="settings-section-space-archiving"
        title={t('settingsPanel.groups.canvasWindows.spaceArchiving')}
        description={t('settingsPanel.canvas.archiveSpaceDefaultsHelp')}
      >
        <SettingsGroupBody>
          <SettingRow
            data-testid="settings-archive-space-delete-worktree-default"
            label={t('settingsPanel.canvas.archiveSpaceDeleteWorktreeDefaultLabel')}
            control={
              <Toggle
                checked={archiveSpaceDeleteWorktreeByDefault}
                label={t('settingsPanel.canvas.archiveSpaceDeleteWorktreeDefaultLabel')}
                onCheckedChange={checked => onChangeArchiveSpaceDeleteWorktreeByDefault(checked)}
              />
            }
          />

          <SettingRow
            data-testid="settings-archive-space-delete-branch-default"
            label={t('settingsPanel.canvas.archiveSpaceDeleteBranchDefaultLabel')}
            control={
              <Toggle
                checked={archiveSpaceDeleteBranchByDefault}
                label={t('settingsPanel.canvas.archiveSpaceDeleteBranchDefaultLabel')}
                onCheckedChange={checked => onChangeArchiveSpaceDeleteBranchByDefault(checked)}
              />
            }
          />
        </SettingsGroupBody>
      </SettingsGroup>
    </>
  )
}
