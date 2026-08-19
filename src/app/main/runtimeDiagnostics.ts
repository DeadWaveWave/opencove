import { app } from 'electron'
import { resolve } from 'node:path'
import type {
  RuntimeDiagnosticsDetailValue,
  RuntimeDiagnosticsLogInput,
  RuntimeDiagnosticsSource,
} from '../../shared/contracts/dto'
import { appendBoundedRuntimeDiagnosticsLine } from './diagnostics/runtimeDiagnosticsFile'

function appendRuntimeDiagnosticsFile(line: string): void {
  try {
    const filePath = resolve(app.getPath('userData'), 'logs', 'runtime-diagnostics.log')
    appendBoundedRuntimeDiagnosticsLine(filePath, line)
  } catch {
    // Diagnostics logging must never affect app runtime behavior.
  }
}

function writeRuntimeDiagnosticsLine(payload: RuntimeDiagnosticsLogInput): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  })
  const stream = payload.level === 'error' ? process.stderr : process.stdout
  stream.write(`[opencove-runtime-diagnostics] ${line}\n`)
  appendRuntimeDiagnosticsFile(line)
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
