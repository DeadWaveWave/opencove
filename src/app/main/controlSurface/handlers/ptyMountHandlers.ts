import { spawnForbiddenDetails } from '../../../../shared/errors/agentSpawnError'
import { getPublicTerminalSpawnCommand } from '../../../../platform/terminal/publicTerminalSpawnCommand'
import { ptySpawnInMountOperation } from '../../../../shared/contracts/controlSurface/operations/domains/pty'
import { registerOperation } from '../registerOperation'
import { fromFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError, OpenCoveAppError } from '../../../../shared/errors/appError'
import type { SpawnTerminalInput, SpawnTerminalResult } from '../../../../shared/contracts/dto'
import { TerminalProfileResolver } from '../../../../platform/terminal/TerminalProfileResolver'
import type { ControlSurface } from '../controlSurface'
import type { TerminalSpawnAdmission } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type { TerminalAgentActivityEnvironmentService } from '../../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { composeTerminalSpawnGuard, spawnTerminalWithActivity } from './terminalAgentActivitySpawn'
const terminalProfileResolver = new TerminalProfileResolver()

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolvePathFromUriOrThrow(uri: string, operationId: string): string {
  const resolved = fromFileUri(uri)
  if (!resolved) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return resolved
}

async function invokeRemoteValue<TResult>(options: {
  endpoint: { hostname: string; port: number; token: string }
  id: string
  kind: 'query' | 'command'
  payload: unknown
}): Promise<TResult> {
  try {
    const { result } = await invokeControlSurface(options.endpoint, {
      kind: options.kind,
      id: options.id,
      payload: options.payload,
    })

    if (!result) {
      throw createAppError('worker.unavailable')
    }

    if (result.ok === false) {
      throw createAppError(result.error)
    }

    return result.value as TResult
  } catch (error) {
    if (error instanceof OpenCoveAppError) {
      throw error
    }

    throw createAppError('worker.unavailable', {
      debugMessage: error instanceof Error ? `${error.name}: ${error.message}` : undefined,
    })
  }
}

export function registerPtyMountHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
    terminalSpawnAdmission: TerminalSpawnAdmission
    terminalAgentActivity?: TerminalAgentActivityEnvironmentService
  },
): void {
  registerOperation(controlSurface, ptySpawnInMountOperation, {
    handle: async (ctx, payload): Promise<SpawnTerminalResult> => {
      const target = await deps.topology.resolveMountTarget({ mountId: payload.mountId })
      if (!target) {
        throw createAppError('common.invalid_input', {
          debugMessage: `Unknown mountId: ${payload.mountId}`,
        })
      }
      deps.terminalSpawnAdmission.assertSpawnAllowed(
        target.projectId,
        ctx.terminalRecoverySpawnScope,
      )

      const cwdUri = payload.cwdUri ?? target.rootUri
      assertFileUriWithinRootUri({
        rootUri: target.rootUri,
        uri: cwdUri,
        debugMessage: 'pty.spawnInMount cwdUri is outside mount root',
      })

      const cwd = resolvePathFromUriOrThrow(cwdUri, 'pty.spawnInMount cwdUri')
      ctx.terminalSpawnLifecycle?.assertExecution?.({
        cwd,
        mountId: target.mountId,
        endpointId: target.endpointId,
      })
      const cols = payload.cols ?? 80
      const rows = payload.rows ?? 24
      const profileId = normalizeOptionalString(payload.profileId)
      const shell = normalizeOptionalString(payload.shell)

      const startedAt = ctx.now().toISOString()

      if (ctx.requestAuth?.kind === 'session-grant' && target.endpointId !== 'local') {
        throw createAppError('common.forbidden', {
          details: spawnForbiddenDetails('remote_spawning_unsupported'),
        })
      }
      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(cwd)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'pty.spawnInMount cwd is outside approved roots',
          })
        }

        const resolvedSpawn = payload.command
          ? await terminalProfileResolver.resolveCommandSpawn({
              cwd,
              profileId,
              command: payload.command,
              args: payload.args ?? [],
              env: payload.env ?? undefined,
              commandEnv: payload.env ?? undefined,
            })
          : await terminalProfileResolver.resolveTerminalSpawn({
              cwd,
              cols,
              rows,
              profileId: profileId ?? undefined,
              ...(shell ? { shell } : {}),
              ...(payload.env ? { env: payload.env } : {}),
            })

        ctx.assertActive?.()
        const { sessionId } = await spawnTerminalWithActivity(deps.ptyRuntime, {
          assertActive: composeTerminalSpawnGuard(ctx),
          onSpawned: ctx.terminalSpawnLifecycle?.onSpawned,
          activity: deps.terminalAgentActivity,
          args: resolvedSpawn.args,
          cols,
          command: resolvedSpawn.command,
          cwd: resolvedSpawn.cwd,
          env: resolvedSpawn.env,
          interactiveShell: !payload.command,
          runtimeKind: resolvedSpawn.runtimeKind,
          rows,
        })

        deps.ptyStreamHub.registerSessionMetadata({
          sessionId,
          kind: 'terminal',
          startedAt,
          cwd: resolvedSpawn.cwd,
          ...getPublicTerminalSpawnCommand(resolvedSpawn),
          cols,
          rows,
        })

        return {
          sessionId,
          profileId: resolvedSpawn.profileId,
          runtimeKind: resolvedSpawn.runtimeKind,
        }
      }

      const endpoint = await deps.topology.resolveRemoteEndpointConnection(target.endpointId)
      if (!endpoint) {
        throw createAppError('worker.unavailable', {
          debugMessage: `Remote endpoint unavailable: ${target.endpointId}`,
        })
      }

      const remoteSpawnPayload: SpawnTerminalInput = {
        cwd,
        workspaceId: target.projectId,
        cols,
        rows,
        ...(profileId ? { profileId } : {}),
        ...(shell ? { shell } : {}),
        ...(payload.command ? { command: payload.command } : {}),
        ...(payload.args ? { args: payload.args } : {}),
        ...(payload.env ? { env: payload.env } : {}),
      }

      composeTerminalSpawnGuard(ctx)()
      const remoteResult = await invokeRemoteValue<SpawnTerminalResult>({
        endpoint,
        kind: 'command',
        id: 'pty.spawn',
        payload: remoteSpawnPayload,
      })

      const remoteSessionId = normalizeOptionalString(remoteResult.sessionId)
      if (!remoteSessionId) {
        throw createAppError('worker.unavailable', {
          debugMessage: 'Remote pty.spawn returned an invalid session id.',
        })
      }

      const homeSessionId = deps.ptyRuntime.registerRemoteSession({
        endpointId: target.endpointId,
        remoteSessionId,
      })

      deps.ptyStreamHub.registerSessionMetadata({
        sessionId: homeSessionId,
        kind: 'terminal',
        startedAt,
        cwd,
        command: payload.command ?? shell ?? 'shell',
        args: payload.command ? (payload.args ?? []) : [],
        cols,
        rows,
      })

      return {
        sessionId: homeSessionId,
        profileId: remoteResult.profileId ?? profileId,
        runtimeKind: remoteResult.runtimeKind,
      }
    },
    defaultErrorCode: 'terminal.spawn_failed',
  })
}
