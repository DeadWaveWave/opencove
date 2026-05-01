import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function AppStartupLoadingState(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="app-startup-state" role="status" aria-live="polite">
      <div className="app-startup-state__panel">
        <div className="app-startup-state__badge">OpenCove</div>
        <div className="app-startup-state__spinner" aria-hidden="true" />
        <h1>{t('appStartupState.title')}</h1>
        <p>{t('appStartupState.description')}</p>
      </div>
    </div>
  )
}
