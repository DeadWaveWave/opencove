import type { JSX } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function SettingsPanelHeader({
  title,
  description,
  onClose,
}: {
  title: string
  description: string
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="settings-panel__header">
      <div className="settings-panel__header-copy">
        <h2 id="settings-panel-page-title" data-testid="settings-panel-title">
          {title}
        </h2>
        {description ? (
          <p id="settings-panel-page-description" className="settings-panel__header-description">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="settings-panel__close"
        data-testid="settings-panel-close"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
