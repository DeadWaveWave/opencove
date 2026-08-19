import { app, ipcMain } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  PerformanceDiagnosticsSnapshotResult,
  RuntimeDiagnosticsLogInput,
  TerminalDiagnosticsLogInput,
} from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { createMainRuntimeDiagnosticsLogger } from '../runtimeDiagnostics'
import { registerHandledIpc } from './handle'
import { createAppError } from '../../../shared/errors/appError'
import { collectPerformanceDiagnosticsSnapshot } from '../diagnostics/performanceDiagnosticsCollector'
import {
  normalizeTerminalDiagnosticPayload,
  normalizeUiDiagnosticBreadcrumb,
  recordTerminalBreadcrumb,
  recordUiBreadcrumb,
} from '../diagnostics/issueReportBreadcrumbs'

function isTerminalDiagnosticsEnabled(): boolean {
  return (
    process.env['OPENCOVE_TERMINAL_DIAGNOSTICS'] === '1' ||
    process.env['OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS'] === '1'
  )
}

function writeTerminalDiagnosticsLine(payload: TerminalDiagnosticsLogInput): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  })

  process.stdout.write(`[opencove-terminal-diagnostics] ${line}\n`)
  appendTerminalDiagnosticsFile(line)
}

function appendTerminalDiagnosticsFile(line: string): void {
  try {
    const filePath = resolve(app.getPath('userData'), 'logs', 'terminal-diagnostics.log')
    mkdirSync(dirname(filePath), { recursive: true })
    appendFileSync(filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Diagnostics logging must never affect app runtime behavior.
  }
}

function normalizePerformanceDiagnosticsSnapshotPayload(payload: unknown): null {
  if (payload === undefined || payload === null) {
    return null
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'performance-diagnostics:snapshot does not accept a payload',
  })
}

export function registerDiagnosticsIpcHandlers(): IpcRegistrationDisposable {
  if (typeof ipcMain.on !== 'function' || typeof ipcMain.removeListener !== 'function') {
    return {
      dispose: () => undefined,
    }
  }

  const handleTerminalDiagnosticsLog = (_event: Electron.IpcMainEvent, payload: unknown): void => {
    const normalized = normalizeTerminalDiagnosticPayload(payload)
    if (!normalized) {
      return
    }

    recordTerminalBreadcrumb(normalized)
    if (!isTerminalDiagnosticsEnabled()) {
      return
    }

    writeTerminalDiagnosticsLine(normalized)
  }

  const handleUiDiagnosticBreadcrumb = (_event: Electron.IpcMainEvent, payload: unknown): void => {
    const normalized = normalizeUiDiagnosticBreadcrumb(payload)
    if (normalized) {
      recordUiBreadcrumb(normalized)
    }
  }

  const handleRuntimeDiagnosticsLog = (
    _event: Electron.IpcMainEvent,
    payload: RuntimeDiagnosticsLogInput,
  ): void => {
    const runtimeLogger = createMainRuntimeDiagnosticsLogger(payload.source)
    if (payload.level === 'error') {
      runtimeLogger.error(payload.event, payload.message, payload.details)
      return
    }

    runtimeLogger.info(payload.event, payload.message, payload.details)
  }

  ipcMain.on(IPC_CHANNELS.terminalDiagnosticsLog, handleTerminalDiagnosticsLog)
  ipcMain.on(IPC_CHANNELS.uiDiagnosticBreadcrumb, handleUiDiagnosticBreadcrumb)
  ipcMain.on(IPC_CHANNELS.runtimeDiagnosticsLog, handleRuntimeDiagnosticsLog)
  registerHandledIpc(
    IPC_CHANNELS.performanceDiagnosticsSnapshot,
    async (_event, payload: unknown): Promise<PerformanceDiagnosticsSnapshotResult> => {
      normalizePerformanceDiagnosticsSnapshotPayload(payload)
      return await collectPerformanceDiagnosticsSnapshot()
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeListener(IPC_CHANNELS.terminalDiagnosticsLog, handleTerminalDiagnosticsLog)
      ipcMain.removeListener(IPC_CHANNELS.uiDiagnosticBreadcrumb, handleUiDiagnosticBreadcrumb)
      ipcMain.removeListener(IPC_CHANNELS.runtimeDiagnosticsLog, handleRuntimeDiagnosticsLog)
      ipcMain.removeHandler(IPC_CHANNELS.performanceDiagnosticsSnapshot)
    },
  }
}
