import React from 'react'
import { ChevronsDownUp, FilePlus, FolderPlus, FolderTree, RefreshCw, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceSpaceExplorerOverlayHeader({
  spaceName,
  hasRootError = false,
  showFileActions = true,
  onWindowDragStart,
  onCreateFile,
  onCreateFolder,
  onCollapseAll,
  onRefresh,
  onClose,
}: {
  spaceName: string
  hasRootError?: boolean
  showFileActions?: boolean
  onWindowDragStart: React.PointerEventHandler<HTMLElement>
  onCreateFile?: () => void
  onCreateFolder?: () => void
  onCollapseAll?: () => void
  onRefresh?: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header
      className="workspace-space-explorer__header"
      data-node-drag-handle="true"
      onPointerDown={onWindowDragStart}
    >
      <div className="workspace-space-explorer__identity" title={spaceName}>
        <FolderTree className="workspace-space-explorer__identity-icon" aria-hidden="true" />
        <div className="workspace-space-explorer__identity-copy">
          <div className="workspace-space-explorer__title">{t('spaceActions.files')}</div>
          <div className="workspace-space-explorer__subtitle">{spaceName}</div>
        </div>
      </div>
      <div className="workspace-space-explorer__header-actions">
        {showFileActions ? (
          <>
            <button
              type="button"
              className="workspace-space-explorer__header-action nodrag"
              aria-label={t('spaceExplorer.newFile')}
              title={t('spaceExplorer.newFile')}
              disabled={hasRootError}
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onCreateFile?.()
              }}
            >
              <FilePlus aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-space-explorer__header-action nodrag"
              aria-label={t('spaceExplorer.newFolder')}
              title={t('spaceExplorer.newFolder')}
              disabled={hasRootError}
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onCreateFolder?.()
              }}
            >
              <FolderPlus aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-space-explorer__header-action nodrag"
              aria-label={t('spaceExplorer.collapseAll')}
              title={t('spaceExplorer.collapseAll')}
              disabled={hasRootError}
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onCollapseAll?.()
              }}
            >
              <ChevronsDownUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-space-explorer__header-action nodrag"
              aria-label={t('spaceExplorer.refresh')}
              title={t('spaceExplorer.refresh')}
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onRefresh?.()
              }}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="workspace-space-explorer__header-action workspace-space-explorer__header-action--close nodrag"
          aria-label={t('common.close')}
          title={t('common.close')}
          onPointerDown={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
