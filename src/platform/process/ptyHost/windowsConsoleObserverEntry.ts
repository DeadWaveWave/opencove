import {
  assertWindowsConsoleGeometryAvailable,
  readWindowsConsoleGeometry,
} from 'node-pty/lib/windowsConsoleGeometry'
import { isWindowsConsoleRequest, type WindowsConsoleResponse } from './windowsConsoleProtocol'

function send(message: WindowsConsoleResponse): void {
  if (!process.connected) {
    process.exit(0)
  }
  process.send?.(message, error => {
    if (error) {
      process.exit(1)
    }
  })
}

function errorMessage(error: unknown): string {
  return (
    (error instanceof Error ? error.message : String(error)).slice(0, 1_024) ||
    'Console query failed'
  )
}

// AttachConsole changes process-global state. This child never owns a shell or writes to a PTY.
process.once('disconnect', () => process.exit(0))
process.on('message', message => {
  if (!isWindowsConsoleRequest(message)) {
    return
  }
  try {
    const { cols, rows } = readWindowsConsoleGeometry(message.pid)
    send({ type: 'geometry', requestId: message.requestId, geometry: { cols, rows } })
  } catch (error) {
    send({ type: 'error', requestId: message.requestId, error: errorMessage(error) })
  }
})

try {
  assertWindowsConsoleGeometryAvailable()
  send({ type: 'ready' })
} catch (error) {
  send({ type: 'unavailable', error: errorMessage(error) })
}
