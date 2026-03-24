import React from 'react'
import { AlertTriangle } from 'lucide-react'

function joinClassNames(...values: Array<string | null | undefined | false>): string {
  return values.filter(value => typeof value === 'string' && value.length > 0).join(' ')
}

export function WarningDialog({
  dataTestId,
  title,
  summary,
  statusLabel,
  statusAriaLabel,
  lead,
  children,
  actions,
  onBackdropClick,
  disableBackdropDismiss = false,
  backdropClassName,
  dialogClassName,
}: {
  dataTestId: string
  title: React.ReactNode
  summary?: React.ReactNode
  statusLabel?: React.ReactNode
  statusAriaLabel?: string
  lead?: React.ReactNode
  children?: React.ReactNode
  actions: React.ReactNode
  onBackdropClick?: () => void
  disableBackdropDismiss?: boolean
  backdropClassName?: string
  dialogClassName?: string
}): React.JSX.Element {
  return (
    <div
      className={joinClassNames(
        'cove-window-backdrop',
        'workspace-warning-dialog-backdrop',
        backdropClassName,
      )}
      data-testid={dataTestId}
      onClick={() => {
        if (disableBackdropDismiss) {
          return
        }

        onBackdropClick?.()
      }}
    >
      <section
        className={joinClassNames('cove-window', 'workspace-warning-dialog', dialogClassName)}
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <div className="workspace-warning-dialog__header">
          <div className="workspace-warning-dialog__topline">
            <div className="workspace-warning-dialog__title-group">
              <h3>{title}</h3>
              {summary ? <p className="workspace-warning-dialog__summary">{summary}</p> : null}
            </div>
            {statusLabel ? (
              <div className="workspace-warning-dialog__status" aria-label={statusAriaLabel}>
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{statusLabel}</span>
              </div>
            ) : null}
          </div>
        </div>

        {lead ? <div className="workspace-warning-dialog__lead">{lead}</div> : null}
        {children}

        <div className="cove-window__actions workspace-warning-dialog__actions">{actions}</div>
      </section>
    </div>
  )
}
