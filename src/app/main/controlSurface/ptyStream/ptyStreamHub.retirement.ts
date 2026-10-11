import type { ClientState, SessionState } from './ptyStreamState'

/** Recent ephemeral identities only; ordinary terminal forget/restore never enters this fence. */
export class PtyStreamRetiredSessions {
  private readonly identities = new Set<string>()

  constructor(private readonly capacity = 4096) {}

  retire(sessionId: string): void {
    this.identities.delete(sessionId)
    this.identities.add(sessionId)
    if (this.identities.size > this.capacity) {
      this.identities.delete(this.identities.values().next().value!)
    }
  }

  has(sessionId: string): boolean {
    if (!this.identities.has(sessionId)) {
      return false
    }
    // Keep still-arriving streams fenced while bounding idle retirement history per hub.
    this.retire(sessionId)
    return true
  }
}

export function forgetPtyStreamSession(
  sessionId: string,
  sessions: Map<string, SessionState>,
  clients: Map<string, ClientState>,
): void {
  const session = sessions.get(sessionId)
  if (!session) {
    return
  }
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
  for (const clientId of session.subscribers) {
    clients.get(clientId)?.rolesBySessionId.delete(sessionId)
  }
  session.presentationSession.dispose()
  sessions.delete(sessionId)
}
