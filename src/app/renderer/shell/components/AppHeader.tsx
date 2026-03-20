import React, { useMemo } from 'react'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Search, Settings } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function AppHeader({
  activeWorkspaceName,
  activeWorkspacePath,
  isSidebarCollapsed,
  isCommandCenterOpen,
  onToggleSidebar,
  onToggleCommandCenter,
  onOpenSettings,
}: {
  activeWorkspaceName: string | null
  activeWorkspacePath: string | null
  isSidebarCollapsed: boolean
  isCommandCenterOpen: boolean
  onToggleSidebar: () => void
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isMac = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'darwin'
  const isWindows = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'win32'
  const commandCenterPrimaryHint = isMac ? '⌘K' : 'Ctrl K'
  const commandCenterSecondaryHint = isMac ? '⌘P' : 'Ctrl P'
  const ToggleIcon = useMemo(
    () => (isSidebarCollapsed ? PanelLeftOpen : PanelLeftClose),
    [isSidebarCollapsed],
  )

  return (
    <header
      className={`app-header ${isMac ? 'app-header--mac' : ''} ${isWindows ? 'app-header--windows' : ''}`.trim()}
      role="banner"
    >
      <div className="app-header__section app-header__section--left">
        <button
          type="button"
          className="app-header__icon-button"
          data-testid="app-header-toggle-primary-sidebar"
          aria-label={t('appHeader.togglePrimarySidebar')}
          aria-pressed={!isSidebarCollapsed}
          title={t('appHeader.togglePrimarySidebar')}
          onClick={() => {
            onToggleSidebar()
          }}
        >
          <ToggleIcon aria-hidden="true" size={18} />
        </button>
      </div>

      <div
        className="app-header__center"
        title={activeWorkspacePath ?? undefined}
        aria-label={activeWorkspacePath ?? undefined}
      >
        <button
          type="button"
          className={`app-header__command-center ${isCommandCenterOpen ? 'app-header__command-center--open' : ''}`}
          data-testid="app-header-command-center"
          aria-haspopup="dialog"
          aria-expanded={isCommandCenterOpen}
          aria-label={t('appHeader.commandCenter')}
          title={t('appHeader.commandCenterHint', {
            primary: commandCenterPrimaryHint,
            secondary: commandCenterSecondaryHint,
          })}
          onClick={() => {
            onToggleCommandCenter()
          }}
        >
          <Search aria-hidden="true" size={16} className="app-header__command-center-icon" />
          <span className="app-header__command-center-title">
            {activeWorkspaceName ?? t('appHeader.commandCenterFallbackTitle')}
          </span>
          <span className="app-header__command-center-keycap" aria-hidden="true">
            {commandCenterPrimaryHint}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className="app-header__command-center-chevron"
          />
        </button>
      </div>

      <div className="app-header__section app-header__section--right">
        <button
          type="button"
          className="app-header__icon-button"
          data-testid="app-header-settings"
          aria-label={t('common.settings')}
          title={t('common.settings')}
          onClick={() => {
            onOpenSettings()
          }}
        >
          <Settings aria-hidden="true" size={18} />
        </button>
      </div>
    </header>
  )
}
