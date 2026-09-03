import type { AgentLaunchArtifactOwner } from '../../../../contexts/agent/application/services/AgentLaunchArtifactOwner'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import {
  SessionRegistrationRejectedError,
  type SessionRegistrationAttempt,
} from '../../../../shared/runtime/sessionRegistrationOwner'

export async function spawnLocalSessionWithArtifacts(
  localRuntime: ControlSurfacePtyRuntime,
  spawnOptions: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0],
  artifactOwner: AgentLaunchArtifactOwner,
  registration: SessionRegistrationAttempt,
  onRegistered: (sessionId: string) => void,
): Promise<{ sessionId: string }> {
  const { launchArtifacts, ...localSpawnOptions } = spawnOptions
  let spawned: { sessionId: string }
  try {
    spawned = await localRuntime.spawnSession(localSpawnOptions)
  } catch (spawnError) {
    registration.cancel()
    return await artifactOwner.rollbackFailedLaunch(spawnError, launchArtifacts)
  }

  const disposition = registration.complete(spawned.sessionId)
  if (disposition !== 'active') {
    const registrationError = new SessionRegistrationRejectedError(spawned.sessionId, disposition)
    if (disposition === 'owner_disposed') {
      try {
        localRuntime.kill(spawned.sessionId)
      } catch (killError) {
        return await artifactOwner.rollbackFailedLaunch(
          new AggregateError(
            [registrationError, killError],
            'Session registration and exact-session retirement both failed.',
          ),
          launchArtifacts,
        )
      }
    }
    return await artifactOwner.rollbackFailedLaunch(registrationError, launchArtifacts)
  }

  artifactOwner.adopt(spawned.sessionId, launchArtifacts)
  onRegistered(spawned.sessionId)
  return spawned
}
