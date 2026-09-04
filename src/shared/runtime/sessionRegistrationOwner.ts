export type SessionRegistrationDisposition = 'active' | 'completed' | 'owner_disposed'

export class SessionRegistrationRejectedError extends Error {
  public constructor(
    public readonly sessionId: string,
    public readonly disposition: Exclude<SessionRegistrationDisposition, 'active'>,
  ) {
    super(
      disposition === 'completed'
        ? `[pty] session ${sessionId} completed before spawn registration`
        : `[pty] session ${sessionId} lost its owner before spawn registration`,
    )
    this.name = 'SessionRegistrationRejectedError'
  }
}

export interface SessionRegistrationAttempt {
  complete: (sessionId: string) => SessionRegistrationDisposition
  cancel: () => void
}

/**
 * Serializes session completion against the post-spawn registration gap.
 *
 * A runtime can publish data and exit before its spawn promise settles. Callers begin an
 * attempt before spawning, report every completion, and synchronously complete registration
 * before installing state that must not outlive an already-completed session.
 */
export class SessionRegistrationOwner {
  private readonly activeSessionIds = new Set<string>()
  private readonly completedBeforeRegistration = new Set<string>()
  private pendingAttemptCount = 0
  private disposed = false

  public begin(): SessionRegistrationAttempt {
    if (this.disposed) {
      throw new Error('[pty] session registration owner is disposed')
    }

    this.pendingAttemptCount += 1
    let pending = true

    const settle = (): void => {
      if (!pending) {
        throw new Error('[pty] session registration attempt is already settled')
      }
      pending = false
      this.pendingAttemptCount -= 1
    }

    return {
      complete: sessionId => {
        settle()

        let disposition: SessionRegistrationDisposition
        if (this.disposed) {
          disposition = 'owner_disposed'
        } else if (this.completedBeforeRegistration.delete(sessionId)) {
          disposition = 'completed'
        } else {
          this.activeSessionIds.add(sessionId)
          disposition = 'active'
        }

        this.clearUnclaimedCompletionsWhenSettled()
        return disposition
      },
      cancel: () => {
        settle()
        this.clearUnclaimedCompletionsWhenSettled()
      },
    }
  }

  public noteCompletion(sessionId: string): void {
    if (this.activeSessionIds.delete(sessionId)) {
      return
    }

    if (!this.disposed && this.pendingAttemptCount > 0) {
      this.completedBeforeRegistration.add(sessionId)
    }
  }

  public dispose(): void {
    this.disposed = true
    this.activeSessionIds.clear()
    this.completedBeforeRegistration.clear()
  }

  private clearUnclaimedCompletionsWhenSettled(): void {
    if (this.pendingAttemptCount === 0) {
      this.completedBeforeRegistration.clear()
    }
  }
}
