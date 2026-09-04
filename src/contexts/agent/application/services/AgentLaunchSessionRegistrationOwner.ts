import {
  SessionRegistrationOwner,
  SessionRegistrationRejectedError,
} from '../../../../shared/runtime/sessionRegistrationOwner'
import type { AgentLaunchArtifactScope } from './AgentLaunchArtifactScope'
import { AgentLaunchArtifactOwner, rollbackAgentLaunchArtifacts } from './AgentLaunchArtifactOwner'

async function captureFailure(operation: () => void | Promise<void>): Promise<unknown | null> {
  try {
    await operation()
    return null
  } catch (error) {
    return error
  }
}

export class AgentLaunchSessionRegistrationOwner {
  private readonly registrations = new SessionRegistrationOwner()
  private readonly artifacts: AgentLaunchArtifactOwner

  public constructor(reportDisposalFailure: (error: unknown) => void) {
    this.artifacts = new AgentLaunchArtifactOwner(reportDisposalFailure)
  }

  public noteExit(sessionId: string): void {
    this.registrations.noteCompletion(sessionId)
    this.artifacts.release(sessionId)
  }

  public async spawn<TResult extends { sessionId: string }>(options: {
    spawn: () => Promise<TResult>
    artifacts: AgentLaunchArtifactScope | undefined
    onRegistered: (spawned: TResult) => void
    retireExact: (sessionId: string) => void | Promise<void>
  }): Promise<TResult> {
    const registration = this.registrations.begin()
    let spawned: TResult
    try {
      spawned = await options.spawn()
    } catch (error) {
      registration.cancel()
      return await rollbackAgentLaunchArtifacts(error, options.artifacts)
    }

    const disposition = registration.complete(spawned.sessionId)
    if (disposition !== 'active') {
      let registrationError: unknown = new SessionRegistrationRejectedError(
        spawned.sessionId,
        disposition,
      )
      if (disposition === 'owner_disposed') {
        try {
          await options.retireExact(spawned.sessionId)
        } catch (retireError) {
          registrationError = new AggregateError(
            [registrationError, retireError],
            'Agent session registration and exact-session retirement both failed.',
          )
        }
      }
      return await rollbackAgentLaunchArtifacts(registrationError, options.artifacts)
    }

    this.artifacts.adopt(spawned.sessionId, options.artifacts)
    try {
      options.onRegistered(spawned)
    } catch (registrationError) {
      this.registrations.noteCompletion(spawned.sessionId)
      this.artifacts.release(spawned.sessionId)
      const retireError = await captureFailure(async () => options.retireExact(spawned.sessionId))
      if (retireError) {
        const combinedError = new AggregateError(
          [registrationError, retireError],
          'Agent post-spawn registration and exact-session retirement both failed.',
        )
        throw combinedError
      }
      throw registrationError
    }
    return spawned
  }

  public dispose(): void {
    this.registrations.dispose()
    this.artifacts.releaseAll()
  }
}
