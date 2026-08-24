import type { AgentLaunchArtifactOwner } from '../../../../contexts/agent/application/services/AgentLaunchArtifactOwner'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'

export async function spawnLocalSessionWithArtifacts(
  localRuntime: ControlSurfacePtyRuntime,
  spawnOptions: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0],
  artifactOwner: AgentLaunchArtifactOwner,
): Promise<{ sessionId: string }> {
  const { launchArtifacts, ...localSpawnOptions } = spawnOptions
  try {
    const spawned = await localRuntime.spawnSession(localSpawnOptions)
    artifactOwner.adopt(spawned.sessionId, launchArtifacts)
    return spawned
  } catch (spawnError) {
    return await artifactOwner.rollbackFailedLaunch(spawnError, launchArtifacts)
  }
}
