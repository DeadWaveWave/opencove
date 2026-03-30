import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { TerminalDiagnosticsLogInput } from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'

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

  const handleTerminalDiagnosticsLog = (
    _event: Electron.IpcMainEvent,
    payload: TerminalDiagnosticsLogInput,
  ): void => {
    if (!isTerminalDiagnosticsEnabled()) {
      return
    }

    writeTerminalDiagnosticsLine(payload)
  }

  ipcMain.on(IPC_CHANNELS.terminalDiagnosticsLog, handleTerminalDiagnosticsLog)

  return {
    dispose: () => {
      ipcMain.removeListener(IPC_CHANNELS.terminalDiagnosticsLog, handleTerminalDiagnosticsLog)
    },
  }
}
