import React from 'react'
import { ChevronsDownUp, FilePlus, FolderPlus, RefreshCw, Search, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceSpaceExplorerOverlayToolbar({
  viewMode = 'list',
  query,
  inputRef,
  hasRootError,
  onQueryChange,
  onClearQuery,
  onCreateFile,
  onCreateFolder,
  onCollapseAll,
  onRefresh,
}: {
  viewMode?: 'icons' | 'list'
  query: string
  inputRef: React.RefObject<HTMLInputElement | null>
  hasRootError: boolean
  onQueryChange: (query: string) => void
  onClearQuery: () => void
  onCreateFile: () => void
  onCreateFolder: () => void
  onCollapseAll: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const searchButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const [isSearchExpanded, setIsSearchExpanded] = React.useState(false)
  const [availableWidth, setAvailableWidth] = React.useState<number | null>(null)
  const hasQuery = query.trim().length > 0
  const toolsWidth = viewMode === 'list' ? 102 : 76
  const areToolsHidden =
    isSearchExpanded && availableWidth !== null && availableWidth < toolsWidth + 210

  React.useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) {
      return
    }
    if (toolbar.clientWidth > 0) {
      setAvailableWidth(toolbar.clientWidth)
    }
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined && width > 0) {
        setAvailableWidth(width)
      }
    })
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  const actions = [
    { label: t('spaceExplorer.newFile'), Icon: FilePlus, onClick: onCreateFile },
    { label: t('spaceExplorer.newFolder'), Icon: FolderPlus, onClick: onCreateFolder },
    { label: t('spaceExplorer.collapseAll'), Icon: ChevronsDownUp, onClick: onCollapseAll },
    { label: t('spaceExplorer.refresh'), Icon: RefreshCw, onClick: onRefresh, alwaysEnabled: true },
  ]

  return (
    <div
      ref={toolbarRef}
      className="workspace-space-explorer__toolbar cove-directory-toolbar nodrag"
      data-search-expanded={isSearchExpanded}
      data-tools-hidden={areToolsHidden}
      data-view-mode={viewMode}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="workspace-space-explorer__filter"
        data-directory-search="true"
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsSearchExpanded(false)
          }
        }}
        onKeyDown={event => {
          if (event.key !== 'Escape') {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          if (hasQuery) {
            onClearQuery()
            inputRef.current?.focus()
          } else {
            setIsSearchExpanded(false)
            searchButtonRef.current?.focus()
          }
        }}
      >
        <button
          ref={searchButtonRef}
          type="button"
          className="cove-directory-toolbar__search-toggle"
          aria-label={t('spaceExplorer.filterPlaceholder')}
          title={t('spaceExplorer.filterPlaceholder')}
          aria-expanded={isSearchExpanded}
          data-filter-active={hasQuery}
          data-testid="workspace-space-explorer-filter-toggle"
          onClick={() => inputRef.current?.focus()}
        >
          <Search className="workspace-space-explorer__filter-icon" aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          type="text"
          className="workspace-space-explorer__filter-input nowheel nodrag"
          value={query}
          placeholder={t('spaceExplorer.filterPlaceholder')}
          aria-label={t('spaceExplorer.filterPlaceholder')}
          aria-hidden={!isSearchExpanded}
          tabIndex={isSearchExpanded ? 0 : -1}
          data-testid="workspace-space-explorer-filter-input"
          onFocus={() => setIsSearchExpanded(true)}
          onChange={event => onQueryChange(event.target.value)}
        />
        {isSearchExpanded && hasQuery ? (
          <button
            type="button"
            className="workspace-space-explorer__filter-clear"
            aria-label={t('spaceExplorer.clearFilter')}
            title={t('spaceExplorer.clearFilter')}
            onClick={() => {
              onClearQuery()
              inputRef.current?.focus()
            }}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div
        className="workspace-space-explorer__tools"
        role="group"
        aria-label={t('spaceActions.files')}
        aria-hidden={areToolsHidden}
        inert={areToolsHidden}
      >
        {actions
          .filter(action => action.Icon !== ChevronsDownUp || viewMode === 'list')
          .map(({ label, Icon, onClick, alwaysEnabled }) => (
            <button
              key={label}
              type="button"
              className="workspace-space-explorer__header-action"
              aria-label={label}
              title={label}
              disabled={hasRootError && !alwaysEnabled}
              onClick={onClick}
            >
              <Icon aria-hidden="true" />
            </button>
          ))}
      </div>
    </div>
  )
}
