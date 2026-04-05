import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { ControlSurfaceRemoteEndpointResolver } from './controlSurfaceHttpClient'
import { invokeControlSurface } from './controlSurfaceHttpClient'

type AgentMetadataWatcher = {
  timer: NodeJS.Timeout | null
  attempt: number
  cancelled: boolean
}

type SendToSessionSubscribers = (sessionId: string, channel: string, payload: unknown) => void

export function createRemotePtyRuntimeAgentMetadataWatcher(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  sendToSessionSubscribers: SendToSessionSubscribers
}): {
  ensure: (sessionId: string) => void
  cancel: (sessionId: string) => void
  dispose: () => void
} {
  const metadataWatchers = new Map<string, AgentMetadataWatcher>()

  const cancel = (sessionId: string): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    const watcher = metadataWatchers.get(normalizedSessionId)
    if (!watcher) {
      return
    }

    watcher.cancelled = true
    if (watcher.timer) {
      clearTimeout(watcher.timer)
      watcher.timer = null
    }

    metadataWatchers.delete(normalizedSessionId)
  }

  const ensure = (sessionId: string): void => {
    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0) {
      return
    }

    if (metadataWatchers.has(normalizedSessionId)) {
      return
    }

    const watcher: AgentMetadataWatcher = { timer: null, attempt: 0, cancelled: false }
    metadataWatchers.set(normalizedSessionId, watcher)

    const attemptResolve = async (): Promise<void> => {
      if (watcher.cancelled) {
        return
      }

      const endpoint = await options.endpointResolver()
      if (!endpoint) {
        cancel(normalizedSessionId)
        return
      }

      try {
        const { httpStatus, result } = await invokeControlSurface(endpoint, {
          kind: 'query',
          id: 'session.get',
          payload: { sessionId: normalizedSessionId },
        })

        if (httpStatus !== 200 || !result || result.ok !== true) {
          cancel(normalizedSessionId)
          return
        }
      } catch {
        cancel(normalizedSessionId)
        return
      }

      try {
        const { httpStatus, result } = await invokeControlSurface(endpoint, {
          kind: 'query',
          id: 'session.finalMessage',
          payload: { sessionId: normalizedSessionId },
        })

        if (httpStatus === 200 && result && result.ok === true) {
          const resumeSessionIdRaw = (result.value as { resumeSessionId?: unknown }).resumeSessionId
          const resumeSessionId =
            typeof resumeSessionIdRaw === 'string' && resumeSessionIdRaw.trim().length > 0
              ? resumeSessionIdRaw.trim()
              : null

          if (resumeSessionId) {
            options.sendToSessionSubscribers(normalizedSessionId, IPC_CHANNELS.ptySessionMetadata, {
              sessionId: normalizedSessionId,
              resumeSessionId,
            })
            cancel(normalizedSessionId)
            return
          }
        }
      } catch {
        // Ignore session.finalMessage failures; we will retry with backoff.
      }

      if (watcher.attempt >= 6) {
        cancel(normalizedSessionId)
        return
      }

      const delayMs = Math.min(750 * 2 ** watcher.attempt, 6_000)
      watcher.attempt += 1
      watcher.timer = setTimeout(() => {
        watcher.timer = null
        void attemptResolve()
      }, delayMs)
    }

    void attemptResolve()
  }

  const dispose = (): void => {
    metadataWatchers.forEach(watcher => {
      watcher.cancelled = true
      if (watcher.timer) {
        clearTimeout(watcher.timer)
      }
    })
    metadataWatchers.clear()
  }

  return { ensure, cancel, dispose }
}
