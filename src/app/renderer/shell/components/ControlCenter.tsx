import React, { useEffect, useMemo, useRef } from 'react'
import { Bell, Map as MapIcon, Monitor, Moon, PanelLeft, Settings, Sun } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
import { getUiThemeLabel } from '@app/renderer/i18n/labels'

export function ControlCenter({
  isOpen,
  uiTheme,
  isPrimarySidebarCollapsed,
  isMinimapVisible,
  isStandbyBannerEnabled,
  hasActiveWorkspace,
  onClose,
  onChangeUiTheme,
  onTogglePrimarySidebar,
  onToggleMinimap,
  onToggleStandbyBanner,
  onOpenSettings,
}: {
  isOpen: boolean
  uiTheme: UiTheme
  isPrimarySidebarCollapsed: boolean
  isMinimapVisible: boolean
  isStandbyBannerEnabled: boolean
  hasActiveWorkspace: boolean
  onClose: () => void
  onChangeUiTheme: (theme: UiTheme) => void
  onTogglePrimarySidebar: () => void
  onToggleMinimap: () => void
  onToggleStandbyBanner: () => void
  onOpenSettings: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const initialFocusRef = useRef<HTMLButtonElement | null>(null)

  const themeOptions = useMemo(
    () => [
      { value: 'system' as const, icon: Monitor },
      { value: 'light' as const, icon: Sun },
      { value: 'dark' as const, icon: Moon },
    ],
    [],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    window.setTimeout(() => {
      initialFocusRef.current?.focus()
    }, 0)

    return () => {
      const focusTarget = restoreFocusRef.current
      restoreFocusRef.current = null
      if (focusTarget && document.contains(focusTarget)) {
        window.setTimeout(() => {
          focusTarget.focus()
        }, 0)
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="control-center-backdrop"
      data-testid="control-center-backdrop"
      onMouseDown={event => {
        event.preventDefault()
        onClose()
      }}
    >
      <section
        className="control-center"
        role="dialog"
        aria-modal="true"
        aria-label={t('controlCenter.title')}
        data-testid="control-center"
        onMouseDown={event => {
          event.stopPropagation()
        }}
      >
        <header className="control-center__header">
          <span className="control-center__title">{t('controlCenter.title')}</span>
        </header>

        <div className="control-center__tiles">
          <button
            type="button"
            ref={initialFocusRef}
            className={`control-center-tile${!isPrimarySidebarCollapsed ? ' control-center-tile--on' : ''}`}
            data-testid="control-center-toggle-sidebar"
            onClick={() => {
              onTogglePrimarySidebar()
            }}
          >
            <span className="control-center-tile__icon" aria-hidden="true">
              <PanelLeft size={18} />
            </span>
            <span className="control-center-tile__text">
              <span className="control-center-tile__label">{t('controlCenter.sidebar')}</span>
              <span className="control-center-tile__subtitle">
                {isPrimarySidebarCollapsed
                  ? t('commandCenter.commands.showPrimarySidebar')
                  : t('commandCenter.commands.hidePrimarySidebar')}
              </span>
            </span>
          </button>

          <button
            type="button"
            className={`control-center-tile${isMinimapVisible ? ' control-center-tile--on' : ''}`}
            data-testid="control-center-toggle-minimap"
            disabled={!hasActiveWorkspace}
            onClick={() => {
              onToggleMinimap()
            }}
          >
            <span className="control-center-tile__icon" aria-hidden="true">
              <MapIcon size={18} />
            </span>
            <span className="control-center-tile__text">
              <span className="control-center-tile__label">{t('controlCenter.minimap')}</span>
              <span className="control-center-tile__subtitle">
                {isMinimapVisible
                  ? t('workspaceCanvas.hideMinimap')
                  : t('workspaceCanvas.showMinimap')}
              </span>
            </span>
          </button>

          <button
            type="button"
            className={`control-center-tile${isStandbyBannerEnabled ? ' control-center-tile--on' : ''}`}
            data-testid="control-center-toggle-agent-standby-banner"
            onClick={() => {
              onToggleStandbyBanner()
            }}
          >
            <span className="control-center-tile__icon" aria-hidden="true">
              <Bell size={18} />
            </span>
            <span className="control-center-tile__text">
              <span className="control-center-tile__label">
                {t('controlCenter.agentStandbyBanner')}
              </span>
              <span className="control-center-tile__subtitle">
                {isStandbyBannerEnabled ? t('controlCenter.on') : t('controlCenter.off')}
              </span>
            </span>
          </button>
        </div>

        <div className="control-center__section">
          <div className="control-center__section-label">{t('controlCenter.theme')}</div>
          <div
            className="control-center__segmented"
            role="group"
            aria-label={t('controlCenter.theme')}
          >
            {themeOptions.map(option => {
              const Icon = option.icon
              const isSelected = uiTheme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`control-center__segment${isSelected ? ' control-center__segment--selected' : ''}`}
                  data-testid={`control-center-theme-${option.value}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onChangeUiTheme(option.value)
                  }}
                >
                  <Icon aria-hidden="true" size={16} />
                  <span>{getUiThemeLabel(t, option.value)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          className="control-center__settings"
          data-testid="control-center-open-settings"
          onClick={() => {
            onOpenSettings()
            onClose()
          }}
        >
          <Settings aria-hidden="true" size={16} />
          <span>{t('common.settings')}</span>
        </button>
      </section>
    </div>
  )
}
