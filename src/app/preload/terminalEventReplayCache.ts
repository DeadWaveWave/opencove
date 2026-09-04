import type {
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  TerminalSessionStateSource,
} from '../../shared/contracts/dto'

const DEFAULT_MAX_TERMINAL_SESSIONS = 256

function normalizeSessionId(value: string): string | null {
  const sessionId = value.trim()
  return sessionId.length > 0 ? sessionId : null
}

function normalizeSource(value: TerminalSessionStateEvent['source']): TerminalSessionStateSource {
  return value === 'launch' ||
    value === 'session_file' ||
    value === 'claude_hook' ||
    value === 'codex_hook'
    ? value
    : 'session_file'
}

export class TerminalEventReplayCache {
  private readonly maxSessions: number
  private readonly stateBySessionId = new Map<
    string,
    Map<TerminalSessionStateSource, TerminalSessionStateEvent>
  >()
  private readonly metadataBySessionId = new Map<string, TerminalSessionMetadataEvent>()
  private readonly sessionRecency = new Map<string, true>()

  public constructor(options: { maxSessions?: number } = {}) {
    const configured = options.maxSessions ?? DEFAULT_MAX_TERMINAL_SESSIONS
    if (!Number.isSafeInteger(configured) || configured < 1) {
      throw new Error('Terminal event replay cache size must be a positive integer.')
    }
    this.maxSessions = configured
  }

  public registerState(event: TerminalSessionStateEvent): void {
    const sessionId = normalizeSessionId(event.sessionId)
    if (!sessionId) {
      return
    }
    const source = normalizeSource(event.source)
    const states = this.stateBySessionId.get(sessionId) ?? new Map()
    states.set(source, { ...event, sessionId, source })
    this.stateBySessionId.set(sessionId, states)
    this.touch(sessionId)
  }

  public registerMetadata(event: TerminalSessionMetadataEvent): void {
    const sessionId = normalizeSessionId(event.sessionId)
    if (!sessionId) {
      return
    }
    this.metadataBySessionId.set(sessionId, {
      ...event,
      sessionId,
      ...(event.terminalAgentActivity
        ? { terminalAgentActivity: { ...event.terminalAgentActivity } }
        : {}),
    })
    this.touch(sessionId)
  }

  public replayStates(listener: (event: TerminalSessionStateEvent) => void): void {
    this.stateBySessionId.forEach(states => {
      ;[...states.values()]
        .sort((left, right) => (left.observedAtMs ?? 0) - (right.observedAtMs ?? 0))
        .forEach(event => listener({ ...event }))
    })
  }

  public replayMetadata(listener: (event: TerminalSessionMetadataEvent) => void): void {
    this.metadataBySessionId.forEach(event => {
      listener({
        ...event,
        ...(event.terminalAgentActivity
          ? { terminalAgentActivity: { ...event.terminalAgentActivity } }
          : {}),
      })
    })
  }

  public disposeSession(sessionIdInput: string): void {
    const sessionId = normalizeSessionId(sessionIdInput)
    if (!sessionId) {
      return
    }
    this.stateBySessionId.delete(sessionId)
    this.metadataBySessionId.delete(sessionId)
    this.sessionRecency.delete(sessionId)
  }

  public clear(): void {
    this.stateBySessionId.clear()
    this.metadataBySessionId.clear()
    this.sessionRecency.clear()
  }

  private touch(sessionId: string): void {
    this.sessionRecency.delete(sessionId)
    this.sessionRecency.set(sessionId, true)
    while (this.sessionRecency.size > this.maxSessions) {
      const oldest = this.sessionRecency.keys().next().value
      if (typeof oldest !== 'string') {
        return
      }
      this.disposeSession(oldest)
    }
  }
}
