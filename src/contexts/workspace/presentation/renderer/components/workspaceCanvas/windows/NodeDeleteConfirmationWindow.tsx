import React, { type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { NodeDeleteConfirmationState } from '../types'

interface NodeDeleteConfirmationWindowProps {
  nodeDeleteConfirmation: NodeDeleteConfirmationState | null
  setNodeDeleteConfirmation: Dispatch<SetStateAction<NodeDeleteConfirmationState | null>>
  confirmNodeDelete: () => Promise<void>
}

function renderDescription(
  nodeDeleteConfirmation: NodeDeleteConfirmationState,
  t: (key: string, options?: Record<string, unknown>) => string,
): React.JSX.Element | string {
  const { nodeIds, primaryNodeKind, primaryNodeTitle } = nodeDeleteConfirmation
  if (nodeIds.length > 1) {
    return t('nodeDeleteDialog.multipleDescription', { count: nodeIds.length })
  }

  if (primaryNodeKind === 'task') {
    return (
      <>
        {t('nodeDeleteDialog.taskDescriptionPrefix')} <strong>{primaryNodeTitle}</strong>.
      </>
    )
  }

  return (
    <>
      {t('nodeDeleteDialog.nodeDescriptionPrefix', { kind: primaryNodeKind })}{' '}
      <strong>{primaryNodeTitle}</strong>.
    </>
  )
}

export function NodeDeleteConfirmationWindow({
  nodeDeleteConfirmation,
  setNodeDeleteConfirmation,
  confirmNodeDelete,
}: NodeDeleteConfirmationWindowProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!nodeDeleteConfirmation) {
    return null
  }

  const heading =
    nodeDeleteConfirmation.nodeIds.length > 1
      ? t('nodeDeleteDialog.deleteNodes', { count: nodeDeleteConfirmation.nodeIds.length })
      : nodeDeleteConfirmation.primaryNodeKind === 'task'
        ? t('nodeDeleteDialog.deleteTask')
        : t('nodeDeleteDialog.deleteNode')

  return (
    <div
      className="cove-window-backdrop workspace-task-delete-backdrop workspace-task-creator-backdrop"
      onClick={() => {
        setNodeDeleteConfirmation(null)
      }}
    >
      <section
        className="cove-window workspace-task-delete workspace-task-creator"
        data-testid="workspace-node-delete-confirmation"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <h3>{heading}</h3>
        <p>{renderDescription(nodeDeleteConfirmation, t)}</p>
        <div className="cove-window__actions workspace-task-delete__actions workspace-task-creator__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost"
            data-testid="workspace-node-delete-cancel"
            onClick={() => {
              setNodeDeleteConfirmation(null)
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            autoFocus
            className="cove-window__action cove-window__action--danger workspace-task-creator__action workspace-task-creator__action--danger"
            data-testid="workspace-node-delete-confirm"
            onClick={() => {
              void confirmNodeDelete()
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      </section>
    </div>
  )
}
