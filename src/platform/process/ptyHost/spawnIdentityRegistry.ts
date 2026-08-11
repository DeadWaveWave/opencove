export class PtyHostSpawnIdentityRegistry {
  private readonly sessionIdByLaunchId = new Map<string, string>()

  public findLiveSession(
    launchId: string,
    isSessionLive: (sessionId: string) => boolean,
  ): string | null {
    const sessionId = this.sessionIdByLaunchId.get(launchId) ?? null
    if (!sessionId) {
      return null
    }
    if (isSessionLive(sessionId)) {
      return sessionId
    }
    this.sessionIdByLaunchId.delete(launchId)
    return null
  }

  public bind(launchId: string, sessionId: string): void {
    const existingSessionId = this.sessionIdByLaunchId.get(launchId)
    if (existingSessionId && existingSessionId !== sessionId) {
      throw new Error(`PTY launch identity is already bound: ${launchId}`)
    }
    this.sessionIdByLaunchId.set(launchId, sessionId)
  }

  public release(launchId: string, sessionId: string): void {
    if (this.sessionIdByLaunchId.get(launchId) === sessionId) {
      this.sessionIdByLaunchId.delete(launchId)
    }
  }

  public clear(): void {
    this.sessionIdByLaunchId.clear()
  }
}
