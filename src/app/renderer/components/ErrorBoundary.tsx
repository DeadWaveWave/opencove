import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error in renderer:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleDismiss = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            backgroundColor: '#0a0a0a',
            color: '#e5e5e5',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '2rem',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: '#f87171' }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#a3a3a3',
              marginBottom: '1.5rem',
              maxWidth: '32rem',
              textAlign: 'center',
            }}
          >
            The renderer hit an unrecoverable error. Your workspace data is safe.
          </p>
          {this.state.error && (
            <pre
              style={{
                fontSize: '0.75rem',
                color: '#737373',
                backgroundColor: '#171717',
                padding: '1rem',
                borderRadius: '0.5rem',
                maxWidth: '40rem',
                maxHeight: '8rem',
                overflow: 'auto',
                marginBottom: '1.5rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              onClick={this.handleDismiss}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                backgroundColor: '#262626',
                color: '#a3a3a3',
                border: '1px solid #404040',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
