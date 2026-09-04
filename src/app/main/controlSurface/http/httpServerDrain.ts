import type { Server, ServerResponse } from 'node:http'

export class HttpAcceptedRequestDrainOwner {
  private activeCount = 0
  private draining = false
  private readonly drainWaiters = new Set<() => void>()

  public accept(operation: Promise<void>): Promise<void> {
    if (this.draining) {
      return operation
    }
    this.activeCount += 1
    return operation.finally(() => {
      this.activeCount -= 1
      if (this.activeCount === 0) {
        this.drainWaiters.forEach(resolve => resolve())
        this.drainWaiters.clear()
      }
    })
  }

  public async drainAccepted(): Promise<void> {
    this.draining = true
    if (this.activeCount === 0) {
      return
    }
    await new Promise<void>(resolve => {
      this.drainWaiters.add(resolve)
    })
  }
}

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

export async function closeHttpServerConnections(server: Server): Promise<void> {
  await new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeIdleConnections()
  })
}
