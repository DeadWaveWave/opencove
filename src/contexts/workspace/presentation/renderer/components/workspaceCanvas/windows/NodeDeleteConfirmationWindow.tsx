import React, { type Dispatch, type SetStateAction } from 'react'
import type { NodeDeleteConfirmationState } from '../types'

interface NodeDeleteConfirmationWindowProps {
  nodeDeleteConfirmation: NodeDeleteConfirmationState | null
  setNodeDeleteConfirmation: Dispatch<SetStateAction<NodeDeleteConfirmationState | null>>
  confirmNodeDelete: () => Promise<void>
}

function renderDescription(
  nodeDeleteConfirmation: NodeDeleteConfirmationState,
): React.JSX.Element | string {
  const { nodeIds, primaryNodeKind, primaryNodeTitle } = nodeDeleteConfirmation
  if (nodeIds.length > 1) {
    return `This will permanently remove ${nodeIds.length} selected nodes.`
  }

  if (primaryNodeKind === 'task') {
    return (
      <>
        This will permanently remove <strong>{primaryNodeTitle}</strong>.
      </>
    )
  }

  return (
    <>
      This will permanently remove this {primaryNodeKind}: <strong>{primaryNodeTitle}</strong>.
    </>
  )
}

export function NodeDeleteConfirmationWindow({
  nodeDeleteConfirmation,
  setNodeDeleteConfirmation,
  confirmNodeDelete,
}: NodeDeleteConfirmationWindowProps): React.JSX.Element | null {
  if (!nodeDeleteConfirmation) {
    return null
  }

  const heading =
    nodeDeleteConfirmation.nodeIds.length > 1
      ? `Delete ${nodeDeleteConfirmation.nodeIds.length} nodes?`
      : nodeDeleteConfirmation.primaryNodeKind === 'task'
        ? 'Delete Task?'
        : 'Delete Node?'

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
        <p>{renderDescription(nodeDeleteConfirmation)}</p>
        <div className="cove-window__actions workspace-task-delete__actions workspace-task-creator__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost"
            data-testid="workspace-node-delete-cancel"
            onClick={() => {
              setNodeDeleteConfirmation(null)
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--danger workspace-task-creator__action workspace-task-creator__action--danger"
            data-testid="workspace-node-delete-confirm"
            onClick={() => {
              void confirmNodeDelete()
            }}
          >
            Delete
          </button>
        </div>
      </section>
    </div>
  )
}
