import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from './ui/Dialog'

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
  const titleId = React.useId()
  if (typeof document === 'undefined' || !document.body) {
    return <></>
  }

  return (
    <Dialog
      open
      role="alertdialog"
      aria-labelledby={titleId}
      className={joinClassNames('cove-window', 'workspace-warning-dialog', dialogClassName)}
      backdropClassName={joinClassNames(
        'cove-window-backdrop',
        'workspace-warning-dialog-backdrop',
        backdropClassName,
      )}
      backdropTestId={dataTestId}
      dismissOnEscape={!disableBackdropDismiss}
      dismissOnPointerDownOutside={!disableBackdropDismiss}
      onDismiss={() => {
        onBackdropClick?.()
      }}
    >
      <div className="workspace-warning-dialog__header">
        <div className="workspace-warning-dialog__topline">
          <div className="workspace-warning-dialog__title-group">
            <h3 id={titleId}>{title}</h3>
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
    </Dialog>
  )
}
