import React from 'react'
import { CloseIcon, FolderIcon } from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import { WorkspaceDirectoryViewMode } from './WorkspaceDirectoryViewMode'

export function WorkspaceSpaceExplorerOverlayHeader({
  title,
  viewMode,
  onViewModeChange,
  onWindowDragStart,
  onClose,
}: {
  title: string
  viewMode: 'icons' | 'list'
  onViewModeChange?: (mode: 'icons' | 'list') => void
  onWindowDragStart: React.PointerEventHandler<HTMLElement>
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header
      className="workspace-space-explorer__header"
      data-cove-part="window-header"
      data-node-drag-handle="true"
      onPointerDown={onWindowDragStart}
    >
      <div className="workspace-space-explorer__identity" title={title}>
        <FolderIcon className="workspace-space-explorer__identity-icon" />
        <div className="workspace-space-explorer__identity-copy">
          <span className="workspace-space-explorer__title" data-cove-part="window-title">
            {title}
          </span>
        </div>
      </div>
      <div className="workspace-space-explorer__header-actions">
        <WorkspaceDirectoryViewMode viewMode={viewMode} onViewModeChange={onViewModeChange} />
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
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}
