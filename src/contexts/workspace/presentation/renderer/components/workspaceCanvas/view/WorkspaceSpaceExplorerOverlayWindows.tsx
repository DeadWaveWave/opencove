import React from 'react'
import { WarningDialog } from '@app/renderer/components/WarningDialog'
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

  if (deleteConfirmation) {
    return (
      <WarningDialog
        dataTestId="workspace-space-explorer-delete-confirmation"
        title={t('spaceExplorer.deleteTitle')}
        lead={
          <p data-testid="workspace-space-explorer-delete-message">
            {t('spaceExplorer.deletePrompt', { name: deleteConfirmation.entry.name })}
          </p>
        }
        onBackdropClick={onCancelDelete}
        dialogClassName="workspace-warning-dialog--compact"
        actions={
          <>
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
          </>
        }
      />
    )
  }

  return null
}
