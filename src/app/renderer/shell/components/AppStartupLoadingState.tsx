import { Button } from '@app/renderer/components/ui/Button'
import { useAppStore } from '../store/useAppStore'
import { toErrorMessage } from '../utils/format'
import { WORKER_CONNECTION_RETRY_EVENT } from '../hooks/workerSync/workerConnectionState'
import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function AppStartupLoadingState(): React.JSX.Element {
  const { t } = useTranslation()
  const connectionError = useAppStore(state => state.workerConnectionError)

  return (
    <div className="app-startup-state">
      <div className="app-startup-state__panel" role="status" aria-live="polite">
        <div className="app-startup-state__preview" aria-hidden="true">
          <div className="app-startup-state__preview-window">
            <div className="app-startup-state__preview-header">
              <div className="app-startup-state__traffic-lights">
                <span className="app-startup-state__traffic-light app-startup-state__traffic-light--close" />
                <span className="app-startup-state__traffic-light app-startup-state__traffic-light--minimize" />
                <span className="app-startup-state__traffic-light app-startup-state__traffic-light--zoom" />
              </div>
              <div className="app-startup-state__preview-title" />
            </div>

            <div className="app-startup-state__preview-body">
              <div className="app-startup-state__preview-sidebar">
                <div className="app-startup-state__preview-sidebar-item app-startup-state__preview-sidebar-item--active" />
                <div className="app-startup-state__preview-sidebar-item" />
                <div className="app-startup-state__preview-sidebar-item" />
                <div className="app-startup-state__preview-sidebar-spacer" />
                <div className="app-startup-state__preview-sidebar-item app-startup-state__preview-sidebar-item--short" />
              </div>

              <div className="app-startup-state__preview-canvas">
                <div className="app-startup-state__preview-space" />
                <div className="app-startup-state__preview-node app-startup-state__preview-node--primary">
                  <div className="app-startup-state__preview-node-bar" />
                  <div className="app-startup-state__preview-node-line" />
                  <div className="app-startup-state__preview-node-line app-startup-state__preview-node-line--short" />
                </div>
                <div className="app-startup-state__preview-node app-startup-state__preview-node--secondary">
                  <div className="app-startup-state__preview-node-bar" />
                  <div className="app-startup-state__preview-node-line" />
                  <div className="app-startup-state__preview-node-line app-startup-state__preview-node-line--short" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="app-startup-state__content">
          <div className="app-startup-state__badge">
            <span className="app-startup-state__badge-dot" aria-hidden="true" />
            <span>OpenCove</span>
          </div>
          <h1>{t('appStartupState.title')}</h1>
          {connectionError ? (
            <>
              <p role="alert">{toErrorMessage(connectionError)}</p>
              <Button
                onClick={() => window.dispatchEvent(new Event(WORKER_CONNECTION_RETRY_EVENT))}
              >
                {t('messages.workerConnectionRetry')}
              </Button>
            </>
          ) : (
            <p>{t('appStartupState.description')}</p>
          )}
          <div className="app-startup-state__progress" aria-hidden="true">
            <div className="app-startup-state__progress-indicator" />
          </div>
        </div>
      </div>
    </div>
  )
}
