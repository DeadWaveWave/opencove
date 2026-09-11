import React from 'react'
import { FolderTree, Scan, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceSpaceExplorerOverlayHeader({
  spaceName,
  onWindowDragStart,
  onClose,
}: {
  spaceName: string
  onWindowDragStart: React.PointerEventHandler<HTMLElement>
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
          <span className="workspace-space-explorer__title">{t('spaceActions.files')}</span>
          <span className="workspace-space-explorer__subtitle">
            <Scan aria-hidden="true" />
            <span>{spaceName}</span>
          </span>
        </div>
      </div>
      <div className="workspace-space-explorer__header-actions">
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
