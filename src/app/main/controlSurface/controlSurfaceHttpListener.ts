import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type {
  ControlSurfaceHttpListener,
  ControlSurfaceHttpListenerOptions,
} from './controlSurfaceHttpRuntime.contract'

export function createControlSurfaceHttpListener(options: {
  config: ControlSurfaceHttpListenerOptions
  isRuntimeClosed: () => boolean
  handleRequest: (input: {
    req: IncomingMessage
    res: ServerResponse
    listener: ControlSurfaceHttpListenerOptions
    listenerSyncClients: Set<ServerResponse>
  }) => Promise<void>
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    listener: ControlSurfaceHttpListenerOptions,
  ) => void
  onDisposed: (listener: ControlSurfaceHttpListener) => void
}): ControlSurfaceHttpListener {
  const listenerSyncClients = new Set<ServerResponse>()
  const inFlightRequests = new Set<Promise<void>>()
  let accepting = options.config.startGated !== true
  let stopped = false
  let stopPromise: Promise<void> | null = null
  let readySettled = false
  let resolveReady:
    | ((value: { hostname: string; bindHostname: string; port: number }) => void)
    | null = null
  let rejectReady: ((error: Error) => void) | null = null

  const ready = new Promise<{ hostname: string; bindHostname: string; port: number }>(
    (resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise
      rejectReady = rejectPromise
    },
  )

  const server = createServer((req, res) => {
    if (stopped || !accepting || options.isRuntimeClosed()) {
      res.statusCode = 503
      res.end()
      return
    }

    const operation = options
      .handleRequest({ req, res, listener: options.config, listenerSyncClients })
      .catch(error => {
        if (res.headersSent) {
          try {
            res.end()
          } catch {
            // ignore
          }
          return
        }
        res.statusCode = 500
        res.end()
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        process.stderr.write(`[opencove] control surface request failed: ${detail}\n`)
      })
      .finally(() => {
        inFlightRequests.delete(operation)
      })
    inFlightRequests.add(operation)
  })

  server.on('upgrade', (req, socket, head) => {
    if (stopped || !accepting || options.isRuntimeClosed()) {
      socket.destroy()
      return
    }
    options.handleUpgrade(req, socket, head, options.config)
  })

  server.on('error', error => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    process.stderr.write(`[opencove] control surface listener error: ${detail}\n`)
    if (!readySettled) {
      readySettled = true
      rejectReady?.(new Error(detail))
      rejectReady = null
      resolveReady = null
    }
  })

  const listener: ControlSurfaceHttpListener = {
    ready,
    activate: () => {
      if (!stopped) {
        accepting = true
      }
    },
    isAccepting: () => accepting && !stopped,
    stopAccepting: async () => {
      if (stopPromise) {
        return await stopPromise
      }

      accepting = false
      stopped = true
      for (const client of listenerSyncClients) {
        try {
          client.end()
        } catch {
          // ignore
        }
      }
      listenerSyncClients.clear()

      if (!readySettled) {
        readySettled = true
        rejectReady?.(new Error('Control surface listener stopped before becoming ready.'))
        rejectReady = null
        resolveReady = null
      }

      // Node releases the listening handle when close() is requested, but its callback waits for
      // upgraded sockets. Those sockets belong to the shared PTY stream service and intentionally
      // outlive this listener generation, so listener retirement must not await that callback.
      if (server.listening) {
        server.close(() => undefined)
      }
      stopPromise = Promise.allSettled([...inFlightRequests]).then(() => {
        options.onDisposed(listener)
      })

      return await stopPromise
    },
    dispose: async () => await listener.stopAccepting(),
  }

  server.listen(options.config.port, options.config.bindHostname, () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      const detail = 'Control surface listener did not return a TCP address.'
      if (!readySettled) {
        readySettled = true
        rejectReady?.(new Error(detail))
        rejectReady = null
        resolveReady = null
      }
      return
    }

    if (!readySettled) {
      readySettled = true
      resolveReady?.({
        hostname: options.config.hostname,
        bindHostname: options.config.bindHostname,
        port: address.port,
      })
      resolveReady = null
      rejectReady = null
    }
  })

  return listener
}
