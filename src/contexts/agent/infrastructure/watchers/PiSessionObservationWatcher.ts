import type { PiAgentSnapshot } from '../../../../shared/contracts/dto/piAgentSnapshot'
import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'
import { PiSessionStateWatcher } from './PiSessionStateWatcher'

/** Credential-owned fallback. Never discovers a neighbour's session by cwd/time. */
export class PiSessionObservationWatcher {
  private current: { key: string; watcher: PiSessionStateWatcher | null } | null = null
  private disposed = false

  constructor(
    private readonly options: {
      sessionId: string
      onState: (event: TerminalSessionStateEvent) => void
      createWatcher?: (
        options: ConstructorParameters<typeof PiSessionStateWatcher>[0],
      ) => PiSessionStateWatcher
    },
  ) {}

  observe(snapshot: PiAgentSnapshot): void {
    if (this.disposed) {
      return
    }
    const key = `${snapshot.pid}:${snapshot.conversationRevision}`
    if (this.current?.key !== key) {
      this.current?.watcher?.dispose()
      this.current = { key, watcher: null }
    }
    const current = this.current
    if (current.watcher || snapshot.persistence !== 'resumable' || !snapshot.sessionFile) {
      return
    }
    const retire = () => {
      if (this.current !== current || current.watcher !== watcher) {
        return
      }
      current.watcher?.dispose()
      current.watcher = null
      this.options.onState({
        sessionId: this.options.sessionId,
        state: snapshot.state,
        source: 'session_file',
        observationUnavailable: true,
        degraded: true,
        piConversation: { pid: snapshot.pid, revision: snapshot.conversationRevision },
      })
    }
    const createWatcher =
      this.options.createWatcher ?? (options => new PiSessionStateWatcher(options))
    const watcher = createWatcher({
      sessionId: this.options.sessionId,
      filePath: snapshot.sessionFile,
      onState: (sessionId, state) => {
        if (this.disposed || this.current !== current || current.watcher !== watcher) {
          return
        }
        this.options.onState({
          sessionId,
          state,
          source: 'session_file',
          degraded: true,
          piConversation: { pid: snapshot.pid, revision: snapshot.conversationRevision },
        })
      },
      onUnavailable: retire,
      onError: retire,
    })
    current.watcher = watcher
    watcher.start()
  }

  dispose(): void {
    this.disposed = true
    this.current?.watcher?.dispose()
    this.current = null
  }
}
