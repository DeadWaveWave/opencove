import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  RuntimeDiagnosticsLogInput,
  TerminalDiagnosticsLogInput,
} from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { createMainRuntimeDiagnosticsLogger } from '../runtimeDiagnostics'

function isTerminalDiagnosticsEnabled(): boolean {
  return process.env['OPENCOVE_TERMINAL_DIAGNOSTICS'] === '1'
}

function writeTerminalDiagnosticsLine(payload: TerminalDiagnosticsLogInput): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  })

  process.stdout.write(`[opencove-terminal-diagnostics] ${line}\n`)
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

  return {
    dispose: () => {
      ipcMain.removeListener(IPC_CHANNELS.terminalDiagnosticsLog, handleTerminalDiagnosticsLog)
      ipcMain.removeListener(IPC_CHANNELS.runtimeDiagnosticsLog, handleRuntimeDiagnosticsLog)
    },
  }
}
