import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nProvider } from '../i18n'
import { ErrorBoundary } from '../components/ErrorBoundary'
import AppShell from '../shell/AppShell'
import '../styles.css'

// Test-only component gallery; loaded on demand so it stays out of the app bundle's startup path.
const UiGallery = React.lazy(() => import('../gallery/UiGallery'))

export function renderApp(): void {
  const gallery = window.opencoveApi?.meta?.enableUiGallery === true
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          {gallery ? (
            <React.Suspense fallback={null}>
              <UiGallery />
            </React.Suspense>
          ) : (
            <AppShell />
          )}
        </I18nProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
