import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nProvider } from '../i18n'
import { ErrorBoundary } from '../components/ErrorBoundary'
import AppShell from '../shell/AppShell'
import '../styles.css'

export function renderApp(): void {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          <AppShell />
        </I18nProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
