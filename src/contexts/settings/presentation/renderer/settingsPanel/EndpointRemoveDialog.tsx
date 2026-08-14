import React from 'react'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { useTranslation } from '@app/renderer/i18n'

export function EndpointRemoveDialog({
  displayName,
  mountCount,
  isBusy,
  onCancel,
  onConfirm,
}: {
  displayName: string
  mountCount: number
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const title = t('settingsPanel.endpoints.remove.title')

  return (
    <Dialog
      open
      role="alertdialog"
      aria-label={title}
      backdropClassName="cove-window-backdrop"
      backdropTestId="settings-endpoints-remove-backdrop"
      dismissOnEscape={!isBusy}
      dismissOnPointerDownOutside={false}
      onDismiss={reason => {
        if (!isBusy && reason === 'escape') {
          onCancel()
        }
      }}
    >
      <section className="cove-window" data-testid="settings-endpoints-remove-window">
        <h3>{title}</h3>
        <p className="cove-window__intro">
          {t('settingsPanel.endpoints.remove.description', { name: displayName })}
        </p>
        <p data-testid="settings-endpoints-remove-impact">
          {t('settingsPanel.endpoints.remove.impact', { count: mountCount })}
        </p>
        <div className="cove-window__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            data-testid="settings-endpoints-remove-cancel"
            disabled={isBusy}
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--danger"
            data-testid="settings-endpoints-remove-confirm"
            disabled={isBusy}
            onClick={onConfirm}
          >
            {isBusy ? t('common.removing') : t('common.remove')}
          </button>
        </div>
      </section>
    </Dialog>
  )
}
