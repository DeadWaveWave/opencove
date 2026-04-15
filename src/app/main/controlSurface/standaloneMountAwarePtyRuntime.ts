import type { PtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import { createRemotePtyRuntime } from './remote/remotePtyRuntime'
import { invokeControlSurface } from './remote/controlSurfaceHttpClient'
import type { ControlSurfaceRemoteEndpointResolver } from './remote/controlSurfaceHttpClient'

type SessionRoute = 'local' | 'remote'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function extractSessionIds(value: unknown): string[] {
  if (!isRecord(value)) {
    return []
  }

  const sessions = value.sessions
  if (!Array.isArray(sessions)) {
    return []
  }

  const ids: string[] = []
  for (const session of sessions) {
    if (!isRecord(session)) {
      continue
    }

    const sessionId = session.sessionId
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      ids.push(sessionId)
    }
  }

  return ids
}

export function createStandaloneMountAwarePtyRuntime(options: {
  localRuntime: PtyRuntime
  endpointResolver: ControlSurfaceRemoteEndpointResolver
}): PtyRuntime {
  const remoteRuntime = createRemotePtyRuntime({ endpointResolver: options.endpointResolver })

  const routeBySessionId = new Map<string, SessionRoute>()
  const inFlightRouteBySessionId = new Map<string, Promise<SessionRoute>>()

  const resolveRoute = async (sessionId: string): Promise<SessionRoute> => {
    const cached = routeBySessionId.get(sessionId)
    if (cached) {
      return cached
    }

    const existingPromise = inFlightRouteBySessionId.get(sessionId)
    if (existingPromise) {
      return await existingPromise
    }

    const promise = (async (): Promise<SessionRoute> => {
      const endpoint = await options.endpointResolver()
      if (!endpoint) {
        return 'local'
      }

      const { httpStatus, result } = await invokeControlSurface(endpoint, {
        kind: 'query',
        id: 'session.list',
        payload: null,
      })

      if (httpStatus !== 200 || !result || result.ok !== true) {
        return 'local'
      }

      const listedSessionIds = extractSessionIds(result.value)
      return listedSessionIds.includes(sessionId) ? 'remote' : 'local'
    })()
      .catch(() => 'local' as const)
      .finally(() => {
        inFlightRouteBySessionId.delete(sessionId)
      })

    inFlightRouteBySessionId.set(sessionId, promise)

    const resolved = await promise
    routeBySessionId.set(sessionId, resolved)
    return resolved
  }

  const resolveRuntimeForSession = async (sessionId: string): Promise<PtyRuntime> => {
    const route = await resolveRoute(sessionId)
    return route === 'remote' ? remoteRuntime : options.localRuntime
  }

  return {
    listProfiles: options.localRuntime.listProfiles,
    spawnTerminalSession: options.localRuntime.spawnTerminalSession,
    spawnSession: options.localRuntime.spawnSession,
    write: async (sessionId, data, encoding) => {
      const runtime = await resolveRuntimeForSession(sessionId)
      await runtime.write(sessionId, data, encoding)
    },
    resize: async (sessionId, cols, rows) => {
      const runtime = await resolveRuntimeForSession(sessionId)
      await runtime.resize(sessionId, cols, rows)
    },
    kill: async sessionId => {
      const runtime = await resolveRuntimeForSession(sessionId)
      await runtime.kill(sessionId)
    },
    onData: listener => {
      const unsubscribeLocal = options.localRuntime.onData(listener)
      const unsubscribeRemote = remoteRuntime.onData(listener)
      return () => {
        unsubscribeLocal()
        unsubscribeRemote()
      }
    },
    onExit: listener => {
      const unsubscribeLocal = options.localRuntime.onExit(listener)
      const unsubscribeRemote = remoteRuntime.onExit(listener)
      return () => {
        unsubscribeLocal()
        unsubscribeRemote()
      }
    },
    attach: async (contentsId, sessionId) => {
      const runtime = await resolveRuntimeForSession(sessionId)
      await runtime.attach(contentsId, sessionId)
    },
    detach: async (contentsId, sessionId) => {
      const runtime = await resolveRuntimeForSession(sessionId)
      await runtime.detach(contentsId, sessionId)
    },
    snapshot: async sessionId => {
      const runtime = await resolveRuntimeForSession(sessionId)
      return await runtime.snapshot(sessionId)
    },
    startSessionStateWatcher: input => {
      options.localRuntime.startSessionStateWatcher(input)
    },
    ...(options.localRuntime.debugCrashHost
      ? {
          debugCrashHost: () => {
            options.localRuntime.debugCrashHost?.()
          },
        }
      : {}),
    dispose: () => {
      remoteRuntime.dispose()
      options.localRuntime.dispose()
    },
  }
}
