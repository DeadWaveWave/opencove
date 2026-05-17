import { type UtilityProcess } from 'electron'
import type { PtyHostProcess } from './processTypes'

export function createElectronUtilityPtyHostProcess(child: UtilityProcess): PtyHostProcess {
  return {
    on: (event, listener) => {
      if (event === 'message') {
        child.on('message', listener)
        return
      }

      if (event === 'error') {
        child.on('error', (type, location, report) => {
          listener({ type, location, report })
        })
        return
      }

      child.on('exit', code => {
        listener(typeof code === 'number' ? code : 1)
      })
    },
    postMessage: (message, callback) => {
      try {
        child.postMessage(message)
        callback?.(null)
      } catch (error) {
        callback?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
    kill: () => {
      return child.kill()
    },
    stdout: child.stdout ?? null,
    stderr: child.stderr ?? null,
    pid: child.pid,
  }
}
