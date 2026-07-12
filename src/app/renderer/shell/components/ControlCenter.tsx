import React, { useEffect, useId, useRef, useState } from 'react'
import { Bell, ChevronRight, Map as MapIcon, Settings } from 'lucide-react'
import { Button } from '@app/renderer/components/ui/Button'
import { Popover } from '@app/renderer/components/ui/Popover'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import { getUiThemeLabel } from '@app/renderer/i18n/labels'
import { UI_THEMES, type UiTheme } from '@contexts/settings/domain/agentSettings'

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
  const titleId = useId()
  const initialFocusRef = useRef<HTMLInputElement | null>(null)
  const [returnFocusOnClose, setReturnFocusOnClose] = useState(true)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setReturnFocusOnClose(true)
    const focusTimer = window.setTimeout(() => {
      initialFocusRef.current?.focus({ preventScroll: true })
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
    }
  }, [isOpen])

  return (
    <Popover
      open={isOpen}
      anchorRef={anchorRef}
      returnFocus={returnFocusOnClose ? anchorRef : false}
      side="bottom"
      align="end"
      offset={8}
      className="control-center"
      role="dialog"
      aria-labelledby={titleId}
      data-testid="control-center"
      onDismiss={() => {
        onClose()
      }}
    >
      <header className="control-center__header">
        <h2 id={titleId} className="control-center__title">
          {t('controlCenter.title')}
        </h2>
        <span className="control-center__header-meta">{t('controlCenter.quickSettings')}</span>
      </header>

      <div className="control-center__toggles">
        <label className="control-center__row" data-disabled={!hasActiveWorkspace ? '' : undefined}>
          <span className="control-center__row-icon" aria-hidden="true">
            <MapIcon />
          </span>
          <span className="control-center__row-copy">
            <span className="control-center__row-label">{t('controlCenter.minimap')}</span>
            <span className="control-center__row-status">
              {isMinimapVisible ? t('controlCenter.shown') : t('controlCenter.hidden')}
            </span>
          </span>
          <Toggle
            ref={initialFocusRef}
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
          <span className="control-center__row-copy">
            <span className="control-center__row-label">
              {t('controlCenter.agentStandbyBanner')}
            </span>
            <span className="control-center__row-status">
              {isStandbyBannerEnabled ? t('controlCenter.on') : t('controlCenter.off')}
            </span>
          </span>
          <Toggle
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
            {getUiThemeLabel(t, uiTheme)}
          </span>
        </div>
        <div className="control-center__themes" role="radiogroup">
          {UI_THEMES.map(theme => (
            <label key={theme} className="control-center__theme">
              <input
                type="radio"
                name="control-center-theme"
                value={theme}
                checked={uiTheme === theme}
                data-testid={`control-center-theme-${theme}`}
                onChange={() => {
                  onChangeUiTheme(theme)
                }}
              />
              <span className="control-center__theme-card">
                <span
                  className="control-center__theme-preview"
                  data-theme-preview={theme}
                  aria-hidden="true"
                />
                <span className="control-center__theme-label">{getUiThemeLabel(t, theme)}</span>
              </span>
            </label>
          ))}
        </div>
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
    </Popover>
  )
}
