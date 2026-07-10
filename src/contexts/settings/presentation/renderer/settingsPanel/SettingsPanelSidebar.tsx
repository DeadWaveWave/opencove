import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import {
  Bell,
  Bot,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Palette,
  Plug,
  Search,
  Server,
  Settings2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  getFolderName,
  getWorkspacePageId,
  isWorkspacePageId,
  type SettingsPageId,
} from '../SettingsPanel.shared'
import { SettingsPanelNavButton } from './SettingsPanelNavButton'
import {
  CANONICAL_SETTINGS_PAGE_DEFINITIONS,
  SETTINGS_PRIMARY_NAV_GROUPS,
  resolveSettingsPage,
  type SettingsPageIconId,
} from './settingsPageRegistry'
import {
  createSettingsSearchEntries,
  searchSettingsEntries,
  type SettingsSearchResult,
} from './settingsSearchIndex'

const SETTINGS_PAGE_ICONS: Record<SettingsPageIconId, LucideIcon> = {
  settings: Settings2,
  palette: Palette,
  bell: Bell,
  'layout-dashboard': LayoutDashboard,
  bot: Bot,
  'list-checks': ListChecks,
  server: Server,
  plug: Plug,
  wrench: Wrench,
  folder: FolderKanban,
}

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
  const [activeSearchResultId, setActiveSearchResultId] = useState<string | null>(null)
  const [areProjectsExpanded, setAreProjectsExpanded] = useState(true)
  const searchResultRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const searchInteractionModeRef = useRef<'keyboard' | 'pointer'>('keyboard')
  const searchEntries = useMemo(
    () => createSettingsSearchEntries({ t, workspaces, endpointsEnabled }),
    [endpointsEnabled, t, workspaces],
  )
  const searchResults = useMemo(
    () => searchSettingsEntries(searchEntries, searchQuery),
    [searchEntries, searchQuery],
  )
  const visibleSearchResults = useMemo(() => searchResults.slice(0, 8), [searchResults])
  const activeSearchResult = useMemo(() => {
    if (!activeSearchResultId) {
      return null
    }

    return (
      visibleSearchResults.find(result => result.id === activeSearchResultId) ??
      visibleSearchResults[0] ??
      null
    )
  }, [activeSearchResultId, visibleSearchResults])
  const resolvedActivePage = resolveSettingsPage(activePageId)
  const mobilePageValue = isWorkspacePageId(activePageId)
    ? activePageId
    : resolvedActivePage.canonicalPageId

  useEffect(() => {
    if (isWorkspacePageId(activePageId)) {
      setAreProjectsExpanded(true)
    }
  }, [activePageId])

  useEffect(() => {
    if (!activeSearchResultId) {
      return
    }

    const hasActiveResult = visibleSearchResults.some(result => result.id === activeSearchResultId)
    if (!hasActiveResult) {
      setActiveSearchResultId(visibleSearchResults[0]?.id ?? null)
    }
  }, [activeSearchResultId, visibleSearchResults])

  useEffect(() => {
    if (searchInteractionModeRef.current !== 'keyboard' || !activeSearchResult) {
      return
    }

    searchResultRefs.current.get(activeSearchResult.id)?.scrollIntoView({ block: 'nearest' })
  }, [activeSearchResult])

  const selectSearchResult = (result: SettingsSearchResult): void => {
    onSelectSearchResult(result)
    setSearchQuery('')
    setActiveSearchResultId(null)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && searchQuery.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      setSearchQuery('')
      setActiveSearchResultId(null)
      return
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleSearchResults.length > 0) {
      event.preventDefault()
      searchInteractionModeRef.current = 'keyboard'
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const currentIndex = activeSearchResult
        ? visibleSearchResults.findIndex(result => result.id === activeSearchResult.id)
        : -1
      const nextIndex =
        currentIndex < 0
          ? direction === 1
            ? 0
            : visibleSearchResults.length - 1
          : (currentIndex + direction + visibleSearchResults.length) % visibleSearchResults.length
      setActiveSearchResultId(visibleSearchResults[nextIndex]?.id ?? null)
      return
    }

    if (event.key === 'Enter' && visibleSearchResults.length > 0) {
      event.preventDefault()
      selectSearchResult(activeSearchResult ?? visibleSearchResults[0])
    }
  }

  const mobilePageOptions = [
    ...SETTINGS_PRIMARY_NAV_GROUPS.flatMap(group =>
      group.pageIds.map(pageId => {
        const definition = CANONICAL_SETTINGS_PAGE_DEFINITIONS[pageId]
        return { value: pageId, label: t(definition.navLabelKey) }
      }),
    ),
    ...workspaces.map(workspace => ({
      value: getWorkspacePageId(workspace.id),
      label: workspace.name.trim().length > 0 ? workspace.name : getFolderName(workspace.path),
    })),
  ]

  return (
    <aside className="settings-panel__sidebar" aria-label={t('settingsPanel.nav.sectionsLabel')}>
      <div className="settings-panel__search">
        <div className="settings-panel__search-input-shell">
          <Search className="settings-panel__search-icon" size={14} aria-hidden="true" />
          <input
            autoFocus
            id="settings-panel-search"
            className="cove-field settings-panel__search-input"
            type="search"
            value={searchQuery}
            role="searchbox"
            aria-label={t('settingsPanel.search.label')}
            aria-controls={searchQuery ? 'settings-panel-search-results' : undefined}
            aria-expanded={searchQuery ? visibleSearchResults.length > 0 : undefined}
            aria-activedescendant={
              activeSearchResult
                ? `settings-panel-search-result-${activeSearchResult.id}`
                : undefined
            }
            placeholder={t('settingsPanel.search.placeholder')}
            data-testid="settings-panel-search"
            onChange={event => {
              setSearchQuery(event.target.value)
              setActiveSearchResultId(null)
            }}
            onKeyDown={handleSearchKeyDown}
          />
        </div>

        {searchQuery ? (
          <div
            id="settings-panel-search-results"
            className="settings-panel__search-results"
            data-testid="settings-panel-search-results"
            role="listbox"
            aria-label={t('settingsPanel.search.label')}
          >
            {visibleSearchResults.length > 0 ? (
              visibleSearchResults.map(result => (
                <button
                  id={`settings-panel-search-result-${result.id}`}
                  key={result.id}
                  ref={element => {
                    if (element) {
                      searchResultRefs.current.set(result.id, element)
                    } else {
                      searchResultRefs.current.delete(result.id)
                    }
                  }}
                  type="button"
                  role="option"
                  aria-selected={result.id === activeSearchResult?.id}
                  className={`settings-panel__search-result${result.id === activeSearchResult?.id ? ' settings-panel__search-result--active' : ''}`}
                  data-testid={`settings-panel-search-result-${result.id}`}
                  onMouseEnter={() => {
                    searchInteractionModeRef.current = 'pointer'
                    setActiveSearchResultId(result.id)
                  }}
                  onClick={() => selectSearchResult(result)}
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
      </div>

      <div className="settings-panel__mobile-nav">
        <CoveSelect
          id="settings-panel-page-selector"
          testId="settings-panel-page-selector"
          value={mobilePageValue}
          ariaLabel={t('settingsPanel.nav.pageSelectorLabel')}
          options={mobilePageOptions}
          onChange={nextPageId => onSelectPage(nextPageId as SettingsPageId)}
        />
      </div>

      <div className="settings-panel__nav-sections">
        {SETTINGS_PRIMARY_NAV_GROUPS.map(group => (
          <div
            key={group.id}
            className="settings-panel__nav-section"
            role="group"
            aria-label={t(`settingsPanel.navGroups.${group.id}`)}
          >
            <div className="settings-panel__nav-group-label">
              {t(`settingsPanel.navGroups.${group.id}`)}
            </div>
            {group.pageIds.map(pageId => {
              const definition = CANONICAL_SETTINGS_PAGE_DEFINITIONS[pageId]
              const Icon = SETTINGS_PAGE_ICONS[definition.iconId]
              return (
                <SettingsPanelNavButton
                  key={pageId}
                  isActive={resolvedActivePage.canonicalPageId === pageId}
                  icon={<Icon size={15} aria-hidden="true" />}
                  label={t(definition.navLabelKey)}
                  testId={definition.testId}
                  onClick={() => onSelectPage(pageId)}
                />
              )
            })}
          </div>
        ))}

        {workspaces.length > 0 ? (
          <div className="settings-panel__projects">
            <button
              type="button"
              className="settings-panel__projects-toggle"
              aria-expanded={areProjectsExpanded}
              aria-label={
                areProjectsExpanded
                  ? t('settingsPanel.nav.collapseProjects')
                  : t('settingsPanel.nav.expandProjects')
              }
              onClick={() => setAreProjectsExpanded(current => !current)}
            >
              <span>{t('settingsPanel.navGroups.projects')}</span>
              <ChevronDown
                size={13}
                aria-hidden="true"
                className="settings-panel__projects-chevron"
              />
            </button>
            {areProjectsExpanded ? (
              <div
                className="settings-panel__projects-list"
                role="group"
                aria-label={t('settingsPanel.navGroups.projects')}
              >
                {workspaces.map(workspace => (
                  <SettingsPanelNavButton
                    key={workspace.id}
                    isActive={activePageId === getWorkspacePageId(workspace.id)}
                    icon={<FolderKanban size={15} aria-hidden="true" />}
                    label={
                      workspace.name.trim().length > 0
                        ? workspace.name
                        : getFolderName(workspace.path)
                    }
                    onClick={() => onSelectPage(getWorkspacePageId(workspace.id))}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
