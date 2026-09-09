import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  createSettingsSearchEntries,
  searchSettingsEntries,
  type SettingsSearchResult,
} from './settingsSearchIndex'

export function SettingsPanelSearch({
  searchInputRef,
  workspaces,
  onSelectSearchResult,
}: {
  searchInputRef?: Ref<HTMLInputElement>
  workspaces: WorkspaceState[]
  onSelectSearchResult: (result: SettingsSearchResult) => void
}) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchResultId, setActiveSearchResultId] = useState<string | null>(null)
  const searchResultRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const searchInteractionModeRef = useRef<'keyboard' | 'pointer'>('keyboard')
  const searchEntries = useMemo(
    () => createSettingsSearchEntries({ t, workspaces }),
    [t, workspaces],
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

  return (
    <div className="settings-panel__search">
      <div className="settings-panel__search-input-shell">
        <Search className="settings-panel__search-icon" size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          id="settings-panel-search"
          className="cove-field settings-panel__search-input"
          type="search"
          value={searchQuery}
          role="searchbox"
          aria-label={t('settingsPanel.search.label')}
          aria-controls={searchQuery ? 'settings-panel-search-results' : undefined}
          aria-expanded={searchQuery ? visibleSearchResults.length > 0 : undefined}
          aria-activedescendant={
            activeSearchResult ? `settings-panel-search-result-${activeSearchResult.id}` : undefined
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
  )
}
