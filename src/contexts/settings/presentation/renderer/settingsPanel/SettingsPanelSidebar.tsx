import { useMemo, useState, type JSX } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { getFolderName, getWorkspacePageId, type SettingsPageId } from '../SettingsPanel.shared'
import { SettingsPanelNavButton } from './SettingsPanelNavButton'
import {
  createSettingsSearchEntries,
  searchSettingsEntries,
  type SettingsSearchResult,
} from './settingsSearchIndex'

export function SettingsPanelSidebar({
  activePageId,
  workspaces,
  endpointsEnabled,
  onSelectPage,
  onSelectSearchResult,
}: {
  activePageId: SettingsPageId
  workspaces: WorkspaceState[]
  endpointsEnabled: boolean
  onSelectPage: (pageId: SettingsPageId) => void
  onSelectSearchResult: (result: SettingsSearchResult) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const searchEntries = useMemo(
    () => createSettingsSearchEntries({ t, workspaces, endpointsEnabled }),
    [endpointsEnabled, t, workspaces],
  )
  const searchResults = useMemo(
    () => searchSettingsEntries(searchEntries, searchQuery),
    [searchEntries, searchQuery],
  )
  const hasSearchQuery = searchQuery.trim().length > 0
  const visibleSearchResults = searchResults.slice(0, 8)
  const hasSecondaryActivePage =
    activePageId === 'endpoints' ||
    activePageId === 'diagnostics' ||
    activePageId === 'shortcuts' ||
    activePageId === 'quick-menu'
  const effectiveActivePageId = (() => {
    if (
      activePageId === 'quick-menu' ||
      activePageId === 'shortcuts' ||
      activePageId === 'task-configuration'
    ) {
      return 'tasks-shortcuts'
    }

    if (activePageId === 'experimental' || activePageId === 'diagnostics') {
      return 'advanced'
    }

    if (activePageId === 'endpoints') {
      return 'worker'
    }

    if (activePageId === 'canvas') {
      return 'canvas-windows'
    }

    return activePageId
  })()

  return (
    <aside className="settings-panel__sidebar" aria-label={t('settingsPanel.nav.sectionsLabel')}>
      <div className="settings-panel__search">
        <div className="settings-panel__search-input-shell">
          <Search className="settings-panel__search-icon" size={14} aria-hidden="true" />
          <input
            id="settings-panel-search"
            className="cove-field settings-panel__search-input"
            type="search"
            value={searchQuery}
            aria-label={t('settingsPanel.search.label')}
            placeholder={t('settingsPanel.search.placeholder')}
            data-testid="settings-panel-search"
            onChange={event => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {hasSearchQuery ? (
        <div className="settings-panel__search-results" data-testid="settings-panel-search-results">
          {visibleSearchResults.length > 0 ? (
            visibleSearchResults.map(result => (
              <button
                key={result.id}
                type="button"
                className="settings-panel__search-result"
                data-testid={`settings-panel-search-result-${result.id}`}
                onClick={() => onSelectSearchResult(result)}
              >
                <span className="settings-panel__search-result-title">{result.title}</span>
                <span className="settings-panel__search-result-page">{result.pageLabel}</span>
              </button>
            ))
          ) : (
            <div className="settings-panel__search-empty">
              {t('settingsPanel.search.noResults')}
            </div>
          )}
        </div>
      ) : null}

      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'general'}
        label={t('settingsPanel.nav.general')}
        testId="settings-section-nav-general"
        onClick={() => onSelectPage('general')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'appearance'}
        label={t('settingsPanel.nav.appearance')}
        testId="settings-section-nav-appearance"
        onClick={() => onSelectPage('appearance')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'canvas-windows'}
        label={t('settingsPanel.nav.canvasWindows')}
        testId="settings-section-nav-canvas"
        onClick={() => onSelectPage('canvas-windows')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'agent'}
        label={t('settingsPanel.nav.agent')}
        testId="settings-section-nav-agent"
        onClick={() => onSelectPage('agent')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'tasks-shortcuts'}
        isCurrent={!hasSecondaryActivePage}
        label={t('settingsPanel.nav.tasksShortcuts')}
        testId="settings-section-nav-task-configuration"
        onClick={() => onSelectPage('tasks-shortcuts')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'shortcuts'}
        label={t('settingsPanel.nav.shortcuts')}
        testId="settings-section-nav-shortcuts"
        tone="secondary"
        onClick={() => onSelectPage('shortcuts')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'quick-menu'}
        label={t('settingsPanel.nav.quickMenu')}
        testId="settings-section-nav-quick-menu"
        tone="secondary"
        onClick={() => onSelectPage('quick-menu')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'notifications'}
        label={t('settingsPanel.nav.notifications')}
        testId="settings-section-nav-notifications"
        onClick={() => onSelectPage('notifications')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'worker'}
        isCurrent={!hasSecondaryActivePage}
        label={t('settingsPanel.nav.workerConnections')}
        testId="settings-section-nav-worker"
        onClick={() => onSelectPage('worker')}
      />
      {endpointsEnabled ? (
        <SettingsPanelNavButton
          isActive={activePageId === 'endpoints'}
          label={t('settingsPanel.nav.endpoints')}
          testId="settings-section-nav-endpoints"
          tone="secondary"
          onClick={() => onSelectPage('endpoints')}
        />
      ) : null}
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'integrations'}
        label={t('settingsPanel.nav.integrations')}
        testId="settings-section-nav-integrations"
        onClick={() => onSelectPage('integrations')}
      />
      <SettingsPanelNavButton
        isActive={effectiveActivePageId === 'advanced'}
        isCurrent={!hasSecondaryActivePage}
        label={t('settingsPanel.nav.advanced')}
        testId="settings-section-nav-experimental"
        onClick={() => onSelectPage('advanced')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'diagnostics'}
        label={t('settingsPanel.nav.diagnostics')}
        testId="settings-section-nav-diagnostics"
        tone="secondary"
        onClick={() => onSelectPage('diagnostics')}
      />

      <div className="settings-panel__nav-group-label">{t('settingsPanel.nav.projects')}</div>
      <div className="settings-panel__nav-group">
        {workspaces.map(workspace => (
          <SettingsPanelNavButton
            key={workspace.id}
            isActive={activePageId === getWorkspacePageId(workspace.id)}
            label={
              workspace.name.trim().length > 0 ? workspace.name : getFolderName(workspace.path)
            }
            onClick={() => onSelectPage(getWorkspacePageId(workspace.id))}
          />
        ))}
      </div>
    </aside>
  )
}
