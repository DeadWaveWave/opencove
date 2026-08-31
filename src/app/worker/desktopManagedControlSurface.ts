import {
  removeConnectionFile,
  writeConnectionFile,
} from '../main/controlSurface/http/connectionFile'
import type { RegisterControlSurfaceHttpServerOptions } from '../main/controlSurface/controlSurfaceHttpServerOptions'
import { createControlSurfaceHttpRuntime } from '../main/controlSurface/controlSurfaceHttpRuntime'
import {
  CONTROL_SURFACE_CONNECTION_VERSION,
  type ControlSurfaceConnectionInfo,
  type ControlSurfaceHttpServerInstance,
} from '../main/controlSurface/controlSurfaceHttpServer.contract'
import {
  mutateHomeWorkerConfigFile,
  type HomeWorkerConfigFile,
  type HomeWorkerConfigModeOptions,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import { createWorkerWebAccessRuntime } from './workerWebAccessRuntime'
import { createWorkerConfigurationOwner } from './workerConfigurationOwner'
import { registerWorkerConfigurationHandlers } from './workerConfigurationHandlers'

export interface DesktopManagedControlSurface extends ControlSurfaceHttpServerInstance {
  getWebAccessStatus: ReturnType<typeof createWorkerWebAccessRuntime>['status']
}

export function createDesktopManagedControlSurface(options: {
  server: RegisterControlSurfaceHttpServerOptions
  initialConfig: HomeWorkerConfigFile
  configOptions?: HomeWorkerConfigModeOptions
}): DesktopManagedControlSurface {
  const connectionFileName = options.server.connectionFileName ?? 'control-surface.json'
  const runtime = createControlSurfaceHttpRuntime({
    ...options.server,
    enableWebShell: false,
    webUiPasswordHash: null,
  })
  const webAccess = createWorkerWebAccessRuntime({
    controlSurfaceRuntime: runtime,
    initialConfig: options.initialConfig,
    persist: async ({ next, expectedUpdatedAt }) =>
      await mutateHomeWorkerConfigFile({
        userDataPath: options.server.userDataPath,
        configOptions: options.configOptions,
        expectedUpdatedAt,
        mutate: () => next,
      }),
  })
  const configurationOwner = createWorkerConfigurationOwner({
    userDataPath: options.server.userDataPath,
    configOptions: options.configOptions,
    webAccess,
  })
  runtime.registerHandlers(controlSurface => {
    registerWorkerConfigurationHandlers(controlSurface, configurationOwner)
  })

  const privateListener = runtime.listen({
    hostname: '127.0.0.1',
    bindHostname: '127.0.0.1',
    port: 0,
    role: 'private',
    enableWebShell: false,
    webUiPasswordHash: null,
  })
  let pendingConnectionWrite: Promise<void> | null = null
  let disposePromise: Promise<void> | null = null
  let disposed = false

  const ready = Promise.all([privateListener.ready, runtime.ready, webAccess.ready]).then(
    ([address]) => {
      if (disposed) {
        throw new Error('Desktop-managed Control Surface disposed before becoming ready.')
      }
      const info: ControlSurfaceConnectionInfo = {
        version: CONTROL_SURFACE_CONNECTION_VERSION,
        pid: process.pid,
        hostname: address.hostname,
        port: address.port,
        token: runtime.token,
        createdAt: new Date().toISOString(),
        appVersion: runtime.appVersion,
        startedBy: 'desktop',
      }
      pendingConnectionWrite = writeConnectionFile(
        options.server.userDataPath,
        info,
        connectionFileName,
      ).catch(error => {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        process.stderr.write(
          `[opencove] failed to write private control connection file: ${detail}\n`,
        )
      })
      return info
    },
  )

  return {
    ready,
    getWebAccessStatus: webAccess.status,
    dispose: async () => {
      if (disposePromise) {
        return await disposePromise
      }
      disposed = true
      disposePromise = (async () => {
        await pendingConnectionWrite?.catch(() => undefined)
        await removeConnectionFile(options.server.userDataPath, connectionFileName).catch(
          () => undefined,
        )
        await webAccess.dispose()
        await runtime.dispose()
      })()
      return await disposePromise
    },
  }
}
