import { randomUUID } from 'node:crypto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { RemotePtyEndpointProxy } from './remotePtyEndpointProxy'

type RemoteSessionRoute = {
  kind: 'remote'
  endpointId: string
  remoteSessionId: string
}

type LocalSessionRoute = {
  kind: 'local'
}

type SessionRoute = LocalSessionRoute | RemoteSessionRoute

export type MultiEndpointPtyRuntime = ControlSurfacePtyRuntime & {
  registerRemoteSession: (options: { endpointId: string; remoteSessionId: string }) => string
  dispose: () => void
}

export function createMultiEndpointPtyRuntime(options: {
  localRuntime: ControlSurfacePtyRuntime & { dispose?: () => void }
  topology: WorkerTopologyStore
  disposeLocalRuntime: boolean
}): MultiEndpointPtyRuntime {
  const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()

  const routes = new Map<string, SessionRoute>()
  const homeSessionIdByRemote = new Map<string, string>()
  const remoteByHomeSessionId = new Map<string, { endpointId: string; remoteSessionId: string }>()

  const proxiesByEndpointId = new Map<string, RemotePtyEndpointProxy>()

  const getProxy = (endpointId: string): RemotePtyEndpointProxy => {
    const existing = proxiesByEndpointId.get(endpointId)
    if (existing) {
      return existing
    }

    const created = new RemotePtyEndpointProxy({
      endpointId,
      topology: options.topology,
      emitData: (remoteSessionId, data) => {
        const homeSessionId = homeSessionIdByRemote.get(`${endpointId}:${remoteSessionId}`)
        if (!homeSessionId) {
          return
        }
        dataListeners.forEach(listener => listener({ sessionId: homeSessionId, data }))
      },
      emitExit: (remoteSessionId, exitCode) => {
        const remoteKey = `${endpointId}:${remoteSessionId}`
        const homeSessionId = homeSessionIdByRemote.get(remoteKey)
        if (!homeSessionId) {
          return
        }

        homeSessionIdByRemote.delete(remoteKey)
        remoteByHomeSessionId.delete(homeSessionId)
        routes.delete(homeSessionId)
        created.forget(remoteSessionId)

        exitListeners.forEach(listener => listener({ sessionId: homeSessionId, exitCode }))
      },
    })

    proxiesByEndpointId.set(endpointId, created)
    return created
  }

  const disposeLocalDataListener = options.localRuntime.onData(event => {
    dataListeners.forEach(listener => listener(event))
  })

  const disposeLocalExitListener = options.localRuntime.onExit(event => {
    exitListeners.forEach(listener => listener(event))
  })

  return {
    spawnSession: async spawnOptions => {
      const { sessionId } = await options.localRuntime.spawnSession(spawnOptions)
      routes.set(sessionId, { kind: 'local' })
      return { sessionId }
    },
    registerRemoteSession: ({ endpointId, remoteSessionId }) => {
      const homeSessionId = randomUUID()
      routes.set(homeSessionId, { kind: 'remote', endpointId, remoteSessionId })
      homeSessionIdByRemote.set(`${endpointId}:${remoteSessionId}`, homeSessionId)
      remoteByHomeSessionId.set(homeSessionId, { endpointId, remoteSessionId })

      const proxy = getProxy(endpointId)
      proxy.attach(remoteSessionId)

      return homeSessionId
    },
    write: (sessionId, data) => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.write(sessionId, data)
        return
      }

      getProxy(route.endpointId).write(route.remoteSessionId, data)
    },
    resize: (sessionId, cols, rows) => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.resize(sessionId, cols, rows)
        return
      }

      getProxy(route.endpointId).resize(route.remoteSessionId, cols, rows)
    },
    kill: sessionId => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.kill(sessionId)
        return
      }

      getProxy(route.endpointId).kill(route.remoteSessionId)
    },
    onData: listener => {
      dataListeners.add(listener)
      return () => {
        dataListeners.delete(listener)
      }
    },
    onExit: listener => {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    startSessionStateWatcher: input => {
      options.localRuntime.startSessionStateWatcher?.(input)
    },
    dispose: () => {
      disposeLocalDataListener()
      disposeLocalExitListener()

      for (const proxy of proxiesByEndpointId.values()) {
        proxy.dispose()
      }
      proxiesByEndpointId.clear()

      routes.clear()
      homeSessionIdByRemote.clear()
      remoteByHomeSessionId.clear()

      if (options.disposeLocalRuntime) {
        try {
          options.localRuntime.dispose?.()
        } catch {
          // ignore
        }
      }
    },
  }
}
