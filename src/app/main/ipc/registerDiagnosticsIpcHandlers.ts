import { ipcMain } from 'electron'
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

  const runtimeLogger = createMainRuntimeDiagnosticsLogger('renderer-error-boundary')
  const handleTerminalDiagnosticsLog = (
    _event: Electron.IpcMainEvent,
    payload: TerminalDiagnosticsLogInput,
  ): void => {
    if (!isTerminalDiagnosticsEnabled()) {
      return
    }

    writeTerminalDiagnosticsLine(payload)
  }

  const handleRuntimeDiagnosticsLog = (
    _event: Electron.IpcMainEvent,
    payload: RuntimeDiagnosticsLogInput,
  ): void => {
    if (payload.level === 'error') {
      runtimeLogger.error(payload.event, payload.message, payload.details)
      return
    }

    runtimeLogger.info(payload.event, payload.message, payload.details)
  }

  ipcMain.on(IPC_CHANNELS.terminalDiagnosticsLog, handleTerminalDiagnosticsLog)
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
      ipcMain.removeListener(IPC_CHANNELS.runtimeDiagnosticsLog, handleRuntimeDiagnosticsLog)
      ipcMain.removeHandler(IPC_CHANNELS.performanceDiagnosticsSnapshot)
    },
  }
}
