import React, { useEffect, useId, useRef, useState } from 'react'
import {
  ChevronRight,
  Grid3x3,
  Map as MapIcon,
  Settings,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@app/renderer/components/ui/Button'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { Popover } from '@app/renderer/components/ui/Popover'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { useTranslation } from '@app/renderer/i18n'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
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
  isPixelBackgroundEnabled,
  areMotionSignalsEnabled,
  hasActiveWorkspace,
  onClose,
  onChangeUiTheme,
  onToggleMinimap,
  onChangePixelBackground,
  onChangeMotionSignals,
  onOpenSettings,
}: {
  isOpen: boolean
  anchorRef: React.RefObject<HTMLButtonElement | null>
  uiTheme: UiTheme
  isMinimapVisible: boolean
  isPixelBackgroundEnabled: boolean
  /** On when every pixel signal (creation, close, working) is on. */
  areMotionSignalsEnabled: boolean
  hasActiveWorkspace: boolean
  onClose: () => void
  onChangeUiTheme: (theme: UiTheme) => void
  onToggleMinimap: () => void
  onChangePixelBackground: (enabled: boolean) => void
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
        <SlidersHorizontal size={16} aria-hidden="true" />
        <h2 id={titleId} className="control-center__title">
          {t('controlCenter.title')}
        </h2>
        <IconButton
          className="control-center__close"
          label={t('common.close')}
          data-testid="control-center-close"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </header>

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
        <SegmentedControl
          className="control-center__segments"
          label={t('controlCenter.mode')}
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

      <div className="control-center__toggles">
        <label className="control-center__row">
          <span className="control-center__row-icon" aria-hidden="true">
            <Grid3x3 />
          </span>
          <span className="control-center__row-label">{t('controlCenter.pixelBackground')}</span>
          <Toggle
            ref={initialFocusRef}
            checked={isPixelBackgroundEnabled}
            label={t('controlCenter.pixelBackground')}
            testId="control-center-toggle-pixel-background"
            onCheckedChange={onChangePixelBackground}
          />
        </label>
        <label className="control-center__row">
          <span className="control-center__row-icon" aria-hidden="true">
            <Sparkles />
          </span>
          <span className="control-center__row-label">{t('controlCenter.motionSignals')}</span>
          <Toggle
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
          <Settings aria-hidden="true" />
          <span>{t('controlCenter.moreSettings')}</span>
          <ChevronRight className="control-center__settings-chevron" aria-hidden="true" />
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
