import React, { useEffect, useId, useRef, useState } from 'react'
import {
  Bell,
  Check,
  ChevronRight,
  Map as MapIcon,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Button } from '@app/renderer/components/ui/Button'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { Popover } from '@app/renderer/components/ui/Popover'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { useTranslation } from '@app/renderer/i18n'
import { getUiThemeLabel } from '@app/renderer/i18n/labels'
import { UI_THEMES, type UiTheme } from '@contexts/settings/domain/agentSettings'
import {
  DEFAULT_UI_THEME,
  UI_THEME_DESCRIPTORS,
  type UiThemeBaseScheme,
} from '@contexts/settings/domain/uiSettings'
import { availablePluginThemes } from '@contexts/plugins/domain/pluginThemes'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { useThemeApplicationStatus } from '@contexts/plugins/presentation/renderer/themeApplication'

export function ControlCenter({
  isOpen,
  anchorRef,
  uiTheme,
  isMinimapVisible,
  isStandbyBannerEnabled,
  hasActiveWorkspace,
  onClose,
  onChangeUiTheme,
  onToggleMinimap,
  onToggleStandbyBanner,
  onOpenSettings,
}: {
  isOpen: boolean
  anchorRef: React.RefObject<HTMLButtonElement | null>
  uiTheme: UiTheme
  isMinimapVisible: boolean
  isStandbyBannerEnabled: boolean
  hasActiveWorkspace: boolean
  onClose: () => void
  onChangeUiTheme: (theme: UiTheme) => void
  onToggleMinimap: () => void
  onToggleStandbyBanner: () => void
  onOpenSettings: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { plugins } = usePluginRegistry()
  const applied = useThemeApplicationStatus()
  const pluginThemes = availablePluginThemes(plugins)
  const themeChoices: Array<{
    id: UiTheme
    title: string
    appearance: UiThemeBaseScheme
    preview: string
    pluginName?: string
    style?: React.CSSProperties
  }> = [
    ...UI_THEMES.map(id => ({
      id,
      title: getUiThemeLabel(t, id),
      appearance: UI_THEME_DESCRIPTORS[id].baseScheme,
      preview: id,
    })),
    ...pluginThemes.map(({ id, plugin, theme }) => ({
      id,
      title: theme.title,
      appearance: theme.appearance,
      preview: theme.extends ?? theme.appearance,
      pluginName: plugin.displayName,
      style:
        theme.tokens['--cove-app-background'] || theme.tokens['--cove-accent']
          ? ({
              '--cove-control-theme-surface': theme.tokens['--cove-app-background'],
              '--cove-control-theme-accent': theme.tokens['--cove-accent'],
            } as React.CSSProperties)
          : undefined,
    })),
  ]
  const selectedChoice = themeChoices.find(choice => choice.id === uiTheme)
  const isUnavailable = uiTheme.startsWith('plugin:') && !selectedChoice
  const hasLoadError = applied.requestedId === uiTheme && Boolean(applied.error)
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

      <div className="control-center__toggles">
        <label className="control-center__row" data-disabled={!hasActiveWorkspace ? '' : undefined}>
          <span className="control-center__row-icon" aria-hidden="true">
            <MapIcon />
          </span>
          <span className="control-center__row-label">{t('controlCenter.minimap')}</span>
          <Toggle
            ref={hasActiveWorkspace ? initialFocusRef : undefined}
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
            <Bell />
          </span>
          <span className="control-center__row-label">{t('controlCenter.agentStandbyBanner')}</span>
          <Toggle
            ref={hasActiveWorkspace ? undefined : initialFocusRef}
            checked={isStandbyBannerEnabled}
            label={t('controlCenter.agentStandbyBanner')}
            testId="control-center-toggle-agent-standby-banner"
            onCheckedChange={() => {
              onToggleStandbyBanner()
            }}
          />
        </label>
      </div>

      <section className="control-center__section" aria-labelledby={`${titleId}-theme`}>
        <div className="control-center__section-heading">
          <h3 id={`${titleId}-theme`} className="control-center__section-label">
            {t('controlCenter.theme')}
          </h3>
          <span
            className="control-center__current-theme"
            data-testid="control-center-current-theme"
          >
            {hasLoadError
              ? getUiThemeLabel(t, DEFAULT_UI_THEME)
              : (selectedChoice?.title ?? getUiThemeLabel(t, DEFAULT_UI_THEME))}
          </span>
        </div>
        <div
          className="control-center__themes"
          role="radiogroup"
          aria-labelledby={`${titleId}-theme`}
        >
          {themeChoices.map(theme => (
            <label
              key={theme.id}
              className="control-center__theme"
              data-theme-choice={theme.id}
              data-plugin-theme={theme.pluginName ? '' : undefined}
            >
              <input
                type="radio"
                name={`${titleId}-theme`}
                value={theme.id}
                checked={uiTheme === theme.id}
                data-testid={`control-center-theme-${theme.id}`}
                onChange={() => {
                  onChangeUiTheme(theme.id)
                }}
              />
              <span className="control-center__theme-option">
                <span
                  className="control-center__theme-preview"
                  data-theme-preview={theme.preview}
                  data-theme-scheme={theme.appearance}
                  style={theme.style}
                  data-theme-colors={theme.style ? '' : undefined}
                  aria-hidden="true"
                />
                <span className="control-center__theme-label">
                  {theme.title}
                  {theme.pluginName ? (
                    <span className="control-center__theme-source">{theme.pluginName}</span>
                  ) : null}
                </span>
                <Check size={14} className="control-center__theme-check" aria-hidden="true" />
              </span>
            </label>
          ))}
        </div>
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
          <span>{t('common.settings')}</span>
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
