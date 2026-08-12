import type { TerminalSessionStateEvent, TerminalSessionStateSource } from '@shared/contracts/dto'

export class BrowserPtyClientStateReplay {
  private readonly stateBySessionId = new Map<
    string,
    Map<TerminalSessionStateSource, TerminalSessionStateEvent>
  >()

  public register(event: TerminalSessionStateEvent): void {
    const source = event.source ?? 'session_file'
    const stateBySource = this.stateBySessionId.get(event.sessionId) ?? new Map()
    stateBySource.set(source, { ...event, source })
    this.stateBySessionId.set(event.sessionId, stateBySource)
  }

  public replay(listener: (event: TerminalSessionStateEvent) => void): void {
    this.stateBySessionId.forEach(stateBySource => {
      ;[...stateBySource.values()]
        .sort((left, right) => (left.observedAtMs ?? 0) - (right.observedAtMs ?? 0))
        .forEach(event => listener(event))
    })
  }

  public disposeSession(sessionId: string): void {
    this.stateBySessionId.delete(sessionId)
  }
}
