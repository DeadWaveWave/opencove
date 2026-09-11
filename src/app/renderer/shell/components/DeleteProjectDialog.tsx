import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { WindowHeading } from '@app/renderer/components/WindowHeading'
import { Trash2 } from 'lucide-react'

export function DeleteProjectDialog({
  workspaceName,
  isRemoving,
  onCancel,
  onConfirm,
}: {
  workspaceName: string
  isRemoving: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Dialog
      open
      role="alertdialog"
      backdropClassName="cove-window-backdrop workspace-task-delete-backdrop workspace-task-creator-backdrop"
      className="cove-window workspace-task-delete workspace-task-creator"
      data-testid="workspace-project-delete-confirmation"
      aria-label={t('deleteProjectDialog.title')}
      aria-describedby="workspace-project-delete-description"
      dismissOnEscape={!isRemoving}
      dismissOnPointerDownOutside={!isRemoving}
      onDismiss={onCancel}
    >
      <WindowHeading
        title={t('deleteProjectDialog.title')}
        icon={<Trash2 size={16} aria-hidden="true" />}
      />
      <p id="workspace-project-delete-description">
        {t('deleteProjectDialog.description', { workspaceName })}
      </p>
      <div className="cove-window__actions workspace-task-delete__actions workspace-task-creator__actions">
        <button
          type="button"
          className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost"
          data-testid="workspace-project-delete-cancel"
          disabled={isRemoving}
          onClick={() => {
            onCancel()
          }}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="cove-window__action cove-window__action--danger workspace-task-creator__action workspace-task-creator__action--danger"
          data-testid="workspace-project-delete-confirm"
          disabled={isRemoving}
          onClick={() => {
            onConfirm()
          }}
        >
          {isRemoving ? t('common.removing') : t('deleteProjectDialog.remove')}
        </button>
      </div>
    </Dialog>
  )
}
