import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type {
  ControlSurfaceHttpListener,
  ControlSurfaceHttpListenerOptions,
  ControlSurfaceHttpListenerRequestContext,
} from './controlSurfaceHttpRuntime.contract'

const DEFAULT_REQUEST_DRAIN_TIMEOUT_MS = 30_000

export function createControlSurfaceHttpListener(options: {
  config: ControlSurfaceHttpListenerOptions
  isRuntimeClosed: () => boolean
  handleRequest: (input: {
    req: IncomingMessage
    res: ServerResponse
    listener: ControlSurfaceHttpListenerRequestContext
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
  const listenerConfig = { ...options.config }
  const listenAbortController = new AbortController()
  const inFlightRequests = new Map<Promise<void>, { req: IncomingMessage; res: ServerResponse }>()
  let accepting = options.config.startGated !== true
  let stopped = false
  let stopPromise: Promise<void> | null = null
  let stopSettled = false
  let disposedNotified = false
  let readySettled = false
  let webUiAuthRevision = 0
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

    const requestAuthRevision = webUiAuthRevision
    const operation = options
      .handleRequest({
        req,
        res,
        listener: {
          ...listenerConfig,
          webUiAuthRevision: requestAuthRevision,
          isWebUiAuthRevisionCurrent: () => webUiAuthRevision === requestAuthRevision,
        },
        listenerSyncClients,
      })
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
    inFlightRequests.set(operation, { req, res })
  })

  server.on('upgrade', (req, socket, head) => {
    if (stopped || !accepting || options.isRuntimeClosed()) {
      socket.destroy()
      return
    }
    options.handleUpgrade(req, socket, head, listenerConfig)
  })

  const notifyDisposed = (): void => {
    if (disposedNotified) {
      return
    }
    disposedNotified = true
    options.onDisposed(listener)
  }

  const closeStreamingClients = (): void => {
    for (const client of listenerSyncClients) {
      try {
        client.end()
      } catch {
        // ignore
      }
    }
    listenerSyncClients.clear()
    if (stopSettled) {
      notifyDisposed()
    }
  }

  const forceCloseInFlightRequests = (): void => {
    for (const { req, res } of inFlightRequests.values()) {
      try {
        req.destroy()
      } catch {
        // ignore
      }
      try {
        res.destroy()
      } catch {
        // ignore
      }
    }
  }

  const drainAcceptedRequests = async (): Promise<void> => {
    if (!stopped) {
      throw new Error('Control surface listener must stop admission before handler drain.')
    }
    await Promise.allSettled([...inFlightRequests.keys()])
  }

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
    updateWebUiPasswordHash: passwordHash => {
      listenerConfig.webUiPasswordHash = passwordHash
      webUiAuthRevision += 1
    },
    closeStreamingClients,
    drainAcceptedRequests,
    isAccepting: () => accepting && !stopped,
    stopAccepting: async stopOptions => {
      if (stopPromise) {
        return await stopPromise
      }

      accepting = false
      stopped = true
      webUiAuthRevision += 1
      listenAbortController.abort()
      if (stopOptions?.preserveStreamingClients !== true) {
        closeStreamingClients()
      }

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
      const drainTimeoutMs = Math.max(
        0,
        stopOptions?.drainTimeoutMs ?? DEFAULT_REQUEST_DRAIN_TIMEOUT_MS,
      )
      const acceptedRequests = [...inFlightRequests.keys()]
      const drain = new Promise<'drained' | 'timed_out'>(resolve => {
        if (acceptedRequests.length === 0) {
          resolve('drained')
          return
        }
        const timer = setTimeout(() => resolve('timed_out'), drainTimeoutMs)
        void Promise.allSettled(acceptedRequests).then(() => {
          clearTimeout(timer)
          resolve('drained')
        })
      })
      stopPromise = drain.then(outcome => {
        if (outcome === 'timed_out') {
          forceCloseInFlightRequests()
        }
        stopSettled = true
        if (listenerSyncClients.size === 0) {
          notifyDisposed()
        }
      })

      return await stopPromise
    },
    dispose: async () => await listener.stopAccepting(),
  }

  server.listen(
    {
      port: listenerConfig.port,
      host: listenerConfig.bindHostname,
      signal: listenAbortController.signal,
    },
    () => {
      if (stopped) {
        if (server.listening) {
          server.close(() => undefined)
        }
        return
      }
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
          hostname: listenerConfig.hostname,
          bindHostname: listenerConfig.bindHostname,
          port: address.port,
        })
        resolveReady = null
        rejectReady = null
      }
    },
  )

  return listener
}
