export function logRendererErrorBoundaryDiagnostic(
  error: Error,
  errorInfo: Pick<React.ErrorInfo, 'componentStack'>,
): void {
  window.opencoveApi.debug?.logRuntimeDiagnostics?.({
    source: 'renderer-error-boundary',
    level: 'error',
    event: 'component-did-catch',
    message: 'Renderer error boundary caught an uncaught error.',
    details: {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack ?? null,
      componentStack: errorInfo.componentStack || null,
    },
  })
}
