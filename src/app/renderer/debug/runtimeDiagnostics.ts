import type { RuntimeDiagnosticsLogInput } from '@shared/contracts/dto'

export function logRuntimeDiagnostics(input: RuntimeDiagnosticsLogInput): void {
  window.opencoveApi.debug?.logRuntimeDiagnostics?.(input)
}

export function logRendererErrorBoundaryDiagnostic(
  error: Error,
  errorInfo: Pick<React.ErrorInfo, 'componentStack'>,
): void {
  logRuntimeDiagnostics({
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
