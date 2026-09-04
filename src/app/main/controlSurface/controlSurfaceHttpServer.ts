import { removeConnectionFile, writeConnectionFile } from './http/connectionFile'
import type { RegisterControlSurfaceHttpServerOptions } from './controlSurfaceHttpServerOptions'
import { createControlSurfaceHttpRuntime } from './controlSurfaceHttpRuntime'
import {
  CONTROL_SURFACE_CONNECTION_VERSION,
  type ControlSurfaceConnectionInfo,
  type ControlSurfaceHttpServerInstance,
} from './controlSurfaceHttpServer.contract'

const DEFAULT_CONTROL_SURFACE_HOSTNAME = '127.0.0.1'
const DEFAULT_CONTROL_SURFACE_CONNECTION_FILE = 'control-surface.json'

export function registerControlSurfaceHttpServer(
  options: RegisterControlSurfaceHttpServerOptions,
): ControlSurfaceHttpServerInstance {
  const hostname = options.hostname ?? DEFAULT_CONTROL_SURFACE_HOSTNAME
  const bindHostname = options.bindHostname ?? hostname
  const connectionFileName = options.connectionFileName ?? DEFAULT_CONTROL_SURFACE_CONNECTION_FILE
  const runtime = createControlSurfaceHttpRuntime(options)
  const listener = runtime.listen({
    hostname,
    bindHostname,
    port: options.port ?? 0,
    role: 'combined',
    enableWebShell: options.enableWebShell === true,
    webUiPasswordHash: options.webUiPasswordHash ?? null,
  })

  let disposed = false
  let disposePromise: Promise<void> | null = null
  let pendingConnectionWrite: Promise<void> | null = null

  const ready = Promise.all([listener.ready, runtime.ready]).then(([address]) => {
    if (disposed) {
      throw new Error('Control Surface server disposed before becoming ready.')
    }
    const info: ControlSurfaceConnectionInfo = {
      version: CONTROL_SURFACE_CONNECTION_VERSION,
      pid: process.pid,
      hostname: address.hostname,
      port: address.port,
      token: runtime.token,
      createdAt: new Date().toISOString(),
      appVersion: runtime.appVersion,
      ...(options.connectionStartedBy ? { startedBy: options.connectionStartedBy } : {}),
    }

    pendingConnectionWrite = writeConnectionFile(
      options.userDataPath,
      info,
      connectionFileName,
    ).catch(error => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
      process.stderr.write(
        `[opencove] failed to write control surface connection file: ${detail}\n`,
      )
    })

    return info
  })

  return {
    ready,
    dispose: async () => {
      if (disposePromise) {
        return await disposePromise
      }

      disposePromise = (async () => {
        if (disposed) {
          return
        }
        disposed = true

        try {
          await pendingConnectionWrite
        } catch {
          // ignore
        }

        try {
          await removeConnectionFile(options.userDataPath, connectionFileName)
        } catch {
          // ignore
        }

        await runtime.dispose()
      })()

      return await disposePromise
    },
  }
}
