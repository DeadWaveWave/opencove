import type { LaunchAgentSessionInMountInput } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { TerminalSpawnAdmission } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import type { ControlSurfaceContext } from '../types'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import { logAgentLaunchInfo } from '../../diagnostics/agentLaunchRuntimeDiagnostics'
import { resolvePathFromFileSystemUriOrThrow } from './sessionLaunchPayloadSupport'

type MountTarget = NonNullable<Awaited<ReturnType<WorkerTopologyStore['resolveMountTarget']>>>

export async function resolveAdmittedMountAgentLaunch(input: {
  ctx: ControlSurfaceContext
  payload: LaunchAgentSessionInMountInput
  topology: WorkerTopologyStore
  admission: TerminalSpawnAdmission
}): Promise<{ target: MountTarget; cwd: string; mode: 'new' | 'resume' }> {
  const { ctx, payload } = input
  logAgentLaunchInfo(
    'control-surface-mount-received',
    'Control surface received session.launchAgentInMount.',
    {
      mountId: payload.mountId,
      provider: payload.provider ?? null,
      mode: payload.mode ?? 'new',
      cwdUriPresent: !!payload.cwdUri,
      promptLength: payload.prompt.length,
      resumeSessionIdPresent: !!payload.resumeSessionId,
      executablePathOverridePresent: !!payload.executablePathOverride,
      agentFullAccess: payload.agentFullAccess ?? null,
      cols: payload.cols ?? null,
      rows: payload.rows ?? null,
    },
  )

  const target = await input.topology.resolveMountTarget({ mountId: payload.mountId })
  if (!target) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unknown mountId: ${payload.mountId}`,
    })
  }
  input.admission.assertSpawnAllowed(target.projectId, ctx.terminalRecoverySpawnScope)

  const cwdUri = payload.cwdUri ?? target.rootUri
  assertFileUriWithinRootUri({
    rootUri: target.rootUri,
    uri: cwdUri,
    debugMessage: 'session.launchAgentInMount cwdUri is outside mount root',
  })

  return {
    target,
    cwd: resolvePathFromFileSystemUriOrThrow(cwdUri, 'session.launchAgentInMount cwdUri'),
    mode: payload.mode ?? 'new',
  }
}
