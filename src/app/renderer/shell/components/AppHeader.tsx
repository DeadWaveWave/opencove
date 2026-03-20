import React, { useMemo } from 'react'
import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function AppHeader({
  activeWorkspaceName,
  activeWorkspacePath,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
}: {
  activeWorkspaceName: string | null
  activeWorkspacePath: string | null
  isSidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isMac = typeof window !== 'undefined' && window.opencoveApi?.meta?.platform === 'darwin'
  const ToggleIcon = useMemo(
    () => (isSidebarCollapsed ? PanelLeftOpen : PanelLeftClose),
    [isSidebarCollapsed],
  )

  return (
    <header className={`app-header ${isMac ? 'app-header--mac' : ''}`} role="banner">
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
        <span className="app-header__title">{activeWorkspaceName ?? 'OpenCove'}</span>
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
