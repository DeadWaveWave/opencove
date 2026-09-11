import React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../i18n'
import { IconButton } from './ui/IconButton'

export function WindowHeading({
  title,
  icon,
  onClose,
  disabled = false,
}: {
  title: React.ReactNode
  icon?: React.ReactNode
  onClose?: () => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header className="cove-window__heading">
      {icon ? <span className="cove-window__heading-icon">{icon}</span> : null}
      <h3>{title}</h3>
      {onClose ? (
        <IconButton
          className="cove-window__heading-close"
          label={t('common.close')}
          disabled={disabled}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      ) : null}
    </header>
  )
}
