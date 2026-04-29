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
        isActive={activePageId === 'general'}
        label={t('settingsPanel.nav.general')}
        testId="settings-section-nav-general"
        onClick={() => onSelectPage('general')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'worker'}
        label={t('settingsPanel.nav.worker')}
        testId="settings-section-nav-worker"
        onClick={() => onSelectPage('worker')}
      />
      {endpointsEnabled ? (
        <SettingsPanelNavButton
          isActive={activePageId === 'endpoints'}
          label={t('settingsPanel.nav.endpoints')}
          testId="settings-section-nav-endpoints"
          onClick={() => onSelectPage('endpoints')}
        />
      ) : null}
      <SettingsPanelNavButton
        isActive={activePageId === 'agent'}
        label={t('settingsPanel.nav.agent')}
        testId="settings-section-nav-agent"
        onClick={() => onSelectPage('agent')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'notifications'}
        label={t('settingsPanel.nav.notifications')}
        testId="settings-section-nav-notifications"
        onClick={() => onSelectPage('notifications')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'canvas'}
        label={t('settingsPanel.nav.canvas')}
        testId="settings-section-nav-canvas"
        onClick={() => onSelectPage('canvas')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'shortcuts'}
        label={t('settingsPanel.nav.shortcuts')}
        testId="settings-section-nav-shortcuts"
        onClick={() => onSelectPage('shortcuts')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'quick-menu'}
        label={t('settingsPanel.nav.quickMenu')}
        testId="settings-section-nav-quick-menu"
        onClick={() => onSelectPage('quick-menu')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'task-configuration'}
        label={t('settingsPanel.nav.tasks')}
        testId="settings-section-nav-task-configuration"
        onClick={() => onSelectPage('task-configuration')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'integrations'}
        label={t('settingsPanel.nav.integrations')}
        testId="settings-section-nav-integrations"
        onClick={() => onSelectPage('integrations')}
      />
      <SettingsPanelNavButton
        isActive={activePageId === 'experimental'}
        label={t('settingsPanel.nav.experimental')}
        testId="settings-section-nav-experimental"
        onClick={() => onSelectPage('experimental')}
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
