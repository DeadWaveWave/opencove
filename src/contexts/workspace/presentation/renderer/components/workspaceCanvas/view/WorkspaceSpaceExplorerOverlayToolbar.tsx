import React from 'react'
import { ChevronsDownUp, FilePlus, FolderPlus, RefreshCw, Search, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceSpaceExplorerOverlayToolbar({
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
  const actions = [
    { label: t('spaceExplorer.newFile'), Icon: FilePlus, onClick: onCreateFile },
    { label: t('spaceExplorer.newFolder'), Icon: FolderPlus, onClick: onCreateFolder },
    { label: t('spaceExplorer.collapseAll'), Icon: ChevronsDownUp, onClick: onCollapseAll },
    { label: t('spaceExplorer.refresh'), Icon: RefreshCw, onClick: onRefresh, alwaysEnabled: true },
  ]

  return (
    <div
      className="workspace-space-explorer__toolbar nodrag"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div className="workspace-space-explorer__filter">
        <Search className="workspace-space-explorer__filter-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="workspace-space-explorer__filter-input nowheel nodrag"
          value={query}
          placeholder={t('spaceExplorer.filterPlaceholder')}
          aria-label={t('spaceExplorer.filterPlaceholder')}
          data-testid="workspace-space-explorer-filter-input"
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Escape' || query.trim().length === 0) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            onClearQuery()
          }}
        />
        {query.trim().length > 0 ? (
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
      >
        {actions.map(({ label, Icon, onClick, alwaysEnabled }) => (
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
