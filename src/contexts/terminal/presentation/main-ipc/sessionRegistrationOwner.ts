import type {
  TerminalProcessEnginePort,
  TerminalProcessSpawnInput,
} from '../../application/ports/TerminalProcessEnginePort'
import {
  SessionRegistrationOwner,
  SessionRegistrationRejectedError,
} from '../../../../shared/runtime/sessionRegistrationOwner'

export class PtyRuntimeSessionRegistrationOwner {
  private readonly registrations = new SessionRegistrationOwner()

  public constructor(
    private readonly options: {
      processEngine: TerminalProcessEnginePort
      register: (sessionId: string, input: TerminalProcessSpawnInput) => boolean
    },
  ) {}

  public noteExit(sessionId: string): void {
    this.registrations.noteCompletion(sessionId)
  }

  public async spawn(input: TerminalProcessSpawnInput): Promise<{ sessionId: string }> {
    const registration = this.registrations.begin()
    let spawned: { sessionId: string }
    try {
      spawned = await this.options.processEngine.spawn(input)
    } catch (error) {
      registration.cancel()
      throw error
    }

    const disposition = registration.complete(spawned.sessionId)
    if (disposition !== 'active') {
      const registrationError = new SessionRegistrationRejectedError(spawned.sessionId, disposition)
      if (disposition === 'owner_disposed') {
        let retirementFailure: unknown = null
        try {
          this.options.processEngine.kill(spawned.sessionId)
        } catch (error) {
          retirementFailure = error
        }
        if (retirementFailure) {
          throw new AggregateError(
            [registrationError, retirementFailure],
            'PTY registration and exact-session retirement both failed.',
          )
        }
      }
      throw registrationError
    }

    if (!this.options.register(spawned.sessionId, input)) {
      this.registrations.noteCompletion(spawned.sessionId)
      throw new SessionRegistrationRejectedError(spawned.sessionId, 'completed')
    }
    return spawned
  }

  public dispose(): void {
    this.registrations.dispose()
  }
}
