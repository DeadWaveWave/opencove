import type { ControlSurfaceContext } from '../types'
import type {
  LaunchAgentSessionInMountInput,
  LaunchAgentSessionResult,
} from '../../../../shared/contracts/dto'
import type { registerSessionLaunchAgentInMountHandler } from './sessionLaunchAgentInMountHandler'
import type { resolveAdmittedMountAgentLaunch } from './resolveAdmittedMountAgentLaunch'
import { assertNoManagedClaudeRemoteLaunch } from '../managedClaudeLaunchRuntime'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import { createAppError } from '../../../../shared/errors/appError'
import { publicTerminalSpawnError } from '../../../../shared/errors/terminalSpawnError'
import { normalizeOptionalString, toLocalAgentLaunchInput } from './sessionLaunchPayloadSupport'
import { resolveRemoteAgentLaunchSettings } from './agentLaunchEnvironment'
import { getPublicTerminalSpawnCommand, resolveExecutionContextDto } from './sessionLaunchSupport'
import {
  logAgentLaunchInfo,
  logAgentLaunchError,
} from '../../diagnostics/agentLaunchRuntimeDiagnostics'

export async function launchRemoteAgentInMount({
  ctx,
  payload,
  target,
  cwd,
  mode,
  deps,
}: {
  ctx: ControlSurfaceContext
  payload: LaunchAgentSessionInMountInput
  target: Awaited<ReturnType<typeof resolveAdmittedMountAgentLaunch>>['target']
  cwd: string
  mode: 'new' | 'resume'
  deps: Parameters<typeof registerSessionLaunchAgentInMountHandler>[1]
}): Promise<LaunchAgentSessionResult> {
  assertNoManagedClaudeRemoteLaunch()
  logAgentLaunchInfo(
    'control-surface-mount-remote-forward-start',
    'Forwarding agent launch to remote endpoint.',
    {
      mountId: payload.mountId,
      endpointId: target.endpointId,
      targetRootPath: target.rootPath,
      cwd,
      provider: payload.provider ?? null,
      mode,
      executablePathOverridePresent: !!payload.executablePathOverride,
      cols: payload.cols ?? null,
      rows: payload.rows ?? null,
    },
  )
  const endpoint = await deps.topology.resolveRemoteEndpointConnection(target.endpointId)
  if (!endpoint) {
    throw createAppError('worker.unavailable', {
      debugMessage: `Remote endpoint unavailable: ${target.endpointId}`,
    })
  }
  const remoteInput = await resolveRemoteAgentLaunchSettings(ctx, payload, deps)
  ctx.assertActive?.()
  const remoteResult = await (async () => {
    const { result } = await invokeControlSurface(endpoint, {
      kind: 'command',
      id: 'workspace.approveRoot',
      payload: { path: target.rootPath },
    })

    if (!result) {
      throw createAppError('worker.unavailable')
    }

    if (result.ok === false) {
      throw createAppError(result.error)
    }

    ctx.assertActive?.()
    const agentLaunchResult = await invokeControlSurface(endpoint, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: toLocalAgentLaunchInput(remoteInput, cwd, mode),
    })

    if (!agentLaunchResult.result) {
      throw createAppError('worker.unavailable')
    }

    if (agentLaunchResult.result.ok === false) {
      logAgentLaunchError(
        'control-surface-mount-remote-launch-failed',
        'Remote endpoint returned an agent launch error.',
        {
          mountId: payload.mountId,
          endpointId: target.endpointId,
          provider: payload.provider ?? null,
          mode,
          errorName: agentLaunchResult.result.error.code,
          errorMessage: agentLaunchResult.result.error.debugMessage ?? null,
          errorStack: null,
        },
      )
      throw publicTerminalSpawnError(agentLaunchResult.result.error, 'agent.launch_failed')
    }

    const value = agentLaunchResult.result.value as LaunchAgentSessionResult
    return { ...value, ...getPublicTerminalSpawnCommand(value) }
  })()

  const remoteSessionId = normalizeOptionalString(remoteResult.sessionId)
  if (!remoteSessionId) {
    throw createAppError('worker.unavailable', {
      debugMessage: 'Remote session.launchAgent returned an invalid session id.',
    })
  }

  const homeSessionId = deps.ptyRuntime.registerRemoteSession({
    endpointId: target.endpointId,
    remoteSessionId,
  })
  logAgentLaunchInfo(
    'control-surface-mount-remote-session-registered',
    'Registered remote agent session in home runtime.',
    {
      mountId: payload.mountId,
      endpointId: target.endpointId,
      remoteSessionId,
      homeSessionId,
      provider: remoteResult.provider,
      command: remoteResult.command,
      argCount: remoteResult.args.length,
      cols: payload.cols ?? 80,
      rows: payload.rows ?? 24,
    },
  )

  deps.ptyStreamHub.registerSessionMetadata({
    sessionId: homeSessionId,
    kind: 'agent',
    startedAt: remoteResult.startedAt,
    cwd: remoteResult.executionContext.workingDirectory,
    command: remoteResult.command,
    args: remoteResult.args,
    cols: payload.cols ?? 80,
    rows: payload.rows ?? 24,
  })

  const executionContext = resolveExecutionContextDto(
    remoteResult.executionContext.workingDirectory,
    {
      projectId: remoteResult.executionContext.projectId,
      spaceId: remoteResult.executionContext.spaceId,
      mountId: payload.mountId,
      targetId: target.targetId,
      endpointId: target.endpointId,
      endpointKind: 'remote_worker',
      targetRootPath: target.rootPath,
      targetRootUri: target.rootUri,
      scopeRootPath: target.rootPath,
      scopeRootUri: target.rootUri,
    },
  )

  const startedAtMs = Date.parse(remoteResult.startedAt)

  deps.sessions.set(homeSessionId, {
    sessionId: homeSessionId,
    provider: remoteResult.provider,
    startedAt: remoteResult.startedAt,
    cwd: remoteResult.executionContext.workingDirectory,
    prompt: payload.prompt,
    model: payload.model ?? null,
    effectiveModel: remoteResult.effectiveModel ?? null,
    executionContext,
    resumeSessionId: remoteResult.resumeSessionId ?? null,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    command: remoteResult.command,
    args: remoteResult.args,
    route: {
      kind: 'remote',
      endpointId: target.endpointId,
      remoteSessionId,
    },
  })

  return {
    ...remoteResult,
    sessionId: homeSessionId,
    executionContext,
  }
}
