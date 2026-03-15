import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceCanvasMessageTone } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'

export function AppMessage({
  tone,
  text,
}: {
  tone: WorkspaceCanvasMessageTone
  text: string
}): React.JSX.Element {
  const { t } = useTranslation()

  const label =
    tone === 'warning'
      ? t('appMessage.warning')
      : tone === 'error'
        ? t('appMessage.error')
        : t('appMessage.info')

  return (
    <div
      className={`app-message app-message--${tone}`}
      data-testid="app-message"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className="app-message__label">{label}</span>
      <span className="app-message__text">{text}</span>
    </div>
  )
}
