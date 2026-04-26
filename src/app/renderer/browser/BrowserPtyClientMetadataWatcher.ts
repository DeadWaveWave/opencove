import type { TerminalSessionMetadataEvent } from '@shared/contracts/dto'
import { invokeBrowserControlSurface } from './browserControlSurface'

type MetadataWatcherState = {
  timer: number | null
  attempt: number
  cancelled: boolean
}

export class BrowserPtyClientMetadataWatcher {
  private readonly watchers = new Map<string, MetadataWatcherState>()

  public constructor(
    private readonly options: {
      hasListeners: () => boolean
      emit: (event: TerminalSessionMetadataEvent) => void
    },
  ) {}

  public cancel(sessionId: string): void {
    const watcher = this.watchers.get(sessionId)
    if (!watcher) {
      return
    }

    watcher.cancelled = true
    if (watcher.timer !== null) {
      window.clearTimeout(watcher.timer)
      watcher.timer = null
    }

    this.watchers.delete(sessionId)
  }

  public ensure(sessionId: string): void {
    if (!this.options.hasListeners()) {
      return
    }

    const normalizedSessionId = sessionId.trim()
    if (normalizedSessionId.length === 0 || this.watchers.has(normalizedSessionId)) {
      return
    }

    const watcher: MetadataWatcherState = {
      timer: null,
      attempt: 0,
      cancelled: false,
    }
    this.watchers.set(normalizedSessionId, watcher)

    const attemptResolve = async (): Promise<void> => {
      if (watcher.cancelled) {
        return
      }

      try {
        await invokeBrowserControlSurface({
          kind: 'query',
          id: 'session.get',
          payload: { sessionId: normalizedSessionId },
        })
      } catch {
        this.cancel(normalizedSessionId)
        return
      }

      try {
        const final = await invokeBrowserControlSurface<{ resumeSessionId: string | null }>({
          kind: 'query',
          id: 'session.finalMessage',
          payload: { sessionId: normalizedSessionId },
        })

        const resumeSessionId =
          typeof final.resumeSessionId === 'string' && final.resumeSessionId.trim().length > 0
            ? final.resumeSessionId.trim()
            : null

        if (resumeSessionId) {
          this.options.emit({
            sessionId: normalizedSessionId,
            resumeSessionId,
          })
          this.cancel(normalizedSessionId)
          return
        }
      } catch {
        // Ignore session.finalMessage failures; retry with backoff.
      }

      if (watcher.attempt >= 6) {
        this.cancel(normalizedSessionId)
        return
      }

      const delayMs = Math.min(750 * 2 ** watcher.attempt, 6_000)
      watcher.attempt += 1
      watcher.timer = window.setTimeout(() => {
        watcher.timer = null
        void attemptResolve()
      }, delayMs)
    }

    void attemptResolve()
  }
}
