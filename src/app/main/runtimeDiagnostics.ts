import type {
  RuntimeDiagnosticsDetailValue,
  RuntimeDiagnosticsLogInput,
  RuntimeDiagnosticsSource,
} from '../../shared/contracts/dto'

function writeRuntimeDiagnosticsLine(payload: RuntimeDiagnosticsLogInput): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  })
  const stream = payload.level === 'error' ? process.stderr : process.stdout
  stream.write(`[opencove-runtime-diagnostics] ${line}\n`)
}

export function createMainRuntimeDiagnosticsLogger(source: RuntimeDiagnosticsSource): {
  info: (
    event: string,
    message: string,
    details?: Record<string, RuntimeDiagnosticsDetailValue>,
  ) => void
  error: (
    event: string,
    message: string,
    details?: Record<string, RuntimeDiagnosticsDetailValue>,
  ) => void
} {
  return {
    info: (event, message, details) => {
      writeRuntimeDiagnosticsLine({
        source,
        level: 'info',
        event,
        message,
        ...(details ? { details } : {}),
      })
    },
    error: (event, message, details) => {
      writeRuntimeDiagnosticsLine({
        source,
        level: 'error',
        event,
        message,
        ...(details ? { details } : {}),
      })
    },
  }
}
