import React from 'react'
import { Trash2 } from 'lucide-react'
import { AnchoredOperationPopover } from '@app/renderer/components/AnchoredOperationPopover'
import { useTranslation } from '@app/renderer/i18n'
import { type SpaceExplorerDeleteConfirmationState } from './WorkspaceSpaceExplorerOverlay.operations'

export function WorkspaceSpaceExplorerOverlayWindows({
  deleteConfirmation,
  onCancelDelete,
  onConfirmDelete,
}: {
  deleteConfirmation: SpaceExplorerDeleteConfirmationState | null
  onCancelDelete: () => void
  onConfirmDelete: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  return (
    <>
      {deleteConfirmation ? (
        <AnchoredOperationPopover
          anchor={deleteConfirmation.anchor}
          ariaLabel={t('spaceExplorer.deleteTitle')}
          className="workspace-space-explorer-delete-popover"
          estimatedHeight={220}
          onDismiss={onCancelDelete}
          testId="workspace-space-explorer-delete-confirmation"
        >
          <section className="workspace-operation-guard workspace-operation-guard--danger">
            <header className="workspace-operation-guard__header">
              <span className="workspace-operation-guard__icon" aria-hidden="true">
                <Trash2 size={16} />
              </span>
              <div>
                <h3>{t('spaceExplorer.deleteTitle')}</h3>
                <p data-testid="workspace-space-explorer-delete-message">
                  {t('spaceExplorer.deletePrompt', { name: deleteConfirmation.entry.name })}
                </p>
              </div>
            </header>
            <div className="workspace-operation-guard__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                onClick={onCancelDelete}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--danger"
                onClick={onConfirmDelete}
              >
                {t('common.delete')}
              </button>
            </div>
          </section>
        </AnchoredOperationPopover>
      ) : null}
    </>
  )
}
