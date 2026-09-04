import type { Server, ServerResponse } from 'node:http'

export function registerHttpResponseShutdownDrain(options: {
  server: Server
  response: ServerResponse
  isClosing: () => boolean
}): void {
  const closeIdleIfShuttingDown = (): void => {
    if (options.isClosing()) {
      options.server.closeIdleConnections()
    }
  }
  options.response.once('finish', closeIdleIfShuttingDown)
  options.response.once('close', closeIdleIfShuttingDown)
}

export async function closeHttpServerAfterActiveRequests(server: Server): Promise<void> {
  await new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeIdleConnections()
  })
}
