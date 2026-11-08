import process from 'node:process'
import { parentPort as workerParentPort } from 'node:worker_threads'

export type ParentPort = {
  on: (event: 'message' | 'close', listener: (messageEvent: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
  start: () => void
}

type ChildProcessPort = {
  on: (event: 'message', listener: (message: unknown) => void) => void
  connected?: boolean
  send?: (message: unknown, callback: (error: Error | null) => void) => void
}

export function resolvePtyHostParentPort(): ParentPort {
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!parentPort) {
    const port = workerParentPort
    if (!port) {
      const childProcessPort = process as unknown as ChildProcessPort
      if (typeof childProcessPort.send !== 'function') {
        throw new Error('[pty-host] missing parent port')
      }

      return {
        on: (event, listener) => {
          if (event === 'close') {
            return
          } // child_process uses the disconnect signal below.
          childProcessPort.on('message', message => {
            listener({ data: message })
          })
        },
        postMessage: message => {
          if (childProcessPort.connected === false) {
            return
          }
          // Without a callback, a close racing this send emits an unhandled IPC
          // error on process; try/catch at the caller cannot catch that event.
          childProcessPort.send?.(message, () => {
            /* Parent disconnected during cleanup. */
          })
        },
        start: () => {
          // Node.js child_process IPC does not require an explicit start call.
        },
      }
    }

    return {
      on: (event, listener) => {
        if (event === 'close') {
          port.on('close', () => listener({ data: undefined }))
          return
        }
        port.on('message', message => {
          listener({ data: message })
        })
      },
      postMessage: message => {
        port.postMessage(message)
      },
      start: () => {
        // Node.js worker_threads parentPort does not require an explicit start call.
      },
    }
  }

  return parentPort
}
