import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import type { TerminalProcessEnginePort } from '../../../../contexts/terminal/application/ports/TerminalProcessEnginePort'
import { PtyHostTerminalProcessEngine } from '../../../../contexts/terminal/infrastructure/PtyHostTerminalProcessEngine'
import { createNodeChildPtyHostProcess } from '../../../../platform/process/ptyHost/nodeProcessAdapter'

export function createWorkerTerminalProcessEngine(options: {
  userDataPath: string
}): TerminalProcessEnginePort {
  return new PtyHostTerminalProcessEngine({
    baseDir: __dirname,
    logFilePath: resolve(options.userDataPath, 'logs', 'pty-host.log'),
    createProcess: modulePath =>
      createNodeChildPtyHostProcess(
        fork(modulePath, [], {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          env: { ...process.env },
        }),
      ),
  })
}
