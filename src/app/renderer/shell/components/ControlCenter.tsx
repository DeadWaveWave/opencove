import React, { useEffect, useId, useRef, useState } from 'react'
import {
  ChevronRightIcon,
  CloseIcon,
  Grid3x3Icon,
  MapIcon,
  SettingsIcon,
  ShowcaseIcon,
  SlidersIcon,
  SparklesIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { Button } from '@app/renderer/components/ui/Button'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { Popover } from '@app/renderer/components/ui/Popover'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_BACKGROUND_STYLES,
  type CanvasBackgroundStyle,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import {
  WINDOW_MATERIALS,
  type WindowMaterial,
} from '@contexts/settings/domain/agentSettings.types'
import { useSystemReducedTransparency } from '../hooks/useReducedTransparency'
import { setShowcaseMode, useShowcaseMode } from '../showcase/showcaseMode'
import type { UiThemeFamily } from '@contexts/settings/domain/uiSettings'
import {
  describeUiThemeChoice,
  resolveUiThemeChoice,
  uiThemeModesFor,
  type UiThemeMode,
} from '@contexts/settings/domain/uiThemeChoice'
import { availablePluginThemes } from '@contexts/plugins/domain/pluginThemes'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { useThemeApplicationStatus } from '@contexts/plugins/presentation/renderer/themeApplication'

const UI_THEME_FAMILIES: UiThemeFamily[] = ['cove', 'pixel']

export function ControlCenter({
  isOpen,
  anchorRef,
  uiTheme,
  isMinimapVisible,
  backgroundStyle,
  isBackgroundTwinkleEnabled,
  areMotionSignalsEnabled,
  hasActiveWorkspace,
  windowMaterial,
  settingsShortcut,
  onClose,
  onChangeUiTheme,
  onChangeWindowMaterial,
  onToggleMinimap,
  onChangeBackgroundStyle,
  onChangeBackgroundTwinkle,
  onChangeMotionSignals,
  onOpenSettings,
}: {
  isOpen: boolean
  anchorRef: React.RefObject<HTMLButtonElement | null>
  uiTheme: UiTheme
  isMinimapVisible: boolean
  backgroundStyle: CanvasBackgroundStyle
  isBackgroundTwinkleEnabled: boolean
  /** On when every pixel signal (creation, close, working) is on. */
  areMotionSignalsEnabled: boolean
  hasActiveWorkspace: boolean
  windowMaterial: WindowMaterial
  /** The current Open Settings shortcut, shown beside "All settings". */
  settingsShortcut: string | null
  onClose: () => void
  onChangeUiTheme: (theme: UiTheme) => void
  onChangeWindowMaterial: (material: WindowMaterial) => void
  onToggleMinimap: () => void
  onChangeBackgroundStyle: (style: CanvasBackgroundStyle) => void
  onChangeBackgroundTwinkle: (enabled: boolean) => void
  onChangeMotionSignals: (enabled: boolean) => void
  onOpenSettings: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { plugins } = usePluginRegistry()
  const applied = useThemeApplicationStatus()
  const pluginTheme = availablePluginThemes(plugins).find(choice => choice.id === uiTheme)
  const isUnavailable = uiTheme.startsWith('plugin:') && !pluginTheme
  const hasLoadError = applied.requestedId === uiTheme && Boolean(applied.error)
  const choice = describeUiThemeChoice(uiTheme)
  const systemReducesTransparency = useSystemReducedTransparency()
  const showcase = useShowcaseMode()
  const isCompact = useCompactViewport()
  const titleId = useId()
  const initialFocusRef = useRef<HTMLInputElement | null>(null)
  const [returnFocusOnClose, setReturnFocusOnClose] = useState(true)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setReturnFocusOnClose(true)
    if (isCompact) {
      return
    }
    const focusTimer = window.setTimeout(() => {
      initialFocusRef.current?.focus({ preventScroll: true })
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
    }
  }, [isCompact, isOpen])

  const prefersDark = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  // A plugin theme has no mode here; switching family keeps what the window shows now.
  const currentMode =
    choice.mode ?? (document.documentElement.dataset.coveTheme === 'light' ? 'light' : 'dark')
  const modeLabels: Record<UiThemeMode, string> = {
    light: t('settingsPanel.appearanceNext.light'),
    dark: t('settingsPanel.appearanceNext.dark'),
    system: t('settingsPanel.appearanceNext.system'),
  }

  const content = (
    <>
      <header className="control-center__header">
        <SlidersIcon size={18} />
        <h2 id={titleId} className="control-center__title">
          {t('controlCenter.title')}
        </h2>
        <IconButton
          className="control-center__close"
          label={t('common.close')}
          data-testid="control-center-close"
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </IconButton>
      </header>

      <section className="control-center__section" aria-labelledby={`${titleId}-mode`}>
        <h3 id={`${titleId}-mode`} className="control-center__section-label">
          {t('controlCenter.mode')}
        </h3>
        <SegmentedControl
          className="control-center__segments"
          labelledBy={`${titleId}-mode`}
          testId="control-center-theme-mode"
          disabled={choice.family === null}
          value={choice.mode ?? ''}
          options={uiThemeModesFor(choice.family ?? 'cove').map(mode => ({
            value: mode,
            label: modeLabels[mode],
            testId: `control-center-theme-mode-${mode}`,
          }))}
          onValueChange={mode => {
            if (mode !== '' && choice.family) {
              onChangeUiTheme(resolveUiThemeChoice(choice.family, mode, prefersDark()))
            }
          }}
        />
      </section>

      <section className="control-center__section" aria-labelledby={`${titleId}-theme`}>
        <div className="control-center__section-heading">
          <h3 id={`${titleId}-theme`} className="control-center__section-label">
            {t('controlCenter.theme')}
          </h3>
          {pluginTheme && !hasLoadError ? (
            <span
              className="control-center__current-theme"
              data-testid="control-center-current-theme"
            >
              {pluginTheme.theme.title}
            </span>
          ) : null}
        </div>
        <SegmentedControl
          className="control-center__segments"
          labelledBy={`${titleId}-theme`}
          testId="control-center-theme-family"
          value={choice.family ?? ''}
          options={UI_THEME_FAMILIES.map(family => ({
            value: family,
            label:
              family === 'pixel' ? t('controlCenter.familyPixel') : t('controlCenter.familyCove'),
            testId: `control-center-theme-family-${family}`,
          }))}
          onValueChange={family => {
            if (family !== '') {
              onChangeUiTheme(resolveUiThemeChoice(family, currentMode, prefersDark()))
            }
          }}
        />
        {isUnavailable || hasLoadError ? (
          <p className="control-center__theme-status" role="status">
            {t(
              hasLoadError
                ? 'pluginHostExtensions.themeLoadFailed'
                : 'pluginHostExtensions.unavailableTheme',
            )}
          </p>
        ) : null}
      </section>

      <section className="control-center__section" aria-labelledby={`${titleId}-material`}>
        <h3 id={`${titleId}-material`} className="control-center__section-label">
          {t('controlCenter.windowMaterial')}
        </h3>
        <SegmentedControl
          className="control-center__segments"
          labelledBy={`${titleId}-material`}
          testId="control-center-window-material"
          value={systemReducesTransparency ? 'solid' : windowMaterial}
          options={WINDOW_MATERIALS.map(material => ({
            value: material,
            label: t(`settingsPanel.appearanceNext.windowMaterial_${material}`),
            testId: `control-center-window-material-${material}`,
            disabled: systemReducesTransparency && material === 'glass',
          }))}
          onValueChange={onChangeWindowMaterial}
        />
      </section>

      <section className="control-center__section" aria-labelledby={`${titleId}-background`}>
        <h3 id={`${titleId}-background`} className="control-center__section-label">
          {t('controlCenter.background')}
        </h3>
        <SegmentedControl
          className="control-center__segments"
          labelledBy={`${titleId}-background`}
          testId="control-center-background-style"
          value={backgroundStyle}
          options={CANVAS_BACKGROUND_STYLES.map(style => ({
            value: style,
            label: t(`controlCenter.backgroundStyle_${style}`),
            testId: `control-center-background-style-${style}`,
          }))}
          onValueChange={onChangeBackgroundStyle}
        />
      </section>

      <div className="control-center__toggles">
        <label
          className="control-center__row"
          data-disabled={backgroundStyle !== 'pixel' ? '' : undefined}
        >
          <span className="control-center__row-icon" aria-hidden="true">
            <Grid3x3Icon />
          </span>
          <span className="control-center__row-label">{t('controlCenter.backgroundTwinkle')}</span>
          <Toggle
            // First focus lands on the first switch that can change.
            ref={backgroundStyle === 'pixel' ? initialFocusRef : undefined}
            checked={isBackgroundTwinkleEnabled}
            disabled={backgroundStyle !== 'pixel'}
            label={t('controlCenter.backgroundTwinkle')}
            testId="control-center-toggle-background-twinkle"
            onCheckedChange={onChangeBackgroundTwinkle}
          />
        </label>
        <label className="control-center__row">
          <span className="control-center__row-icon" aria-hidden="true">
            <SparklesIcon />
          </span>
          <span className="control-center__row-label">{t('controlCenter.motionSignals')}</span>
          <Toggle
            ref={backgroundStyle === 'pixel' ? undefined : initialFocusRef}
            checked={areMotionSignalsEnabled}
            label={t('controlCenter.motionSignals')}
            testId="control-center-toggle-motion-signals"
            onCheckedChange={onChangeMotionSignals}
          />
        </label>
        <label className="control-center__row" data-disabled={!hasActiveWorkspace ? '' : undefined}>
          <span className="control-center__row-icon" aria-hidden="true">
            <MapIcon />
          </span>
          <span className="control-center__row-label">{t('controlCenter.minimap')}</span>
          <Toggle
            checked={isMinimapVisible}
            disabled={!hasActiveWorkspace}
            label={t('controlCenter.minimap')}
            testId="control-center-toggle-minimap"
            onCheckedChange={() => {
              onToggleMinimap()
            }}
          />
        </label>
        <label className="control-center__row">
          <span className="control-center__row-icon" aria-hidden="true">
            <ShowcaseIcon />
          </span>
          <span className="control-center__row-label">{t('controlCenter.showcase')}</span>
          <Toggle
            checked={showcase}
            label={t('controlCenter.showcase')}
            testId="control-center-toggle-showcase"
            onCheckedChange={checked => {
              setShowcaseMode(checked)
              // The top bar hides with the panel's anchor; Esc or the command center leaves.
              if (checked) {
                onClose()
              }
            }}
          />
        </label>
      </div>

      <footer className="control-center__footer">
        <Button
          variant="ghost"
          size="sm"
          className="control-center__settings"
          data-testid="control-center-open-settings"
          onClick={() => {
            setReturnFocusOnClose(false)
            onOpenSettings()
            onClose()
          }}
        >
          <SettingsIcon />
          <span>{t('controlCenter.moreSettings')}</span>
          {settingsShortcut ? (
            <kbd className="control-center__settings-shortcut" aria-hidden="true">
              {settingsShortcut}
            </kbd>
          ) : (
            <ChevronRightIcon className="control-center__settings-chevron" />
          )}
        </Button>
      </footer>
    </>
  )

  const surfaceProps = {
    open: isOpen,
    returnFocus: returnFocusOnClose ? anchorRef : (false as const),
    'aria-labelledby': titleId,
    'data-testid': 'control-center',
    onDismiss: onClose,
  }

  return isCompact ? (
    <Dialog
      {...surfaceProps}
      className="control-center control-center--sheet"
      backdropClassName="control-center-backdrop"
      backdropTestId="control-center-backdrop"
      initialFocusRef={initialFocusRef}
      inertRootSelector=".app-shell"
    >
      {content}
    </Dialog>
  ) : (
    <Popover
      {...surfaceProps}
      anchorRef={anchorRef}
      side="bottom"
      align="end"
      offset={8}
      className="control-center"
      role="dialog"
    >
      {content}
    </Popover>
  )
}
