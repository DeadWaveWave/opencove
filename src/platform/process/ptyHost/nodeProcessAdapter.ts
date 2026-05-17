import type { ChildProcess } from 'node:child_process'
import type { PtyHostProcess } from './processTypes'

type NodeChildProcessMessage = string | object | number | boolean | bigint

function isNodeChildProcessMessage(value: unknown): value is NodeChildProcessMessage {
  return (
    typeof value === 'string' ||
    typeof value === 'object' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
}

export function createNodeChildPtyHostProcess(child: ChildProcess): PtyHostProcess {
  return {
    on: (event, listener) => {
      if (event === 'message') {
        child.on('message', listener)
        return
      }

      if (event === 'error') {
        child.on('error', listener)
        return
      }

      child.on('exit', code => {
        listener(typeof code === 'number' ? code : 1)
      })
    },
    postMessage: (message, callback) => {
      const send = child.send
      if (typeof send !== 'function') {
        callback?.(new Error('[pty-host] missing child IPC send'))
        return
      }

      if (!isNodeChildProcessMessage(message)) {
        callback?.(new Error('[pty-host] message is not serializable for child IPC'))
        return
      }

      try {
        send.call(child, message, undefined, undefined, error => {
          callback?.(error ?? null)
        })
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
