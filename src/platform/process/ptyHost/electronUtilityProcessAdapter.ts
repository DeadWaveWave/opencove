import type { UtilityProcess } from 'electron'
import process from 'node:process'
import type { PtyHostProcess } from './processTypes'

export function createElectronUtilityPtyHostProcess(child: UtilityProcess): PtyHostProcess {
  let launchedPid = child.pid
  child.once('spawn', () => {
    // fork() normally returns before the PID exists. Never rebind a captured PID.
    launchedPid ??= child.pid
  })
  let exited = false
  child.once('exit', () => {
    exited = true
  })
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
    kill: signal => {
      if (exited) {
        return false
      }
      if (signal === 'SIGKILL' && process.platform !== 'win32') {
        // UtilityProcess.kill has no signal overload. Fence the captured child by
        // its exit event/current handle PID rather than ever looking up a replacement host.
        if (!launchedPid || child.pid !== launchedPid) {
          return false
        }
        return process.kill(launchedPid, 'SIGKILL')
      }
      return child.kill()
    },
    stdout: child.stdout ?? null,
    stderr: child.stderr ?? null,
    get pid() {
      return child.pid
    },
  }
}
