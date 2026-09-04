type PendingSessionEvents = {
  data: string[]
  exitCode: number | null
}

export class PtyHostSessionEventOwner {
  private readonly activeSessionIds = new Set<string>()
  private readonly terminatingSessionIds = new Set<string>()
  private readonly completedSessionIds = new Set<string>()
  private readonly pendingBySessionId = new Map<string, PendingSessionEvents>()

  public constructor(
    private readonly callbacks: {
      emitData: (event: { sessionId: string; data: string }) => void
      emitExit: (event: { sessionId: string; exitCode: number }) => void
      retireUnowned: (sessionId: string) => void
    },
  ) {}

  public has(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId)
  }

  public resolveSpawn(sessionId: string, accepted: boolean): void {
    if (accepted) {
      this.activate(sessionId)
      return
    }
    if (
      this.activeSessionIds.has(sessionId) ||
      this.terminatingSessionIds.has(sessionId) ||
      this.completedSessionIds.has(sessionId)
    ) {
      return
    }
    this.retire(sessionId)
    this.callbacks.retireUnowned(sessionId)
  }

  public activate(sessionId: string): void {
    if (this.terminatingSessionIds.has(sessionId)) {
      return
    }
    if (this.completedSessionIds.has(sessionId)) {
      this.callbacks.retireUnowned(sessionId)
      return
    }
    this.activeSessionIds.add(sessionId)
    const pending = this.pendingBySessionId.get(sessionId)
    this.pendingBySessionId.delete(sessionId)
    if (!pending) {
      return
    }
    for (const data of pending.data) {
      this.callbacks.emitData({ sessionId, data })
    }
    if (pending.exitCode !== null) {
      this.activeSessionIds.delete(sessionId)
      this.completedSessionIds.add(sessionId)
      this.callbacks.emitExit({ sessionId, exitCode: pending.exitCode })
    }
  }

  public observeData(event: { sessionId: string; data: string }): void {
    if (this.completedSessionIds.has(event.sessionId)) {
      return
    }
    if (
      this.activeSessionIds.has(event.sessionId) ||
      this.terminatingSessionIds.has(event.sessionId)
    ) {
      this.callbacks.emitData(event)
      return
    }
    const pending = this.getOrCreatePending(event.sessionId)
    if (pending.exitCode === null) {
      pending.data.push(event.data)
    }
  }

  public observeExit(event: { sessionId: string; exitCode: number }): void {
    if (this.completedSessionIds.has(event.sessionId)) {
      return
    }
    if (
      this.activeSessionIds.delete(event.sessionId) ||
      this.terminatingSessionIds.delete(event.sessionId)
    ) {
      this.completedSessionIds.add(event.sessionId)
      this.callbacks.emitExit(event)
      return
    }
    this.getOrCreatePending(event.sessionId).exitCode = event.exitCode
  }

  public beginTermination(sessionId: string): boolean {
    if (!this.activeSessionIds.delete(sessionId)) {
      return false
    }
    this.terminatingSessionIds.add(sessionId)
    return true
  }

  public retire(sessionId: string): void {
    this.activeSessionIds.delete(sessionId)
    this.terminatingSessionIds.delete(sessionId)
    this.pendingBySessionId.delete(sessionId)
    this.completedSessionIds.add(sessionId)
  }

  public failAll(exitCode: number): void {
    const ownedSessionIds = new Set([...this.activeSessionIds, ...this.terminatingSessionIds])
    for (const sessionId of ownedSessionIds) {
      this.callbacks.emitExit({ sessionId, exitCode })
    }
    this.clear()
  }

  public clear(): void {
    this.activeSessionIds.clear()
    this.terminatingSessionIds.clear()
    this.completedSessionIds.clear()
    this.pendingBySessionId.clear()
  }

  private getOrCreatePending(sessionId: string): PendingSessionEvents {
    const existing = this.pendingBySessionId.get(sessionId)
    if (existing) {
      return existing
    }
    const created = { data: [], exitCode: null }
    this.pendingBySessionId.set(sessionId, created)
    return created
  }
}
