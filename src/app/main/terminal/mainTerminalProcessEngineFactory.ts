import { app, utilityProcess } from 'electron'
import { resolve } from 'node:path'
import type { TerminalProcessEnginePort } from '../../../contexts/terminal/application/ports/TerminalProcessEnginePort'
import { PtyHostTerminalProcessEngine } from '../../../contexts/terminal/infrastructure/PtyHostTerminalProcessEngine'
import { createElectronUtilityPtyHostProcess } from '../../../platform/process/ptyHost/electronUtilityProcessAdapter'

function reportTerminalProcessEngineIssue(message: string): void {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  process.stderr.write(`${message}\n`)
}

export function createMainTerminalProcessEngine(): TerminalProcessEnginePort {
  return new PtyHostTerminalProcessEngine({
    baseDir: __dirname,
    logFilePath: resolve(app.getPath('userData'), 'logs', 'pty-host.log'),
    reportIssue: reportTerminalProcessEngineIssue,
    createProcess: modulePath =>
      createElectronUtilityPtyHostProcess(
        utilityProcess.fork(modulePath, [], {
          stdio: 'pipe',
          serviceName: 'OpenCove PTY Host',
        }),
      ),
  })
}
